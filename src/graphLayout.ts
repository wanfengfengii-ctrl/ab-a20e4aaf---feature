// 门图的确定性分层布局（仅用于 SVG 绘制，不参与任何判定）。
// 左 -> 右：列 = 最长路径深度；同列节点按 nodes 数组下标纵向排列。

import type { Graph, NormalNode } from './types';
import { topoOrder } from './analysis';

export interface PositionedNode {
  node: NormalNode;
  x: number;
  y: number;
  depth: number;
  isOutput: boolean;
}

export interface Layout {
  width: number;
  height: number;
  nodes: Map<string, PositionedNode>;
  /** 边：from -> to，pos 为入边位置（0/1） */
  edges: Array<{ from: string; to: string; pos: number }>;
}

export const NODE_W = 96;
export const NODE_H = 44;
const COL_GAP = 64;
const ROW_GAP = 28;
const MARGIN = 32;

export function layoutGraph(graph: Graph): Layout {
  const order = topoOrder(graph);
  const depth = new Map<string, number>();
  const index = new Map<string, number>();
  order.forEach((n, i) => index.set(n.id, i));

  for (const n of order) {
    if (n.in.length === 0) {
      depth.set(n.id, 0);
    } else {
      const d = Math.max(...n.in.map((r) => depth.get(r) ?? 0)) + 1;
      depth.set(n.id, d);
    }
  }

  const columns = new Map<number, NormalNode[]>();
  for (const n of order) {
    const d = depth.get(n.id)!;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(n);
  }
  // 同列按拓扑下标排列（稳定、可复算）
  for (const list of columns.values()) {
    list.sort((a, b) => index.get(a.id)! - index.get(b.id)!);
  }

  const maxDepth = Math.max(0, ...[...columns.keys()]);
  const maxRows = Math.max(0, ...[...columns.values()].map((l) => l.length));

  const nodes = new Map<string, PositionedNode>();
  for (const [d, list] of columns) {
    const x = MARGIN + d * (NODE_W + COL_GAP);
    list.forEach((n, row) => {
      const y = MARGIN + row * (NODE_H + ROW_GAP);
      nodes.set(n.id, {
        node: n,
        x,
        y,
        depth: d,
        isOutput: n.id === graph.output,
      });
    });
  }

  const edges: Layout['edges'] = [];
  for (const n of order) {
    n.in.forEach((from, pos) => {
      edges.push({ from, to: n.id, pos });
    });
  }

  return {
    width: MARGIN * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP,
    height: MARGIN * 2 + maxRows * NODE_H + (maxRows - 1 > 0 ? maxRows - 1 : 0) * ROW_GAP,
    nodes,
    edges,
  };
}
