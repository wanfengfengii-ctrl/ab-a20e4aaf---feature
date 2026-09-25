// 本机审查链：把一次成功比较的可复算结论封存为逐条串接的 SHA-256 链。
//
// 规则（需求）：
//  - 只有校验全过且完成比较的结论才能封存；输入错误/整次拒绝/未比较不产生记录；
//  - 记录绑定：两图规范化内容、共享变量序、等价结论或反例、逐门复算摘要、
//    审查人与备注；
//  - 记录摘要 = SHA-256(规范化序列化(记录正文 + 前序摘要))，首条前序摘要为
//    64 个 '0'（GENESIS）；刷新恢复时逐条重算序号、前序摘要与记录摘要，
//    任一不一致即整链不可信并停止新增封存；
//  - 封存后若当前草稿、比较结论或反例发生变化，记录不再标作“适用于当前草稿”。

import type { AnalysisResult, GateEval, Graph, NodeType } from '../types';
import { sha256Hex } from './sha256';

/** localStorage 键：本机审查链唯一存储位置 */
export const CHAIN_STORAGE_KEY = 'interlocking.reviewChain.v1';

/** 首条记录的前序摘要（创世占位） */
export const GENESIS_DIGEST = '0'.repeat(64);

/** 封存用的规范化节点：name 缺省统一为 null，in 复制为纯字符串数组 */
export interface SealedNode {
  id: string;
  type: NodeType;
  name: string | null;
  in: string[];
}

/** 封存用的规范化门图 */
export interface SealedGraph {
  nodes: SealedNode[];
  output: string;
}

/** 一条封存记录（digest 为对其余全部字段的 SHA-256） */
export interface ReviewRecord {
  /** 链内序号，从 1 开始连续 */
  seq: number;
  /** 封存时刻（ISO 8601） */
  sealedAt: string;
  reviewer: string;
  note: string;
  graphA: SealedGraph;
  graphB: SealedGraph;
  /** 共享变量序（ASCII 升序） */
  variables: string[];
  equivalent: boolean;
  /** 等价时为全 0 占位；不等价时为唯一反例 */
  counterexample: Record<string, 0 | 1>;
  outputA: 0 | 1;
  outputB: 0 | 1;
  /** 反例/占位赋值下两图逐门复算摘要（拓扑顺序） */
  trace: GateEval[];
  /** 前一条记录的 digest；首条为 GENESIS_DIGEST */
  prevDigest: string;
  /** 本记录摘要：SHA-256(canonical(除 digest 外的全部字段)) */
  digest: string;
}

export type ChainState =
  | { status: 'ok'; records: ReviewRecord[] }
  | { status: 'untrusted'; records: ReviewRecord[]; reason: string };

/**
 * 确定性规范化序列化：对象键按字典序排序、忽略 undefined，
 * 数组保持顺序。同一逻辑内容必得同一字符串，是摘要可复算的前提。
 */
export function canonical(value: unknown): string {
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonical(v)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  }
  throw new Error(`无法规范化序列化的值：${String(value)}`);
}

/** Graph -> 封存用规范化门图 */
export function sealGraph(graph: Graph): SealedGraph {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name ?? null,
      in: [...n.in],
    })),
    output: graph.output,
  };
}

/** 规范化门图 -> 可重新粘贴/校验的 JSON 文本（恢复快照用） */
export function unsealGraph(sealed: SealedGraph): string {
  const nodes = sealed.nodes.map((n) => {
    const node: Record<string, unknown> = { id: n.id, type: n.type };
    if (n.name !== null) node.name = n.name;
    if (n.in.length > 0) node.in = [...n.in];
    return node;
  });
  return JSON.stringify({ nodes, output: sealed.output }, null, 2);
}

/** 逐门复算摘要规范化（复制为纯数据，避免引用外部对象） */
export function sealTrace(trace: GateEval[]): GateEval[] {
  return trace.map((t) => ({
    graph: t.graph,
    id: t.id,
    type: t.type,
    inputs: t.inputs.map((x) => ({ id: x.id, value: x.value })),
    value: t.value,
  }));
}

/** 记录摘要：对除 digest 外的全部字段做规范化序列化后取 SHA-256 */
export function recordDigest(record: ReviewRecord): string {
  const body: Record<string, unknown> = { ...record };
  delete body.digest;
  return sha256Hex(canonical(body));
}

export interface SealInput {
  reviewer: string;
  note: string;
  graphA: Graph;
  graphB: Graph;
  result: AnalysisResult;
  sealedAt: string;
}

/** 在既有链尾追加一条记录（纯函数，不写存储） */
export function buildRecord(
  records: ReviewRecord[],
  input: SealInput,
): ReviewRecord {
  const body = {
    seq: records.length + 1,
    sealedAt: input.sealedAt,
    reviewer: input.reviewer,
    note: input.note,
    graphA: sealGraph(input.graphA),
    graphB: sealGraph(input.graphB),
    variables: [...input.result.variables],
    equivalent: input.result.equivalent,
    counterexample: { ...input.result.counterexample },
    outputA: input.result.outputA,
    outputB: input.result.outputB,
    trace: sealTrace(input.result.trace),
    prevDigest:
      records.length === 0
        ? GENESIS_DIGEST
        : records[records.length - 1].digest,
  };
  return { ...body, digest: sha256Hex(canonical(body)) };
}

