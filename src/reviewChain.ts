// 本机审查链：把一次成功比较的结论封存为带 SHA-256 摘要的链式记录。
//
// 设计约束（对应需求）：
//  - 记录绑定：两份通过校验的门图规范化内容、共享变量序、等价结论或反例、
//    逐门复算摘要、审查人与备注；
//  - 链式结构：seq 从 1 递增，prevDigest 串接前序记录摘要（首条为
//    GENESIS_DIGEST），digest = SHA-256(记录除 digest 外的规范化序列化)；
//    全程无随机数、无时间戳，同一内容必得同一摘要；
//  - 刷新恢复时逐条重算序号、前序摘要与记录摘要，任一不一致即整链不可信，
//    由调用方停止新增封存；
//  - 纯本机：localStorage 持久化，不调用任何业务后端或在线服务。

import { canonicalize } from './canonical';
import { sha256Hex } from './sha256';
import type { AnalysisResult, GateEval, Graph } from './types';

/** localStorage 键（版本化，结构变更时整体切换） */
export const STORAGE_KEY = 'interlocking-workbench.review-chain.v1';

/** 首条记录的前序摘要（链起点） */
export const GENESIS_DIGEST = '0'.repeat(64);

/** 一条封存记录；digest 覆盖除自身外的全部字段 */
export interface ReviewRecord {
  seq: number;
  prevDigest: string;
  reviewer: string;
  remark: string;
  graphA: Graph;
  graphB: Graph;
  /** 共享变量序（ASCII 升序） */
  variables: string[];
  equivalent: boolean;
  /** 等价时为全 0 占位；不等价时为唯一反例 */
  counterexample: Record<string, 0 | 1>;
  outputA: 0 | 1;
  outputB: 0 | 1;
  /** 逐门复算摘要（两图、拓扑顺序） */
  trace: GateEval[];
  digest: string;
}

/** 链校验结果；不可信时 brokenSeq 为第一条不一致记录的序号（1 起） */
export interface ChainState {
  trusted: boolean;
  records: ReviewRecord[];
  brokenSeq?: number;
  reason?: string;
}

/** 记录摘要：SHA-256(规范化序列化(记录除 digest 外的内容)) */
export function recordDigest(rec: Omit<ReviewRecord, 'digest'>): string {
  return sha256Hex(canonicalize(rec));
}

export interface SealInput {
  graphA: Graph;
  graphB: Graph;
  result: AnalysisResult;
  reviewer: string;
  remark: string;
}

/** 在既有链尾构造一条封存记录（纯函数，不落盘、不改既有记录） */
export function sealRecord(
  existing: ReviewRecord[],
  input: SealInput,
): ReviewRecord {
  const base: Omit<ReviewRecord, 'digest'> = {
    seq: existing.length + 1,
    prevDigest:
      existing.length === 0
        ? GENESIS_DIGEST
        : existing[existing.length - 1].digest,
    reviewer: input.reviewer,
    remark: input.remark,
    graphA: input.graphA,
    graphB: input.graphB,
    variables: input.result.variables,
    equivalent: input.result.equivalent,
    counterexample: input.result.counterexample,
    outputA: input.result.outputA,
    outputB: input.result.outputB,
    trace: input.result.trace,
  };
  return { ...base, digest: recordDigest(base) };
}

/** 逐条重算序号、前序摘要与记录摘要；任一不一致即整链不可信 */
export function verifyRecords(records: ReviewRecord[]): ChainState {
  let prev = GENESIS_DIGEST;
  for (let i = 0; i < records.length; i++) {
    const seq = i + 1;
    const rec = records[i];
    const fail = (reason: string): ChainState => ({
      trusted: false,
      records,
      brokenSeq: seq,
      reason,
    });
    if (rec === null || typeof rec !== 'object') {
      return fail('记录结构非法');
    }
    if (rec.seq !== seq) {
      return fail(`序号不连续（期望 ${seq}）`);
    }
    if (rec.prevDigest !== prev) {
      return fail('前序摘要与链不匹配');
    }
    let expected: string;
    try {
      const { digest, ...rest } = rec;
      expected = recordDigest(rest);
    } catch {
      return fail('记录内容无法规范化');
    }
    if (rec.digest !== expected) {
      return fail('记录摘要与内容不匹配');
    }
    prev = rec.digest;
  }
  return { trusted: true, records };
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** 从本机存储读出审查链并逐条复核；无记录时为空的可信链 */
export function loadChain(storage?: Storage): ChainState {
  const store = storage ?? safeStorage();
  if (!store) return { trusted: true, records: [] };

  let rawText: string | null = null;
  try {
    rawText = store.getItem(STORAGE_KEY);
  } catch {
    return { trusted: true, records: [] };
  }
  if (rawText === null) return { trusted: true, records: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { trusted: false, records: [], reason: '审查链数据不是合法 JSON' };
  }
  const records = (parsed as { records?: unknown } | null)?.records;
  if (!Array.isArray(records)) {
    return { trusted: false, records: [], reason: '审查链数据结构非法' };
  }
  return verifyRecords(records as ReviewRecord[]);
}

/** 把审查链写入本机存储；存储不可用时链仍保留在内存中 */
export function persistChain(records: ReviewRecord[], storage?: Storage): void {
  const store = storage ?? safeStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ version: 1, records }));
  } catch {
    // 隐私模式/配额不足等：本次运行内链仍可用，刷新后按存储内容复核
  }
}

/** 当前草稿与当前结论构成的绑定；用于判定记录是否仍适用于当前草稿 */
export interface CurrentBinding {
  graphA: Graph;
  graphB: Graph;
  result: AnalysisResult;
}

/**
 * 记录是否仍适用于当前草稿：
 * 两份草稿的规范化内容、共享变量序、等价结论与反例均须与封存一致；
 * 草稿被改动、校验失败或尚未完成比较（current 为 null）时一律不适用。
 */
export function recordAppliesTo(
  rec: ReviewRecord,
  current: CurrentBinding | null,
): boolean {
  if (current === null) return false;
  return (
    rec.equivalent === current.result.equivalent &&
    rec.outputA === current.result.outputA &&
    rec.outputB === current.result.outputB &&
    canonicalize(rec.variables) === canonicalize(current.result.variables) &&
    canonicalize(rec.counterexample) ===
      canonicalize(current.result.counterexample) &&
    canonicalize(rec.graphA) === canonicalize(current.graphA) &&
    canonicalize(rec.graphB) === canonicalize(current.graphB)
  );
}

/**
 * 复核结论是否与封存内容一致（恢复快照后再次比较的自检）：
 * 比较结论/反例/输出/变量序/逐门复算摘要全部一致才算一致。
 */
export function resultMatchesRecord(
  result: AnalysisResult,
  rec: ReviewRecord,
): boolean {
  return (
    rec.equivalent === result.equivalent &&
    rec.outputA === result.outputA &&
    rec.outputB === result.outputB &&
    canonicalize(rec.variables) === canonicalize(result.variables) &&
    canonicalize(rec.counterexample) ===
      canonicalize(result.counterexample) &&
    canonicalize(rec.trace) === canonicalize(result.trace)
  );
}
