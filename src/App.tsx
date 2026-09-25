import { useMemo, useState } from 'react';
import { analyze } from './analysis';
import { canonicalize } from './canonical';
import {
  loadChain,
  persistChain,
  recordAppliesTo,
  resultMatchesRecord,
  sealRecord,
  type ChainState,
  type CurrentBinding,
  type ReviewRecord,
} from './reviewChain';
import { validatePair } from './validation';
import type { AnalysisResult, GateEval, Graph, GraphError } from './types';
import { GraphSvg } from './components/GraphSvg';
import { EXAMPLES } from './examples';

type View =
  | { status: 'idle' }
  | { status: 'error'; errors: GraphError[] }
  | { status: 'ok'; graphA: Graph; graphB: Graph; result: AnalysisResult };

function traceValues(trace: GateEval[]): Map<string, 0 | 1> {
  return new Map(trace.map((t) => [t.id, t.value]));
}

function TraceTable({
  trace,
  outputId,
  title,
}: {
  trace: GateEval[];
  outputId: string;
  title: string;
}) {
  return (
    <div className="trace">
      <h4>{title}</h4>
      <table className="trace__table">
        <thead>
          <tr>
            <th>#</th>
            <th>节点 id</th>
            <th>类型</th>
            <th>入边（id = 复算值）</th>
            <th>输出</th>
          </tr>
        </thead>
        <tbody>
          {trace.map((t, i) => (
            <tr
              key={`${t.graph}-${t.id}`}
              className={t.id === outputId ? 'trace__row--output' : ''}
            >
              <td>{i + 1}</td>
              <td className="mono">{t.id}</td>
              <td className="mono">{t.type}</td>
              <td className="mono">
                {t.inputs.length === 0
                  ? '—'
                  : t.inputs.map((x) => `${x.id}=${x.value}`).join(', ')}
              </td>
              <td className="mono trace__value">{t.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 单条封存记录（可展开查看绑定内容并恢复只读快照） */
function ChainRecord({
  rec,
  applies,
  onRestore,
}: {
  rec: ReviewRecord;
  applies: boolean;
  onRestore: (rec: ReviewRecord) => void;
}) {
  const traceA = rec.trace.filter((t) => t.graph === 'A');
  const traceB = rec.trace.filter((t) => t.graph === 'B');
  return (
    <li className="chain__item" data-testid={`chain-record-${rec.seq}`}>
      <details>
        <summary>
          <span className="mono chain__seq">#{rec.seq}</span>
          <span
            className={`chain__verdict ${
              rec.equivalent ? 'chain__verdict--ok' : 'chain__verdict--bad'
            }`}
          >
            {rec.equivalent ? 'EQUIVALENT' : 'NOT EQUIVALENT'}
          </span>
          <span className="chain__reviewer">审查人：{rec.reviewer}</span>
          <span className="mono chain__digest">
            摘要 {rec.digest.slice(0, 12)}…
          </span>
          {applies && (
            <span className="chain__applies" data-testid={`applies-${rec.seq}`}>
              适用于当前草稿
            </span>
          )}
        </summary>
        <div className="chain__body">
          <p className="chain__kv">
            备注：{rec.remark === '' ? '（无）' : rec.remark}
          </p>
          <p className="chain__kv">
            共享变量序：<span className="mono">[{rec.variables.join(', ')}]</span>
          </p>
          {rec.equivalent ? (
            <p className="chain__kv">
              复算输出（全 0 自检赋值）：旧图 A ={' '}
              <span className="mono">{rec.outputA}</span>，新图 B ={' '}
              <span className="mono">{rec.outputB}</span>
            </p>
          ) : (
            <p className="chain__kv">
              反例：
              <span className="mono">
                {rec.variables
                  .map((v) => `${v}=${rec.counterexample[v]}`)
                  .join(', ')}
              </span>
              {' · '}复算输出：旧图 A ={' '}
              <span className="mono">{rec.outputA}</span>，新图 B ={' '}
              <span className="mono">{rec.outputB}</span>
            </p>
          )}
          <div className="chain__graphs">
            <div>
              <h5>旧图 A 规范化内容</h5>
              <pre className="chain__pre">
                {JSON.stringify(
                  { nodes: rec.graphA.nodes, output: rec.graphA.output },
                  null,
                  2,
                )}
              </pre>
            </div>
            <div>
              <h5>新图 B 规范化内容</h5>
              <pre className="chain__pre">
                {JSON.stringify(
                  { nodes: rec.graphB.nodes, output: rec.graphB.output },
                  null,
                  2,
                )}
              </pre>
            </div>
          </div>
          <h5>逐门复算摘要</h5>
          <div className="chain__traces">
            <TraceTable
              title="封存 · 旧图 A（逐门复算摘要）"
              trace={traceA}
              outputId={rec.graphA.output}
            />
            <TraceTable
              title="封存 · 新图 B（逐门复算摘要）"
              trace={traceB}
              outputId={rec.graphB.output}
            />
          </div>
          <p className="chain__kv">
            前序摘要：
            <span className="mono" data-testid={`prevdigest-${rec.seq}`}>
              {rec.prevDigest}
            </span>
          </p>
          <p className="chain__kv">
            记录摘要：
            <span className="mono" data-testid={`digest-${rec.seq}`}>
              {rec.digest}
            </span>
          </p>
          <button
            type="button"
            className="btn"
            data-testid={`restore-${rec.seq}`}
            onClick={() => onRestore(rec)}
          >
            恢复只读快照
          </button>
        </div>
      </details>
    </li>
  );
}

export function App() {
  const [textA, setTextA] = useState('');
  const [textB, setTextB] = useState('');
  const [view, setView] = useState<View>({ status: 'idle' });
  // 本机审查链：挂载时从 localStorage 读出并逐条复核（序号/前序摘要/记录摘要）
  const [chain, setChain] = useState<ChainState>(() => loadChain());
  const [reviewer, setReviewer] = useState('');
  const [remark, setRemark] = useState('');
  // 只读快照模式：编辑区锁定为某条封存记录的内容，退出时还原之前的草稿
  const [snapshot, setSnapshot] = useState<{
    seq: number;
    savedA: string;
    savedB: string;
  } | null>(null);

  const readOnly = snapshot !== null;

  // 任一错误整次拒绝：只有在校验全过后才保留门图与结论
  const run = () => {
    const { graphA, graphB, errors } = validatePair(textA, textB);
    if (errors.length > 0 || !graphA || !graphB) {
      setView({ status: 'error', errors });
      return;
    }
    const result = analyze(graphA, graphB);
    setView({ status: 'ok', graphA, graphB, result });
  };

  const clearAll = () => {
    setTextA('');
    setTextB('');
    setView({ status: 'idle' });
  };

  const loadExample = (key: keyof typeof EXAMPLES) => {
    const ex = EXAMPLES[key];
    setTextA(ex.a);
    setTextB(ex.b);
    setView({ status: 'idle' });
  };

  // 当前草稿 + 当前结论构成的绑定：草稿在比较后被改动、校验失败或
  // 尚未完成比较时为 null（此时任何记录都不得标作适用于当前草稿）
  const currentBinding: CurrentBinding | null = useMemo(() => {
    if (view.status !== 'ok') return null;
    const { graphA, graphB, errors } = validatePair(textA, textB);
    if (errors.length > 0 || !graphA || !graphB) return null;
    if (
      canonicalize(graphA) !== canonicalize(view.graphA) ||
      canonicalize(graphB) !== canonicalize(view.graphB)
    ) {
      return null;
    }
    return { graphA, graphB, result: view.result };
  }, [view, textA, textB]);

  const snapshotRecord = snapshot
    ? chain.records.find((r) => r.seq === snapshot.seq)
    : undefined;

  // 封存审查：仅在一次成功比较之后、链可信且非快照模式下可用
  const seal = () => {
    if (view.status !== 'ok' || !chain.trusted || readOnly) return;
    const name = reviewer.trim();
    if (name.length === 0) return;
    const rec = sealRecord(chain.records, {
      graphA: view.graphA,
      graphB: view.graphB,
      result: view.result,
      reviewer: name,
      remark: remark.trim(),
    });
    const records = [...chain.records, rec];
    persistChain(records);
    setChain({ trusted: true, records });
    setRemark('');
  };

  // 恢复某条记录的只读快照并立即复核一次；退出快照可还原之前的草稿
  const restoreSnapshot = (rec: ReviewRecord) => {
    setSnapshot((prev) => ({
      seq: rec.seq,
      savedA: prev ? prev.savedA : textA,
      savedB: prev ? prev.savedB : textB,
    }));
    setTextA(
      JSON.stringify({ nodes: rec.graphA.nodes, output: rec.graphA.output }, null, 2),
    );
    setTextB(
      JSON.stringify({ nodes: rec.graphB.nodes, output: rec.graphB.output }, null, 2),
    );
    const result = analyze(rec.graphA, rec.graphB);
    setView({ status: 'ok', graphA: rec.graphA, graphB: rec.graphB, result });
  };

  const exitSnapshot = () => {
    if (!snapshot) return;
    setTextA(snapshot.savedA);
    setTextB(snapshot.savedB);
    setSnapshot(null);
    setView({ status: 'idle' });
  };

  // 链不可信时允许清空本机存储重新开始（仅本机数据）
  const clearBrokenChain = () => {
    persistChain([]);
    setChain({ trusted: true, records: [] });
  };

  const traceA =
    view.status === 'ok'
      ? view.result.trace.filter((t) => t.graph === 'A')
      : [];
  const traceB =
    view.status === 'ok'
      ? view.result.trace.filter((t) => t.graph === 'B')
      : [];

  return (
    <div className="app">
      <header className="app__header">
        <h1>联锁控制器门图等价性工作台</h1>
        <p className="app__subtitle">
          纯前端 · ROBDD（ASCII 变量序唯一表/计算表/约简/Apply）·
          异或根为 0 即等价，否则直接读取根节点最小满足赋值摘要作为唯一反例 ·
          结论可封存为本机 SHA-256 审查链
        </p>
      </header>

      {snapshot && (
        <section className="snapshot-banner" data-testid="snapshot-banner">
          <span>
            只读快照：封存记录 #{snapshot.seq}
            {snapshotRecord ? `（审查人：${snapshotRecord.reviewer}）` : ''}
            。编辑区已锁定，可直接「校验并比较」复核；结论须与封存内容一致。
          </span>
          <button type="button" className="btn" onClick={exitSnapshot}>
            退出快照
          </button>
        </section>
      )}

      <section className="editors">
        <div className="editor">
          <div className="editor__bar">
            <label htmlFor="ta-a">旧图 A（优先）</label>
            <div className="editor__examples">
              {(['equiv', 'differ', 'errors'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className="btn btn--mini"
                  onClick={() => loadExample(k)}
                  disabled={readOnly}
                >
                  {EXAMPLES[k].label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            id="ta-a"
            className="editor__area"
            spellCheck={false}
            value={textA}
            onChange={(e) => setTextA(e.target.value)}
            placeholder='{"nodes":[...],"output":"..."}'
            readOnly={readOnly}
          />
        </div>
        <div className="editor">
          <div className="editor__bar">
            <label htmlFor="ta-b">新图 B</label>
          </div>
          <textarea
            id="ta-b"
            className="editor__area"
            spellCheck={false}
            value={textB}
            onChange={(e) => setTextB(e.target.value)}
            placeholder='{"nodes":[...],"output":"..."}'
            readOnly={readOnly}
          />
        </div>
      </section>

      <section className="actions">
        <button type="button" className="btn btn--primary" onClick={run}>
          校验并比较
        </button>
        <button type="button" className="btn" onClick={clearAll} disabled={readOnly}>
          清空
        </button>
      </section>

      {view.status === 'error' && (
        <section className="errors" data-testid="errors">
          <h3>本次输入被整次拒绝（共 {view.errors.length} 项错误）</h3>
          <p className="errors__hint">
            按旧图优先、图内 nodes 下标升序汇总；旧结论与图形已清空。
          </p>
          <ol className="errors__list">
            {view.errors.map((e, i) => (
              <li key={i} className={`error error--${e.kind}`}>
                <span className="error__tag">{e.graph}</span>
                <span className="error__kind">{e.kind}</span>
                {e.nodeId && <span className="error__node mono">{e.nodeId}</span>}
                <span className="error__msg">{e.message}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {view.status === 'idle' && (
        <section className="idle-hint">
          <p>
            在左右两栏粘贴门图 JSON 后点击「校验并比较」。INPUT 名需匹配{' '}
            <code>[A-Z][A-Z0-9_]{'{0,15}'}</code>，跨图同名 INPUT 视为同一变量。
          </p>
        </section>
      )}

      {view.status === 'ok' && (
        <>
          <section
            className={`verdict ${view.result.equivalent ? 'verdict--ok' : 'verdict--bad'}`}
            data-testid="verdict"
            data-equivalent={view.result.equivalent}
          >
            {view.result.equivalent ? (
              <h2>EQUIVALENT — 两图输出对所有输入恒等</h2>
            ) : (
              <h2>NOT EQUIVALENT — 存在反例（直接读取自异或根摘要）</h2>
            )}
            <div className="verdict__meta">
              共享变量序：
              <span className="mono">
                [{view.result.variables.join(', ')}]
              </span>
              {' · '}唯一表节点 {view.result.bddStats.uniqueNodes} 个 ·
              计算表命中 {view.result.bddStats.cacheHits} / 未命中{' '}
              {view.result.bddStats.cacheMisses}
            </div>
            {snapshotRecord && (
              <p
                className={`snapshot-check ${
                  resultMatchesRecord(view.result, snapshotRecord)
                    ? 'snapshot-check--ok'
                    : 'snapshot-check--bad'
                }`}
                data-testid="snapshot-check"
              >
                {resultMatchesRecord(view.result, snapshotRecord)
                  ? `与封存记录 #${snapshotRecord.seq} 核对一致（结论 / 反例 / 逐门复算摘要）`
                  : `警告：复核结论与封存记录 #${snapshotRecord.seq} 的内容不一致`}
              </p>
            )}
          </section>

          {!view.result.equivalent && (
            <section className="counterexample" data-testid="counterexample">
              <h3>唯一反例赋值（低分支优先，跳过变量补 0）</h3>
              <table className="ce__table">
                <thead>
                  <tr>
                    {view.result.variables.map((v) => (
                      <th key={v} className="mono">
                        {v}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {view.result.variables.map((v) => (
                      <td key={v} className="mono ce__bit" data-bit={view.result.counterexample[v]}>
                        {view.result.counterexample[v]}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <p className="ce__outputs">
                复算输出：旧图 A = <strong className="mono">{view.result.outputA}</strong>
                ，新图 B = <strong className="mono">{view.result.outputB}</strong>
              </p>
            </section>
          )}

          <section className="graphics">
            <GraphSvg
              title="旧图 A"
              graph={view.graphA}
              values={traceValues(traceA)}
              trace={traceA}
            />
            <GraphSvg
              title="新图 B"
              graph={view.graphB}
              values={traceValues(traceB)}
              trace={traceB}
            />
          </section>

          <section className="traces">
            <TraceTable
              title="旧图 A 逐门复算（拓扑顺序）"
              trace={traceA}
              outputId={view.graphA.output}
            />
            <TraceTable
              title="新图 B 逐门复算（拓扑顺序）"
              trace={traceB}
              outputId={view.graphB.output}
            />
          </section>
        </>
      )}

      <section className="chain" data-testid="review-chain">
        <h3>本机审查链</h3>
        <p
          className={`chain__status ${chain.trusted ? '' : 'chain__status--bad'}`}
          data-testid="chain-status"
        >
          {chain.trusted
            ? `链可信 · 共 ${chain.records.length} 条封存记录`
            : '链不可信'}
        </p>

        {!chain.trusted && (
          <div className="chain__broken" data-testid="chain-broken">
            <p>
              审查链校验失败：第 {chain.brokenSeq} 条记录
              {chain.reason ? `（${chain.reason}）` : ''}。 已停止新增封存，
              现有记录不再展示、不可恢复。
            </p>
            <button
              type="button"
              className="btn"
              data-testid="chain-clear"
              onClick={clearBrokenChain}
            >
              清除不可信链并重新开始
            </button>
          </div>
        )}

        {chain.trusted && view.status === 'ok' && !readOnly && (
          <div className="seal" data-testid="seal-form">
            <h4>封存本次审查</h4>
            <div className="seal__row">
              <label>
                审查人
                <input
                  value={reviewer}
                  onChange={(e) => setReviewer(e.target.value)}
                  placeholder="姓名或工号"
                  data-testid="reviewer-input"
                />
              </label>
              <label>
                备注
                <input
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="可留空"
                  data-testid="remark-input"
                />
              </label>
              <button
                type="button"
                className="btn btn--primary"
                data-testid="seal-submit"
                onClick={seal}
                disabled={reviewer.trim() === ''}
              >
                封存审查
              </button>
            </div>
            <p className="seal__hint">
              封存绑定：两份规范化门图、共享变量序、等价结论或反例、逐门复算摘要、
              审查人与备注；记录摘要接上前序记录摘要，构成确定性 SHA-256 链。
            </p>
          </div>
        )}

        {chain.trusted && view.status === 'ok' && readOnly && (
          <p className="chain__hint">快照核对模式下不新增封存；退出快照后可继续。</p>
        )}

        {chain.trusted && view.status !== 'ok' && (
          <p className="chain__hint">
            完成一次成功的比较后可在此封存审查；输入错误、比较被拒绝或未完成比较时不产生记录。
          </p>
        )}

        {chain.trusted && chain.records.length === 0 && (
          <p className="chain__hint">尚无封存记录。</p>
        )}

        {chain.trusted && chain.records.length > 0 && (
          <ol className="chain__list">
            {chain.records.map((rec) => (
              <ChainRecord
                key={rec.seq}
                rec={rec}
                applies={recordAppliesTo(rec, currentBinding)}
                onRestore={restoreSnapshot}
              />
            ))}
          </ol>
        )}
      </section>

      <footer className="app__footer">
        无业务后端、无在线服务、无第三方 BDD 库；判定全过程在浏览器内完成，可由
        Vitest 单元测试与 Playwright 验收复算。审查链仅保存在本机浏览器存储中。
      </footer>
    </div>
  );
}
