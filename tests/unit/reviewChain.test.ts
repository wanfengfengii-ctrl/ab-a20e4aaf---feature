import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/review/sha256';
import {
  buildRecord,
  canonical,
  CHAIN_STORAGE_KEY,
  GENESIS_DIGEST,
  loadChain,
  recordMatchesResult,
  saveChain,
  sealGraph,
  unsealGraph,
  verifyChain,
  type ChainStorage,
  type ReviewRecord,
} from '../../src/review/chain';
import { analyze } from '../../src/analysis';
import { validatePair } from '../../src/validation';
import type { AnalysisResult, Graph } from '../../src/types';

// ---------- 测试辅助 ----------

const A_JSON = JSON.stringify({
  nodes: [
    { id: 'a', type: 'INPUT', name: 'A' },
    { id: 'b', type: 'INPUT', name: 'B' },
    { id: 'c', type: 'INPUT', name: 'C' },
    { id: 'g1', type: 'AND', in: ['a', 'b'] },
    { id: 'g2', type: 'OR', in: ['g1', 'c'] },
  ],
  output: 'g2',
});

// 与 A 恒等：(A∧B)∨C ≡ (A∨C)∧(B∨C)
const B_EQUIV_JSON = JSON.stringify({
  nodes: [
    { id: 'x', type: 'INPUT', name: 'A' },
    { id: 'y', type: 'INPUT', name: 'B' },
    { id: 'z', type: 'INPUT', name: 'C' },
    { id: 'h1', type: 'OR', in: ['x', 'z'] },
    { id: 'h2', type: 'OR', in: ['y', 'z'] },
    { id: 'h3', type: 'AND', in: ['h1', 'h2'] },
  ],
  output: 'h3',
});

// 与 A 在 A=0,B=0,C=1 处分歧：A∧B
const B_DIFFER_JSON = JSON.stringify({
  nodes: [
    { id: 'x', type: 'INPUT', name: 'A' },
    { id: 'y', type: 'INPUT', name: 'B' },
    { id: 'h1', type: 'AND', in: ['x', 'y'] },
  ],
  output: 'h1',
});

function compare(textA: string, textB: string) {
  const { graphA, graphB, errors } = validatePair(textA, textB);
  if (errors.length > 0 || !graphA || !graphB) {
    throw new Error('测试用门图应当合法');
  }
  return { graphA, graphB, result: analyze(graphA, graphB) };
}

function makeRecord(
  records: ReviewRecord[],
  textA: string,
  textB: string,
  reviewer = '张工',
): { record: ReviewRecord; graphA: Graph; graphB: Graph; result: AnalysisResult } {
  const { graphA, graphB, result } = compare(textA, textB);
  const record = buildRecord(records, {
    reviewer,
    note: '换班前封存',
    graphA,
    graphB,
    result,
    sealedAt: '2026-09-25T08:00:00.000Z',
  });
  return { record, graphA, graphB, result };
}

function memStorage(): ChainStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => void data.set(k, v),
  };
}

// ---------- SHA-256 ----------

describe('sha256Hex 标准测试向量', () => {
  it('空串 / abc / 多块消息 / 中文（UTF-8）', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(
      sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    ).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(sha256Hex('审查')).toBe(
      '747dd85101cbcd7423b1ea4c4e85731e4e921ec82acc96e0a8c55eec7f4d879f',
    );
  });
});

// ---------- canonical ----------

