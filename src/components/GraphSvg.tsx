import { useMemo } from 'react';
import type { GateEval } from '../types';
import type { Graph } from '../types';
import { layoutGraph, NODE_H, NODE_W } from '../graphLayout';

interface GraphSvgProps {
  graph: Graph;
  /** 反例/复算赋值下每个节点的值；无复算信息时为 null */
  values: Map<string, 0 | 1> | null;
  trace: GateEval[] | null;
  title: string;
}

const TYPE_LABEL: Record<string, string> = {
  INPUT: 'INPUT',
  CONST0: 'CONST0',
  CONST1: 'CONST1',
  NOT: 'NOT',
  OR: 'OR',
  AND: 'AND',
  XOR: 'XOR',
};

export function GraphSvg({ graph, values, trace, title }: GraphSvgProps) {
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const traceById = useMemo(() => {
    const m = new Map<string, GateEval>();
    if (trace) for (const t of trace) m.set(t.id, t);
    return m;
  }, [trace]);

  return (
    <div className="graph-pane" data-testid={title}>
      <div className="graph-pane__title">{title}</div>
      <div className="graph-pane__scroll">
        <svg
          width={Math.max(layout.width, 320)}
          height={Math.max(layout.height, 120)}
          role="img"
          aria-label={`${title}门图结构`}
        >
          {layout.edges.map((e, i) => {
            const a = layout.nodes.get(e.from);
            const b = layout.nodes.get(e.to);
            if (!a || !b) return null;
            const x1 = a.x + NODE_W;
            const y1 = a.y + NODE_H / 2;
            const x2 = b.x;
            // 两条入边分别接到目标节点左边缘的 1/3 与 2/3 高度处，保留位置语义
            const y2 =
              b.y + (e.pos === 0 ? NODE_H * (1 / 3) : NODE_H * (2 / 3));
            const midX = (x1 + x2) / 2;
            const highlighted =
              values !== null &&
              traceById.has(e.from) &&
              traceById.has(e.to);
            return (
              <path
                key={`edge-${i}`}
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                className={highlighted ? 'edge edge--live' : 'edge'}
                data-from={e.from}
                data-to={e.to}
            />
            );
          })}

          {[...layout.nodes.values()].map((p) => {
            const v = values?.get(p.node.id);
            const isInput = p.node.type === 'INPUT';
            const label = isInput
              ? `${p.node.id}\n${p.node.name}`
              : `${p.node.id}\n${TYPE_LABEL[p.node.type]}`;
            const [l1, l2] = label.split('\n');
            return (
              <g
                key={p.node.id}
                transform={`translate(${p.x},${p.y})`}
                data-node-id={p.node.id}
                className={
                  p.isOutput
                    ? 'node node--output'
                    : isInput
                      ? 'node node--input'
                      : 'node'
                }
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  className="node__box"
                />
                <text x={NODE_W / 2} y={16} textAnchor="middle" className="node__id">
                  {l1}
                </text>
                <text x={NODE_W / 2} y={32} textAnchor="middle" className="node__type">
                  {l2}
                </text>
                {v !== undefined && (
                  <g className="node__value-badge" data-value={v}>
                    <circle cx={NODE_W - 10} cy={10} r={9} />
                    <text
                      x={NODE_W - 10}
                      y={14}
                      textAnchor="middle"
                      className="node__value-text"
                    >
                      {v}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
