import { useState } from 'react';
import type { ChainState, ReviewRecord } from '../review/chain';
import { TraceTable } from './TraceTable';

interface ReviewChainPanelProps {
  chain: ChainState;
  /** 当前仍“适用于当前草稿”的记录序号集合 */
  applicableSeqs: ReadonlySet<number>;
  /** 恢复某条记录的只读快照并重新比较 */
  onRestore: (record: ReviewRecord) => void;
}

function RecordDetail({ record }: { record: ReviewRecord }) {
  const traceA = record.trace.filter((t) => t.graph === 'A');
  const traceB = record.trace.filter((t) => t.graph === 'B');
  return (
    <div className="chain__detail" data-testid={`chain-detail-${record.seq}`}>
      <dl className="chain__fields">
        <dt>前序摘要</dt>
        <dd className="mono">{record.prevDigest}</dd>
        <dt>记录摘要</dt>
        <dd className="mono" data-testid={`chain-digest-${record.seq}`}>
          {record.digest}
        </dd>
        <dt>共享变量序</dt>
        <dd className="mono">[{record.variables.join(', ')}]</dd>
        <dt>结论</dt>
        <dd>
          {record.equivalent ? (
            'EQUIVALENT — 两图输出对所有输入恒等'
          ) : (
            <>
              NOT EQUIVALENT — 反例{' '}
              <span className="mono">
                {record.variables
                  .map((v) => `${v}=${record.counterexample[v]}`)
                  .join(', ')}
              </span>
              ，复算输出 旧图 A = {record.outputA} / 新图 B = {record.outputB}
            </>
          )}
        </dd>
        {record.note && (
          <>
            <dt>备注</dt>
            <dd>{record.note}</dd>
          </>
        )}
      </dl>
      <div className="traces">
        <TraceTable
          title="封存：旧图 A 逐门复算（拓扑顺序）"
          trace={traceA}
          outputId={record.graphA.output}
        />
        <TraceTable
          title="封存：新图 B 逐门复算（拓扑顺序）"
          trace={traceB}
          outputId={record.graphB.output}
        />
      </div>
    </div>
  );
}

/** 本机审查链面板：按序号展开封存记录，可恢复只读快照 */
export function ReviewChainPanel({
  chain,
  applicableSeqs,
  onRestore,
}: ReviewChainPanelProps) {
  const [openSeq, setOpenSeq] = useState<number | null>(null);
  const trusted = chain.status === 'ok';

  return (
    <section className="chain" data-testid="review-chain" data-status={chain.status}>
      <div className="chain__head">
        <h3>本机审查链（SHA-256 摘要串接）</h3>
        {trusted ? (
          <p className="chain__status chain__status--ok" data-testid="chain-status">
            链可信 · 共 {chain.records.length} 条封存 ·
            每次打开已逐条重算序号、前序摘要与记录摘要
          </p>
        ) : (
          <p className="chain__status chain__status--bad" data-testid="chain-status">
            链不可信：{chain.reason} —— 已停止新增封存
          </p>
        )}
      </div>

      {chain.records.length === 0 ? (
        <p className="chain__empty">
          尚无封存记录。完成一次比较后，可在结论下方「封存审查」。
        </p>
      ) : (
        <ol className="chain__list">
          {chain.records.map((r) => (
            <li
              key={r.seq}
              className="chain__item"
              data-testid={`chain-record-${r.seq}`}
            >
              <div className="chain__row">
                <span className="chain__seq mono">#{r.seq}</span>
                <span
                  className={`chain__verdict ${
                    r.equivalent
                      ? 'chain__verdict--ok'
                      : 'chain__verdict--bad'
                  }`}
                >
                  {r.equivalent ? 'EQUIVALENT' : 'NOT EQUIVALENT'}
                </span>
                <span className="chain__meta">
                  审查人 {r.reviewer} · {r.sealedAt}
                </span>
                {applicableSeqs.has(r.seq) && (
                  <span
                    className="chain__applicable"
                    data-testid={`applicable-${r.seq}`}
                  >
                    适用于当前草稿
                  </span>
                )}
                <span className="chain__digest mono" title={r.digest}>
                  摘要 {r.digest.slice(0, 12)}…
                </span>
                <button
                  type="button"
                  className="btn btn--mini"
                  onClick={() => setOpenSeq(openSeq === r.seq ? null : r.seq)}
                >
                  {openSeq === r.seq ? '收起' : '展开'}
                </button>
                <button
                  type="button"
                  className="btn btn--mini"
                  disabled={!trusted}
                  data-testid={`restore-${r.seq}`}
                  onClick={() => onRestore(r)}
                >
                  恢复快照
                </button>
              </div>
              {openSeq === r.seq && <RecordDetail record={r} />}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
