import type { GateEval } from '../types';

/** 逐门复算表：比较结论区与审查链展开视图共用 */
export function TraceTable({
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
