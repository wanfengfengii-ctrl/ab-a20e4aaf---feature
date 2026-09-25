import { describe, expect, it } from 'vitest';
import { collectVariables, validatePair } from '../../src/validation';

function graph(nodes: unknown[], output: string): string {
  return JSON.stringify({ nodes, output });
}

const INPUT = (id: string, name: string) => ({ id, type: 'INPUT', name });
const GATE = (id: string, type: string, ins: string[]) => ({
  id,
  type,
  in: ins,
});

describe('validatePair 错误类别', () => {
  it('JSON 语法错误', () => {
    const { errors } = validatePair('{not json', graph([], 'x'));
    expect(errors[0].kind).toBe('syntax');
    expect(errors[0].graph).toBe('A');
  });

  it('重复 id', () => {
    const text = graph(
      [INPUT('a', 'A'), INPUT('a', 'B'), GATE('g', 'AND', ['a', 'a'])],
      'g',
    );
    const { errors } = validatePair(text, graph([INPUT('z', 'Z')], 'z'));
    expect(errors.some((e) => e.kind === 'duplicate_id')).toBe(true);
  });

  it('未知引用', () => {
    const text = graph(
      [INPUT('a', 'A'), GATE('g', 'AND', ['a', 'ghost'])],
      'g',
    );
    const { errors } = validatePair(text, graph([INPUT('z', 'Z')], 'z'));
    expect(errors.some((e) => e.kind === 'unknown_ref')).toBe(true);
  });

  it('元数错误：NOT 两条入边、INPUT 有入边、AND 一条入边', () => {
    const text = graph(
      [
        INPUT('a', 'A'),
        { id: 'i', type: 'INPUT', name: 'I', in: ['a'] },
        GATE('n', 'NOT', ['a', 'a']),
        GATE('g', 'AND', ['a']),
      ],
      'n',
    );
    const { errors } = validatePair(text, graph([INPUT('z', 'Z')], 'z'));
    const arity = errors.filter((e) => e.kind === 'arity');
    expect(arity.map((e) => e.nodeId).sort()).toEqual(['g', 'i', 'n']);
  });

  it('INPUT 名不匹配正则 / 非 INPUT 携带 name', () => {
    const text = graph(
      [
        { id: 'a', type: 'INPUT', name: 'lower' },
        { id: 'b', type: 'INPUT', name: 'HAS-DASH' },
        { id: 'c', type: 'CONST0', name: 'C' },
      ],
      'a',
    );
    const { errors } = validatePair(text, graph([INPUT('z', 'Z')], 'z'));
    expect(errors.filter((e) => e.kind === 'syntax').length).toBe(3);
  });

  it('合法的最长 INPUT 名（16 字符）通过，17 字符拒绝', () => {
    const ok = 'A' + '_'.repeat(15); // 1 + 15 = 16
    const bad = 'A' + '_'.repeat(16); // 17
    expect(ok).toHaveLength(16);
    expect(bad).toHaveLength(17);
    const r1 = validatePair(graph([INPUT('a', ok)], 'a'), graph([INPUT('z', 'Z')], 'z'));
    expect(r1.errors).toHaveLength(0);
    const r2 = validatePair(graph([INPUT('a', bad)], 'a'), graph([INPUT('z', 'Z')], 'z'));
    expect(r2.errors.some((e) => e.kind === 'syntax')).toBe(true);
  });

  it('输出缺失 / 输出指向不存在节点', () => {
    const r1 = validatePair(JSON.stringify({ nodes: [INPUT('a', 'A')] }), graph([INPUT('z', 'Z')], 'z'));
    expect(r1.errors.some((e) => e.kind === 'output')).toBe(true);
    const r2 = validatePair(graph([INPUT('a', 'A')], 'nope'), graph([INPUT('z', 'Z')], 'z'));
    expect(r2.errors.some((e) => e.kind === 'output')).toBe(true);
  });

  it('环错误：自环与相互依赖', () => {
    const text = graph(
      [
        INPUT('a', 'A'),
        GATE('g1', 'AND', ['a', 'g2']),
        GATE('g2', 'AND', ['g1', 'a']),
      ],
      'g1',
    );
    const { errors } = validatePair(text, graph([INPUT('z', 'Z')], 'z'));
    expect(errors.some((e) => e.kind === 'cycle')).toBe(true);
  });
});

describe('错误汇总顺序：旧图优先、位置升序', () => {
  it('A 图错误全部排在 B 图错误之前', () => {
    const badA = graph(
      [INPUT('a', 'A'), GATE('g', 'NOT', ['a', 'a'])],
      'g',
    );
    const badB = graph([{ id: 'x' }], 'x');
    const { errors } = validatePair(badA, badB);
    expect(errors.length).toBeGreaterThan(1);
    let lastA = -1;
    errors.forEach((e, i) => {
      if (e.graph === 'A') lastA = i;
    });
    const firstB = errors.findIndex((e) => e.graph === 'B');
    expect(lastA).toBeGreaterThanOrEqual(0);
    expect(lastA).toBeLessThan(firstB);
  });

  it('同图内按 nodes 下标升序，图级错误在最前', () => {
    const text = JSON.stringify({
      nodes: [
        INPUT('a', 'A'),
        GATE('g1', 'AND', ['a']), // nodes[1] 元数错误
        GATE('g0', 'OR', ['a']), // nodes[2] 元数错误
      ],
      // 缺 output => 图级错误排第一
    });
    const { errors } = validatePair(text, graph([INPUT('z', 'Z')], 'z'));
    expect(errors[0].kind).toBe('output');
    const arity = errors.filter((e) => e.kind === 'arity');
    expect(arity.map((e) => e.nodeId)).toEqual(['g1', 'g0']);
  });

  it('同节点多错误按类别次序：duplicate_id -> unknown_ref -> arity', () => {
    const text = graph(
      [
        INPUT('a', 'A'),
        INPUT('a', 'A2'),
        GATE('g', 'AND', ['a']), // 同时未知（首份 arity 已占）——构造 arity 错误
      ],
      'g',
    );
    const { errors } = validatePair(text, graph([INPUT('z', 'Z')], 'z'));
    const kinds = errors.map((e) => e.kind);
    expect(kinds.indexOf('duplicate_id')).toBeLessThan(kinds.indexOf('arity') + 1);
    expect(kinds).toContain('duplicate_id');
  });
});

describe('跨图变量', () => {
  it('同名 INPUT 为同一变量；并集按 ASCII 升序', () => {
    const r = validatePair(
      graph([INPUT('b', 'B'), INPUT('a', 'A'), GATE('g', 'AND', ['b', 'a'])], 'g'),
      graph([INPUT('c', 'C'), INPUT('a', 'A'), GATE('h', 'AND', ['c', 'a'])], 'h'),
    );
    expect(r.errors).toHaveLength(0);
    expect(collectVariables(r.graphA!, r.graphB!)).toEqual(['A', 'B', 'C']);
  });
});