describe('canonical 规范化序列化', () => {
  it('对象键序无关，内容相同则串相同', () => {
    const a = canonical({ b: 1, a: { d: [1, 2], c: 'x' } });
    const b = canonical({ a: { c: 'x', d: [1, 2] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
  });

  it('忽略 undefined 值', () => {
    expect(canonical({ a: undefined, b: 0 })).toBe('{"b":0}');
  });
});

// ---------- 封存与链校验 ----------

describe('buildRecord / verifyChain', () => {
  it('首条记录序号为 1，前序摘要为 GENESIS；第二条串接首条摘要', () => {
    const r1 = makeRecord([], A_JSON, B_EQUIV_JSON).record;
    expect(r1.seq).toBe(1);
    expect(r1.prevDigest).toBe(GENESIS_DIGEST);
    expect(r1.digest).toMatch(/^[0-9a-f]{64}$/);

    const r2 = makeRecord([r1], A_JSON, B_DIFFER_JSON, '李工').record;
    expect(r2.seq).toBe(2);
    expect(r2.prevDigest).toBe(r1.digest);
    expect(r2.digest).not.toBe(r1.digest);

    expect(verifyChain([r1, r2])).toEqual({ ok: true });
  });

  it('等价与反例封存内容完整（图、变量序、结论、反例、逐门复算）', () => {
    const eq = makeRecord([], A_JSON, B_EQUIV_JSON).record;
    expect(eq.equivalent).toBe(true);
    expect(eq.variables).toEqual(['A', 'B', 'C']);
    expect(eq.trace.length).toBeGreaterThan(0);
    expect(eq.graphA.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c', 'g1', 'g2']);

    const diff = makeRecord([], A_JSON, B_DIFFER_JSON).record;
    expect(diff.equivalent).toBe(false);
    expect(diff.counterexample).toEqual({ A: 0, B: 0, C: 1 });
    expect(diff.outputA).toBe(1);
    expect(diff.outputB).toBe(0);
  });

  it('篡改记录内容 => 记录摘要重算不一致', () => {
    const r1 = makeRecord([], A_JSON, B_EQUIV_JSON).record;
    const tampered: ReviewRecord = { ...r1, note: '被篡改的备注' };
    const check = verifyChain([tampered]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('记录摘要重算不一致');
  });

  it('篡改序号 => 序号重算不一致', () => {
    const r1 = makeRecord([], A_JSON, B_EQUIV_JSON).record;
    const tampered: ReviewRecord = { ...r1, seq: 7 };
    const check = verifyChain([tampered]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('序号重算不一致');
  });

  it('篡改前序摘要 => 前序摘要重算不一致', () => {
    const r1 = makeRecord([], A_JSON, B_EQUIV_JSON).record;
    const r2 = makeRecord([r1], A_JSON, B_DIFFER_JSON).record;
    const tampered: ReviewRecord = { ...r2, prevDigest: r2.digest };
    const check = verifyChain([r1, tampered]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('前序摘要重算不一致');
  });

  it('抽掉首条记录 => 链不再可信', () => {
    const r1 = makeRecord([], A_JSON, B_EQUIV_JSON).record;
    const r2 = makeRecord([r1], A_JSON, B_DIFFER_JSON).record;
    expect(verifyChain([r2]).ok).toBe(false);
  });

  it('字段结构非法 => 不可信', () => {
    const r1 = makeRecord([], A_JSON, B_EQUIV_JSON).record;
    const broken = { ...r1, digest: 'not-hex' } as unknown as ReviewRecord;
    const check = verifyChain([broken]);
    expect(check.ok).toBe(false);
  });
});

// ---------- 刷新恢复（localStorage 往返） ----------

describe('loadChain / saveChain 刷新复核', () => {
  it('写入后重新加载：逐条重算通过，链可信', () => {
    const storage = memStorage();
    const r1 = makeRecord([], A_JSON, B_EQUIV_JSON).record;
    const r2 = makeRecord([r1], A_JSON, B_DIFFER_JSON).record;
    saveChain(storage, [r1, r2]);

    const loaded = loadChain(storage);
    expect(loaded.status).toBe('ok');
    expect(loaded.records.map((r) => r.seq)).toEqual([1, 2]);
    expect(loaded.records[1].prevDigest).toBe(r1.digest);
  });

  it('空存储 => 空的可信链', () => {
    expect(loadChain(memStorage())).toEqual({ status: 'ok', records: [] });
  });

  it('数据被篡改 => 不可信并给出原因', () => {
    const storage = memStorage();
    const r1 = makeRecord([], A_JSON, B_EQUIV_JSON).record;
    saveChain(storage, [r1]);
    const raw = JSON.parse(storage.data.get(CHAIN_STORAGE_KEY)!);
    raw.records[0].reviewer = '篡改者';
    storage.data.set(CHAIN_STORAGE_KEY, JSON.stringify(raw));

    const loaded = loadChain(storage);
    expect(loaded.status).toBe('untrusted');
    if (loaded.status === 'untrusted') {
      expect(loaded.reason).toContain('记录摘要重算不一致');
    }
  });

  it('存储内容不是 JSON / 缺 records => 不可信', () => {
    const s1 = memStorage();
    s1.setItem(CHAIN_STORAGE_KEY, '{oops');
    expect(loadChain(s1).status).toBe('untrusted');

    const s2 = memStorage();
    s2.setItem(CHAIN_STORAGE_KEY, JSON.stringify({ version: 1 }));
    expect(loadChain(s2).status).toBe('untrusted');
  });
});

// ---------- 适用于当前草稿 / 恢复一致性 ----------

describe('recordMatchesResult', () => {
  it('同一比较复算结果与封存一致（等价与反例）', () => {
    const eq = makeRecord([], A_JSON, B_EQUIV_JSON);
    expect(
      recordMatchesResult(eq.record, eq.graphA, eq.graphB, eq.result),
    ).toBe(true);

    const diff = makeRecord([], A_JSON, B_DIFFER_JSON);
    expect(
      recordMatchesResult(diff.record, diff.graphA, diff.graphB, diff.result),
    ).toBe(true);
  });

  it('草稿变化（换了新图）=> 不再匹配', () => {
    const eq = makeRecord([], A_JSON, B_EQUIV_JSON);
    const other = compare(A_JSON, B_DIFFER_JSON);
    expect(
      recordMatchesResult(eq.record, other.graphA, other.graphB, other.result),
    ).toBe(false);
  });

  it('结论/反例变化 => 不再匹配', () => {
    const eq = makeRecord([], A_JSON, B_EQUIV_JSON);
    const diff = compare(A_JSON, B_DIFFER_JSON);
    // 图仍用等价那对，但结论换成反例结论：必须判不匹配
    expect(
      recordMatchesResult(eq.record, eq.graphA, eq.graphB, diff.result),
    ).toBe(false);
  });
});

// ---------- 快照文本往返 ----------

describe('unsealGraph 快照往返', () => {
  it('规范化门图 -> JSON 文本 -> 校验后得到相同规范化内容', () => {
    const { graphA } = compare(A_JSON, B_EQUIV_JSON);
    const sealed = sealGraph(graphA);
    const text = unsealGraph(sealed);
    const { graphA: again, errors } = validatePair(text, B_EQUIV_JSON);
    expect(errors).toEqual([]);
    expect(sealGraph(again!)).toEqual(sealed);
  });
});
