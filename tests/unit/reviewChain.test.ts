import { beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../../src/analysis';
import { canonicalize } from '../../src/canonical';
import { EXAMPLES } from '../../src/examples';
import {
  GENESIS_DIGEST,
  STORAGE_KEY,
  loadChain,
  persistChain,
  recordAppliesTo,
  recordDigest,
  resultMatchesRecord,
  sealRecord,
  verifyRecords,
  type ReviewRecord,
} from '../../src/reviewChain';
import { validatePair } from '../../src/validation';
import type { AnalysisResult, Graph } from '../../src/types';

interface Binding {
  graphA: Graph;
  graphB: Graph;
  result: AnalysisResult;
}

function analyzeExample(key: keyof typeof EXAMPLES): Binding {
  const ex = EXAMPLES[key];
  const { graphA, graphB, errors } = validatePair(ex.a, ex.b);
  if (errors.length > 0 || !graphA || !graphB) {
    throw new Error(`示例 ${key} 校验失败`);
  }
  return { graphA, graphB, result: analyze(graphA, graphB) };
}

function sealOne(
  key: keyof typeof EXAMPLES,
  existing: ReviewRecord[] = [],
  reviewer = '张工',
  remark = '',
): ReviewRecord {
  const { graphA, graphB, result } = analyzeExample(key);
  return sealRecord(existing, { graphA, graphB, result, reviewer, remark });
}

describe('canonicalize 确定性序列化', () => {
  it('对象键序不影响结果', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('数组保持顺序（顺序不同则结果不同）', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it('undefined 的对象键被跳过（与 JSON 语义一致）', () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe(canonicalize({ b: 1 }));
  });

  it('嵌套结构完全展开且无空白', () => {
    expect(canonicalize({ x: [{ y: 'z' }, true, null] })).toBe(
      '{"x":[{"y":"z"},true,null]}',
    );
  });
});

describe('sealRecord 封存与链式串接', () => {
  it('首条记录：seq=1，前序为 GENESIS，摘要可复算', () => {
    const rec = sealOne('equiv');
    expect(rec.seq).toBe(1);
    expect(rec.prevDigest).toBe(GENESIS_DIGEST);
    const { digest, ...rest } = rec;
    expect(digest).toBe(recordDigest(rest));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('确定性：同一内容两次封存得到同一摘要', () => {
    const r1 = sealOne('differ', [], '张工', '首轮');
    const r2 = sealOne('differ', [], '张工', '首轮');
    expect(r1.digest).toBe(r2.digest);
  });

  it('审查人或备注不同则摘要不同', () => {
    const r1 = sealOne('equiv', [], '张工');
    const r2 = sealOne('equiv', [], '李工');
    const r3 = sealOne('equiv', [], '张工', '备注');
    expect(r1.digest).not.toBe(r2.digest);
    expect(r1.digest).not.toBe(r3.digest);
  });

  it('第二条记录的前序摘要 = 第一条记录摘要', () => {
    const r1 = sealOne('equiv');
    const r2 = sealOne('differ', [r1]);
    expect(r2.seq).toBe(2);
    expect(r2.prevDigest).toBe(r1.digest);
    expect(r2.digest).not.toBe(r1.digest);
  });

  it('记录绑定规范化门图、变量序、结论/反例与逐门复算摘要', () => {
    const rec = sealOne('differ');
    const { graphA, graphB, result } = analyzeExample('differ');
    expect(rec.graphA).toEqual(graphA);
    expect(rec.graphB).toEqual(graphB);
    expect(rec.variables).toEqual(['A', 'B', 'C']);
    expect(rec.equivalent).toBe(false);
    expect(rec.counterexample).toEqual({ A: 0, B: 0, C: 1 });
    expect(rec.outputA).toBe(1);
    expect(rec.outputB).toBe(0);
    expect(rec.trace).toEqual(result.trace);
    expect(rec.trace.length).toBeGreaterThan(0);
  });
});

describe('verifyRecords 逐条复核', () => {
  it('合法链可信（含多条）', () => {
    const r1 = sealOne('equiv');
    const r2 = sealOne('differ', [r1], '李工', '复核');
    const state = verifyRecords([r1, r2]);
    expect(state.trusted).toBe(true);
    expect(state.records).toHaveLength(2);
  });

  it('空链可信', () => {
    expect(verifyRecords([]).trusted).toBe(true);
  });

  it('记录内容被改动 => 不可信并定位到该条', () => {
    const r1 = sealOne('equiv');
    const r2 = sealOne('differ', [r1]);
    const tampered: ReviewRecord = { ...r2, equivalent: true };
    const state = verifyRecords([r1, tampered]);
    expect(state.trusted).toBe(false);
    expect(state.brokenSeq).toBe(2);
    expect(state.reason).toContain('记录摘要');
  });

  it('反例被改动 => 不可信', () => {
    const r1 = sealOne('differ');
    const tampered: ReviewRecord = {
      ...r1,
      counterexample: { ...r1.counterexample, C: 0 },
    };
    const state = verifyRecords([tampered]);
    expect(state.trusted).toBe(false);
    expect(state.brokenSeq).toBe(1);
  });

  it('序号不连续 => 不可信', () => {
    const r1 = sealOne('equiv');
    const r2 = sealOne('differ', [r1]);
    const state = verifyRecords([r1, { ...r2, seq: 5 }]);
    expect(state.trusted).toBe(false);
    expect(state.brokenSeq).toBe(2);
    expect(state.reason).toContain('序号');
  });

  it('前序摘要被改动 => 不可信', () => {
    const r1 = sealOne('equiv');
    const r2 = sealOne('differ', [r1]);
    const state = verifyRecords([r1, { ...r2, prevDigest: r1.digest.replace(/^./, 'f') }]);
    expect(state.trusted).toBe(false);
    expect(state.brokenSeq).toBe(2);
    expect(state.reason).toContain('前序摘要');
  });

  it('删除首条后剩余记录无法接续 => 不可信', () => {
    const r1 = sealOne('equiv');
    const r2 = sealOne('differ', [r1]);
    const state = verifyRecords([r2]);
    expect(state.trusted).toBe(false);
    expect(state.brokenSeq).toBe(1);
  });

  it('首条前序摘要非 GENESIS => 不可信', () => {
    const r1 = sealOne('equiv');
    const state = verifyRecords([{ ...r1, prevDigest: 'f'.repeat(64) }]);
    expect(state.trusted).toBe(false);
    expect(state.brokenSeq).toBe(1);
  });
});

describe('recordAppliesTo 适用于当前草稿的判定', () => {
  it('草稿与结论均未变化 => 适用', () => {
    const rec = sealOne('differ');
    const { graphA, graphB, result } = analyzeExample('differ');
    expect(recordAppliesTo(rec, { graphA, graphB, result })).toBe(true);
  });

  it('未完成比较（current 为 null）=> 不适用', () => {
    const rec = sealOne('equiv');
    expect(recordAppliesTo(rec, null)).toBe(false);
  });

  it('草稿变化（换成另一份图）=> 不适用', () => {
    const rec = sealOne('equiv');
    const other = analyzeExample('differ');
    expect(
      recordAppliesTo(rec, {
        graphA: other.graphA,
        graphB: other.graphB,
        result: other.result,
      }),
    ).toBe(false);
  });

  it('比较结论或反例变化 => 不适用', () => {
    const rec = sealOne('differ');
    const { graphA, graphB, result } = analyzeExample('differ');
    const flipped: AnalysisResult = {
      ...result,
      counterexample: { ...result.counterexample, C: 0 },
    };
    expect(recordAppliesTo(rec, { graphA, graphB, result: flipped })).toBe(false);
  });
});

describe('resultMatchesRecord 恢复快照复核一致性', () => {
  it('同一对图重新分析 => 与封存一致', () => {
    const rec = sealOne('differ');
    const { result } = analyzeExample('differ');
    expect(resultMatchesRecord(result, rec)).toBe(true);
  });

  it('等价记录同样可复核一致', () => {
    const rec = sealOne('equiv');
    const { result } = analyzeExample('equiv');
    expect(resultMatchesRecord(result, rec)).toBe(true);
  });

  it('结论来自另一对图 => 不一致', () => {
    const rec = sealOne('equiv');
    const { result } = analyzeExample('differ');
    expect(resultMatchesRecord(result, rec)).toBe(false);
  });
});

describe('本机存储：持久化与刷新复核', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('空存储 => 空的可信链', () => {
    const state = loadChain();
    expect(state.trusted).toBe(true);
    expect(state.records).toEqual([]);
  });

  it('persistChain 后 loadChain 逐条复核通过', () => {
    const r1 = sealOne('equiv');
    const r2 = sealOne('differ', [r1]);
    persistChain([r1, r2]);
    const state = loadChain();
    expect(state.trusted).toBe(true);
    expect(state.records).toEqual([r1, r2]);
  });

  it('存储内容被篡改 => 刷新后不可信', () => {
    const r1 = sealOne('equiv');
    persistChain([r1]);
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as {
      records: ReviewRecord[];
    };
    raw.records[0].reviewer = '被篡改';
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    const state = loadChain();
    expect(state.trusted).toBe(false);
    expect(state.brokenSeq).toBe(1);
  });

  it('存储不是合法 JSON => 不可信', () => {
    window.localStorage.setItem(STORAGE_KEY, '{oops');
    const state = loadChain();
    expect(state.trusted).toBe(false);
  });

  it('存储结构非法（缺 records 数组）=> 不可信', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1 }));
    const state = loadChain();
    expect(state.trusted).toBe(false);
  });

  it('清空后重新持久化 => 恢复为空可信链', () => {
    persistChain([sealOne('equiv')]);
    persistChain([]);
    const state = loadChain();
    expect(state.trusted).toBe(true);
    expect(state.records).toEqual([]);
  });
});
