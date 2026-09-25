import { describe, expect, it } from 'vitest';
import { BddManager } from '../../src/bdd/bdd';

// 穷举参考实现：仅存在于测试中，用于对小规模函数做独立交叉核对。
// 产品代码 src/ 内没有任何全赋值枚举。
function allAssignments(
  vars: string[],
): Array<Record<string, 0 | 1>> {
  const out: Array<Record<string, 0 | 1>> = [];
  for (let mask = 0; mask < 1 << vars.length; mask++) {
    const assignment: Record<string, 0 | 1> = {};
    vars.forEach((name, i) => {
      assignment[name] = ((mask >> (vars.length - 1 - i)) & 1) as 0 | 1;
    });
    out.push(assignment);
  }
  return out;
}

function asNumber(a: Record<string, 0 | 1>, vars: string[]): number {
  return vars.reduce((acc, name) => (acc << 1) | a[name], 0);
}

describe('BddManager 基础与约简', () => {
  it('变量节点唯一化：同名变量只建一个节点', () => {
    const m = new BddManager(['A', 'B']);
    expect(m.ithVar(0)).toBe(m.ithVar(0));
    expect(m.uniqueNodeCount).toBe(1);
  });

  it('低/高分支相同的建点被约简为该分支', () => {
    const m = new BddManager(['A']);
    expect(m.mk(0, m.zero, m.zero)).toBe(m.zero);
    expect(m.mk(0, m.one, m.one)).toBe(m.one);
    expect(m.uniqueNodeCount).toBe(0);
  });

  it('NOT 互为对消且不新增冗余节点', () => {
    const m = new BddManager(['A', 'B']);
    const f = m.apply('and', m.ithVar(0), m.ithVar(1));
    expect(m.not(m.not(f))).toBe(f);
  });

  it('终端吸收折叠：A AND 0 = 0，A OR 1 = 1', () => {
    const m = new BddManager(['A']);
    const a = m.ithVar(0);
    expect(m.apply('and', a, m.zero)).toBe(m.zero);
    expect(m.apply('or', a, m.one)).toBe(m.one);
  });
});

describe('Apply 与逐赋值参考实现交叉核对', () => {
  const vars = ['A', 'B', 'C'];

  it('分配律：(A∧B)∨C 与 (A∨C)∧(B∨C) 共享同一规范根，XOR 为 0', () => {
    const m = new BddManager(vars);
    const a = m.ithVar(0);
    const b = m.ithVar(1);
    const c = m.ithVar(2);

    const f = m.apply('or', m.apply('and', a, b), c);
    const g = m.apply(
      'and',
      m.apply('or', a, c),
      m.apply('or', b, c),
    );

    for (const assignment of allAssignments(vars)) {
      const refF = ((assignment.A & assignment.B) | assignment.C) as 0 | 1;
      const refG = ((assignment.A | assignment.C) & (assignment.B | assignment.C)) as 0 | 1;
      expect(m.evaluate(f, assignment)).toBe(refF);
      expect(m.evaluate(g, assignment)).toBe(refG);
    }

    expect(f).toBe(g);
    expect(m.apply('xor', f, g)).toBe(m.zero);
  });

  it('计算表命中：同参数 Apply 直接返回缓存结果', () => {
    const m = new BddManager(vars);
    const a = m.ithVar(0);
    const b = m.ithVar(1);
    m.apply('and', a, b);
    const before = m.cacheHits;
    m.apply('and', a, b);
    expect(m.cacheHits).toBeGreaterThan(before);
  });

  it('德摩根律：NOT(A∧B) = ¬A∨¬B，规范形式下指针相等', () => {
    const m = new BddManager(['A', 'B']);
    const a = m.ithVar(0);
    const b = m.ithVar(1);
    const lhs = m.not(m.apply('and', a, b));
    const rhs = m.apply('or', m.not(a), m.not(b));
    expect(lhs).toBe(rhs);
  });
});

describe('witness 最小满足赋值摘要', () => {
  it('0/1 终端', () => {
    const m = new BddManager(['A']);
    expect(m.satisfyingAssignment(m.zero)).toBeNull();
    expect(m.satisfyingAssignment(m.one)).toEqual({ A: 0 });
  });

  it('变量 A：低分支 0 不可满足，走高分支 => A=1', () => {
    const m = new BddManager(['A']);
    expect(m.satisfyingAssignment(m.ithVar(0))).toEqual({ A: 1 });
  });

  it('低分支可满足时走低分支：A∨B 在 A=0 时可由 B=1 满足，摘要 A=0,B=1', () => {
    const m = new BddManager(['A', 'B']);
    const f = m.apply('or', m.ithVar(0), m.ithVar(1));
    expect(m.satisfyingAssignment(f)).toEqual({ A: 0, B: 1 });
  });

  it('低分支不可满足时走高分支：A∧B 的摘要是 A=1,B=1', () => {
    const m = new BddManager(['A', 'B']);
    const f = m.apply('and', m.ithVar(0), m.ithVar(1));
    expect(m.satisfyingAssignment(f)).toEqual({ A: 1, B: 1 });
  });

  it('跳过的变量补 0：B 在序 [A,B,C] 下 A=C=0', () => {
    const m = new BddManager(['A', 'B', 'C']);
    expect(m.satisfyingAssignment(m.ithVar(1))).toEqual({ A: 0, B: 1, C: 0 });
  });

  it('NOT 后仍低分支优先：¬(A∧B) 的最小摘要是 A=0,B=0', () => {
    const m = new BddManager(['A', 'B']);
    const f = m.not(m.apply('and', m.ithVar(0), m.ithVar(1)));
    expect(m.satisfyingAssignment(f)).toEqual({ A: 0, B: 0 });
  });

  it('witness 满足函数，且是变量序下字典序最小的满足赋值', () => {
    const vars = ['A', 'B', 'C', 'D'];
    const m = new BddManager(vars);
    const x = Object.fromEntries(
      vars.map((name, i) => [name, m.ithVar(i)]),
    ) as Record<string, ReturnType<BddManager['ithVar']>>;

    const cases: Array<{
      root: ReturnType<BddManager['ithVar']>;
      ref: (a: Record<string, number>) => number;
    }> = [
      { root: m.apply('xor', x.A, x.B), ref: (a) => a.A ^ a.B },
      {
        root: m.apply('or', m.apply('and', x.A, x.B), x.C),
        ref: (a) => (a.A & a.B) | a.C,
      },
      {
        root: m.not(m.apply('and', m.apply('or', x.A, x.D), x.B)),
        ref: (a) => (((a.A | a.D) & a.B) ^ 1),
      },
    ];

    for (const { root, ref } of cases) {
      const w = m.satisfyingAssignment(root)!;
      expect(m.evaluate(root, w)).toBe(1);
      expect(ref(w)).toBe(1);

      const wNum = asNumber(w, vars);
      for (const assignment of allAssignments(vars)) {
        if (asNumber(assignment, vars) < wNum) {
          expect(ref(assignment)).toBe(0);
        }
      }
    }
  });
});
