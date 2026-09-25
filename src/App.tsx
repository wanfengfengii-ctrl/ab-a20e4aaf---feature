import { useMemo, useState } from 'react';
import { analyze } from './analysis';
import { validatePair } from './validation';
import type { AnalysisResult, Graph, GraphError } from './types';
import { GraphSvg } from './components/GraphSvg';
import { TraceTable } from './components/TraceTable';
import { ReviewChainPanel } from './components/ReviewChainPanel';
import { EXAMPLES } from './examples';
import {
  buildRecord,
  loadChain,
  recordMatchesResult,
  saveChain,
  unsealGraph,
  type ChainState,
  type ReviewRecord,
} from './review/chain';

type View =
  | { status: 'idle' }
  | { status: 'error'; errors: GraphError[] }
  // textA/textB 记录本次结论对应的草稿原文，用于判定草稿是否已被改动
  | {
      status: 'ok';
      graphA: Graph;
      graphB: Graph;
      result: AnalysisResult;
      textA: string;
      textB: string;
    };

function traceValues(trace: { id: string; value: 0 | 1 }[]): Map<string, 0 | 1> {
  return new Map(trace.map((t) => [t.id, t.value]));
}

export function App() {
  const [textA, setTextA] = useState('');
  const [textB, setTextB] = useState('');
  const [view, setView] = useState<View>({ status: 'idle' });

  // 本机审查链：打开/刷新时从 localStorage 恢复并逐条重算校验
  const [chain, setChain] = useState<ChainState>(() =>
    loadChain(window.localStorage),
  );
  const [reviewer, setReviewer] = useState('');
  const [note, setNote] = useState('');
  const [sealError, setSealError] = useState<string | null>(null);
  // 只读快照恢复状态：seq 为被恢复的记录序号，consistent 为复算一致性
  const [snapshot, setSnapshot] = useState<{
    seq: number;
    consistent: boolean;
  } | null>(null);

  // 任一错误整次拒绝：只有在校验全过后才保留门图与结论
  const run = () => {
    const { graphA, graphB, errors } = validatePair(textA, textB);
    if (errors.length > 0 || !graphA || !graphB) {
      setView({ status: 'error', errors });
      return;
    }
    const result = analyze(graphA, graphB);
    setView({ status: 'ok', graphA, graphB, result, textA, textB });
  };

  const clearAll = () => {
    setTextA('');
    setTextB('');
    setView({ status: 'idle' });
    setSnapshot(null);
  };

  const loadExample = (key: keyof typeof EXAMPLES) => {
    const ex = EXAMPLES[key];
    setTextA(ex.a);
    setTextB(ex.b);
    setView({ status: 'idle' });
    setSnapshot(null);
  };

  // 封存审查：仅在一次成功比较之后可用；链不可信或审查人为空时不产生记录
  const seal = () => {
    if (view.status !== 'ok') return;
    if (chain.status !== 'ok') return;
    const who = reviewer.trim();
    if (!who) {
      setSealError('请填写审查人后再封存');
      return;
    }
    const record = buildRecord(chain.records, {
      reviewer: who,
      note: note.trim(),
      graphA: view.graphA,
      graphB: view.graphB,
      result: view.result,
      sealedAt: new Date().toISOString(),
    });
    const records = [...chain.records, record];
    saveChain(window.localStorage, records);
    setChain({ status: 'ok', records });
    setSealError(null);
    setNote('');
  };

  // 恢复某条记录的只读快照：回填规范化门图（只读）并立即复算，
  // 复算结论必须与封存内容一致。
  const restoreSnapshot = (record: ReviewRecord) => {
    if (chain.status !== 'ok') return;
    const a = unsealGraph(record.graphA);
    const b = unsealGraph(record.graphB);
    const { graphA, graphB, errors } = validatePair(a, b);
    setTextA(a);
    setTextB(b);
    if (errors.length > 0 || !graphA || !graphB) {
      // 已通过链校验的记录不应校验失败；防御性兜底
      setView({ status: 'error', errors });
      setSnapshot({ seq: record.seq, consistent: false });
      return;
    }
    const result = analyze(graphA, graphB);
    const consistent = recordMatchesResult(record, graphA, graphB, result);
    setView({ status: 'ok', graphA, graphB, result, textA: a, textB: b });
    setSnapshot({ seq: record.seq, consistent });
  };

  // “适用于当前草稿”：链可信，且当前草稿未被改动（与得出当前结论时的原文一致），
  // 且当前结论（图、变量序、等价性、反例、逐门复算）与封存内容完全一致。
  const applicableSeqs = useMemo(() => {
    const set = new Set<number>();
    if (
      chain.status === 'ok' &&
      view.status === 'ok' &&
      textA === view.textA &&
      textB === view.textB
    ) {
      for (const r of chain.records) {
        if (recordMatchesResult(r, view.graphA, view.graphB, view.result)) {
          set.add(r.seq);
        }
      }
    }
    return set;
  }, [view, textA, textB, chain]);

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
          异或根为 0 即等价，否则直接读取根节点最小满足赋值摘要作为唯一反例
        </p>
      </header>

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
            readOnly={snapshot !== null}
            onChange={(e) => setTextA(e.target.value)}
            placeholder='{"nodes":[...],"output":"..."}'
          />
        </div>
        <div className="editor">
          <div className="editor__bar">
            <label htmlFor="ta-b">新图 B</label>
            {snapshot !== null && (
              <button
                type="button"
                className="btn btn--mini"
                data-testid="exit-snapshot"
                onClick={() => setSnapshot(null)}
              >
                退出快照（恢复可编辑）
              </button>
            )}
          </div>
          <textarea
            id="ta-b"
            className="editor__area"
            spellCheck={false}
            value={textB}
            readOnly={snapshot !== null}
            onChange={(e) => setTextB(e.target.value)}
            placeholder='{"nodes":[...],"output":"..."}'
          />
        </div>
      </section>

      <section className="actions">
        <button type="button" className="btn btn--primary" onClick={run}>
          校验并比较
        </button>
        <button type="button" className="btn" onClick={clearAll}>
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
          {snapshot !== null && (
            <section
              className={`snapshot ${
                snapshot.consistent ? 'snapshot--ok' : 'snapshot--bad'
              }`}
              data-testid="snapshot-banner"
              data-consistent={snapshot.consistent}
            >
              已恢复第 {snapshot.seq} 条封存快照（只读）· 复算结论
              {snapshot.consistent
                ? '与封存内容一致'
                : '与封存内容不一致，请核查链完整性'}
            </section>
          )}

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
          </section>

          <section className="seal" data-testid="seal-section">
            <h3>封存审查</h3>
            {chain.status !== 'ok' ? (
              <p className="seal__blocked" data-testid="seal-blocked">
                审查链不可信，已停止新增封存。
              </p>
            ) : (
              <div className="seal__form">
                <label className="seal__field">
                  审查人
                  <input
                    className="seal__input"
                    data-testid="seal-reviewer"
                    value={reviewer}
                    placeholder="必填"
                    onChange={(e) => setReviewer(e.target.value)}
                  />
                </label>
                <label className="seal__field">
                  备注
                  <input
                    className="seal__input seal__input--wide"
                    data-testid="seal-note"
                    value={note}
                    placeholder="可选"
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn"
                  data-testid="seal-submit"
                  disabled={reviewer.trim() === ''}
                  onClick={seal}
                >
                  封存审查
                </button>
                {sealError && <p className="seal__error">{sealError}</p>}
              </div>
            )}
            <p className="seal__hint">
              封存内容：两图规范化内容、共享变量序、等价结论或反例、逐门复算摘要、
              审查人与备注；记录摘要 = SHA-256（规范化内容 + 前序摘要），
              追加进本机审查链。
            </p>
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

      <ReviewChainPanel
        chain={chain}
        applicableSeqs={applicableSeqs}
        onRestore={restoreSnapshot}
      />

      <footer className="app__footer">
        无业务后端、无在线服务、无第三方 BDD 库；判定全过程在浏览器内完成，可由
        Vitest 单元测试与 Playwright 验收复算。审查链仅保存于本机浏览器
        localStorage，不上传任何数据。
      </footer>
    </div>
  );
}