const HEX64 = /^[0-9a-f]{64}$/;

function isBit(x: unknown): x is 0 | 1 {
  return x === 0 || x === 1;
}

function isSealedGraph(g: unknown): g is SealedGraph {
  if (g === null || typeof g !== 'object') return false;
  const s = g as SealedGraph;
  return (
    Array.isArray(s.nodes) &&
    typeof s.output === 'string' &&
    s.nodes.every(
      (n) =>
        n !== null &&
        typeof n === 'object' &&
        typeof n.id === 'string' &&
        typeof n.type === 'string' &&
        (n.name === null || typeof n.name === 'string') &&
        Array.isArray(n.in) &&
        n.in.every((r: unknown) => typeof r === 'string'),
    )
  );
}

/** 记录结构完整性检查（刷新恢复时先验形，再验链） */
function isRecordShape(r: unknown): r is ReviewRecord {
  if (r === null || typeof r !== 'object') return false;
  const rec = r as ReviewRecord;
  return (
    typeof rec.seq === 'number' &&
    Number.isInteger(rec.seq) &&
    typeof rec.sealedAt === 'string' &&
    typeof rec.reviewer === 'string' &&
    typeof rec.note === 'string' &&
    isSealedGraph(rec.graphA) &&
    isSealedGraph(rec.graphB) &&
    Array.isArray(rec.variables) &&
    rec.variables.every((v) => typeof v === 'string') &&
    typeof rec.equivalent === 'boolean' &&
    rec.counterexample !== null &&
    typeof rec.counterexample === 'object' &&
    Object.values(rec.counterexample).every(isBit) &&
    isBit(rec.outputA) &&
    isBit(rec.outputB) &&
    Array.isArray(rec.trace) &&
    typeof rec.prevDigest === 'string' &&
    HEX64.test(rec.prevDigest) &&
    typeof rec.digest === 'string' &&
    HEX64.test(rec.digest)
  );
}

export type ChainVerification = { ok: true } | { ok: false; reason: string };

/**
 * 逐条重算序号、前序摘要与记录摘要。
 * 任一不一致即整链不可信（调用方须停止新增封存）。
 */
export function verifyChain(records: ReviewRecord[]): ChainVerification {
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!isRecordShape(r)) {
      return { ok: false, reason: `第 ${i + 1} 条记录结构不完整或字段非法` };
    }
    if (r.seq !== i + 1) {
      return {
        ok: false,
        reason: `第 ${i + 1} 条记录序号重算不一致（记录为 ${r.seq}）`,
      };
    }
    const expectedPrev = i === 0 ? GENESIS_DIGEST : records[i - 1].digest;
    if (r.prevDigest !== expectedPrev) {
      return { ok: false, reason: `第 ${i + 1} 条记录前序摘要重算不一致` };
    }
    if (recordDigest(r) !== r.digest) {
      return { ok: false, reason: `第 ${i + 1} 条记录摘要重算不一致` };
    }
  }
  return { ok: true };
}

/** 存储接口（localStorage 的最小子集，便于单元测试注入假存储） */
export interface ChainStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 刷新恢复：读取本机审查链并逐条重算校验 */
export function loadChain(storage: ChainStorage): ChainState {
  const raw = storage.getItem(CHAIN_STORAGE_KEY);
  if (raw === null) return { status: 'ok', records: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: 'untrusted',
      records: [],
      reason: '本机审查链数据无法解析为 JSON',
    };
  }

  const records = (parsed as { records?: unknown } | null)?.records;
  if (!Array.isArray(records)) {
    return {
      status: 'untrusted',
      records: [],
      reason: '本机审查链数据格式非法（缺少 records 数组）',
    };
  }

  const check = verifyChain(records as ReviewRecord[]);
  if (!check.ok) {
    return {
      status: 'untrusted',
      records: records as ReviewRecord[],
      reason: check.reason,
    };
  }
  return { status: 'ok', records: records as ReviewRecord[] };
}

/** 追加封存后整链写回本机存储 */
export function saveChain(
  storage: ChainStorage,
  records: ReviewRecord[],
): void {
  storage.setItem(CHAIN_STORAGE_KEY, JSON.stringify({ version: 1, records }));
}

/**
 * 记录内容是否与一次（重新）比较的结论完全一致：
 * 两图规范化内容、变量序、等价结论、反例、两输出与逐门复算摘要全部相同。
 * 用于“适用于当前草稿”标记与快照恢复后的一致性核对。
 */
export function recordMatchesResult(
  record: ReviewRecord,
  graphA: Graph,
  graphB: Graph,
  result: AnalysisResult,
): boolean {
  return (
    record.equivalent === result.equivalent &&
    record.outputA === result.outputA &&
    record.outputB === result.outputB &&
    canonical(record.variables) === canonical(result.variables) &&
    canonical(record.counterexample) === canonical(result.counterexample) &&
    canonical(record.graphA) === canonical(sealGraph(graphA)) &&
    canonical(record.graphB) === canonical(sealGraph(graphB)) &&
    canonical(record.trace) === canonical(sealTrace(result.trace))
  );
}
