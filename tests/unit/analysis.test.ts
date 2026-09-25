import { describe, expect, it } from 'vitest';
import { analyze, topoOrder } from '../../src/analysis';
import { validatePair } from '../../src/validation';
import type { Graph } from '../../src/types';

function buildGraph(nodes: unknown[], output: string): Graph {
  const r = validatePair(JSON.stringify({ nodes, output }), JSON.stringify({ nodes: [{ id: '_', type: 'CONST0' }], output: '_' }));
  if (r.errors.length > 0) throw new Error(r.errors.map((e) => e.message).join('; '));
  return r.graphA!;
}

const I = (id: string, name: string) => ({ id, type: 'INPUT', name });
const K = (id: string, type: 'CONST0' | 'CONST1') => ({ id, type });
const G = (id: string, type: string, ins: string[]) => ({ id, type, in: ins });

describe('analyze 等价判定', () => {
  it('恒等结构 => equivalent', () => {
    const a = buildGraph([I('a', 'A'), I('b', 'B'), G('o', 'XOR', ['a', 'b'])], 'o');
    const b = buildGraph([I('x', 'A'), I('y', 'B'), G('o', 'XOR', ['x', 'y'])], 'o');
    const r = analyze(a, b);
    expect(r.equivalent).toBe(true);
    expect(r.outputA).toBe(r.outputB);
  });

  it('布尔代数改版：(A∧B)∨C ≡ (A∨C)∧(B∨C)', () => {
    const a = buildGraph(
      [I('a', 'A'), I('b', 'B'), I('c', 'C'), G('ab', 'AND', ['a', 'b']), G('o', 'OR', ['ab', 'c'])],
      'o',
    );
    const b = buildGraph(
      [
        I('x', 'A'), I('y', 'B'), I('z', 'C'),
        G('ac', 'OR', ['x', 'z']), G('bc', 'OR', ['y', 'z']), G('o', 'AND', ['ac', 'bc']),
      ],
      'o',
    );
    expect(analyze(a, b).equivalent).toBe(true);
  });

  it('NOT NOT 对消：A ≡ ¬¬A', () => {
    const a = buildGraph([I('a', 'A')], 'a');
    const b = buildGraph([I('x', 'A'), G('n1', 'NOT', ['x']), G('n2', 'NOT', ['n1'])], 'n2');
    expect(analyze(a, b).equivalent).toBe(true);
  });

  it('常量传播：A AND 0 ≡ CONST0', () => {
    const a = buildGraph([I('a', 'A'), K('z', 'CONST0'), G('o', 'AND', ['a', 'z'])], 'o');
    const b = buildGraph([K('o', 'CONST0')], 'o');
    expect(analyze(a, b).equivalent).toBe(true);
  });
});

describe('analyze 反例（直接读取异或根摘要）', () => {
  it('(A∧B)∨C 与 (A∧B) 的唯一最小反例：A=0,B=0,C=1', () => {
    const a = buildGraph(
      [I('a', 'A'), I('b', 'B'), I('c', 'C'), G('ab', 'AND', ['a', 'b']), G('o', 'OR', ['ab', 'c'])],
      'o',
    );
    const b = buildGraph(
      [I('x', 'A'), I('y', 'B'), G('o', 'AND', ['x', 'y'])],
      'o',
    );
    const r = analyze(a, b);
    expect(r.equivalent).toBe(false);
    expect(r.counterexample).toEqual({ A: 0, B: 0, C: 1 });
    expect(r.outputA).toBe(1);
    expect(r.outputB).toBe(0);
  });

  it('罕见单点分歧：XOR(A,B) 与 OR(A,B) 仅在 A=B=1 时分歧', () => {
    const a = buildGraph([I('a', 'A'), I('b', 'B'), G('o', 'XOR', ['a', 'b'])], 'o');
    const b = buildGraph([I('x', 'A'), I('y', 'B'), G('o', 'OR', ['x', 'y'])], 'o');
    const r = analyze(a, b);
    expect(r.equivalent).toBe(false);
    expect(r.counterexample).toEqual({ A: 1, B: 1 });
    expect(r.outputA).toBe(0);
    expect(r.outputB).toBe(1);
  });

  it('反例经逐门复算自洽：输出不同且各门输入输出一致', () => {
    const a = buildGraph(
      [I('a', 'A'), I('b', 'B'), G('n', 'NOT', ['a']), G('o', 'AND', ['n', 'b'])],
      'o',
    );
    const b = buildGraph(
      [I('x', 'A'), I('y', 'B'), G('o', 'OR', ['x', 'y'])],
      'o',
    );
    const r = analyze(a, b);
    expect(r.equivalent).toBe(false);

    for (const graph of ['A', 'B'] as const) {
      const trace = r.trace.filter((t) => t.graph === graph);
      const values = new Map(trace.map((t) => [t.id, t.value]));
      for (const t of trace) {
        for (const input of t.inputs) {
          expect(values.get(input.id)).toBe(input.value);
        }
        switch (t.type) {
          case 'AND':
            expect(t.value).toBe((t.inputs[0].value & t.inputs[1].value) as 0 | 1);
            break;
          case 'OR':
            expect(t.value).toBe((t.inputs[0].value | t.inputs[1].value) as 0 | 1);
            break;
          case 'XOR':
            expect(t.value).toBe((t.inputs[0].value ^ t.inputs[1].value) as 0 | 1);
            break;
          case 'NOT':
            expect(t.value).toBe((t.inputs[0].value ^ 1) as 0 | 1);
            break;
        }
      }
    }
  });

  it('一侧多余变量（新图引入 D）仍可判定，摘要给出字典序最小反例', () => {
    const a = buildGraph([I('a', 'A'), G('o', 'NOT', ['a'])], 'o');
    const b = buildGraph(
      [I('x', 'A'), I('d', 'D'), G('xd', 'AND', ['x', 'd']), G('o', 'NOT', ['xd'])],
      'o',
    );
    // ¬A 与 ¬(A∧D)：A=0 时两边都为 1；仅 A=1,D=0 时 0 vs 1
    const r = analyze(a, b);
    expect(r.equivalent).toBe(false);
    expect(r.counterexample).toEqual({ A: 1, D: 0 });
    expect(r.outputA).toBe(0);
    expect(r.outputB).toBe(1);
  });
});

describe('topoOrder 确定性', () => {
  it('同一图多次排序结果一致，且所有前驱先于后继', () => {
    const g = buildGraph(
      [
        I('a', 'A'), I('b', 'B'),
        G('g1', 'AND', ['a', 'b']), G('g2', 'NOT', ['g1']), G('o', 'OR', ['g1', 'g2']),
      ],
      'o',
    );
    const o1 = topoOrder(g).map((n) => n.id);
    const o2 = topoOrder(g).map((n) => n.id);
    expect(o1).toEqual(o2);
    const pos = new Map(o1.map((id, i) => [id, i]));
    for (const n of g.nodes) {
      for (const ref of n.in) expect(pos.get(ref)).toBeLessThan(pos.get(n.id)!);
    }
  });
});
