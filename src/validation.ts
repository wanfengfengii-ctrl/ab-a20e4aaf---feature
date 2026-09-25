// 门图解析与校验。
//
// 错误汇总顺序（需求）：按旧图（A）优先，同图内按输入位置升序。
// “输入位置”在同图内定义为节点在 nodes 数组中的下标——这是用户唯一可控、
// 可复算的位置语义；图级错误（缺 output 等）排在该图最前。
// 错误类别次序：syntax -> duplicate_id -> unknown_ref -> arity -> output -> cycle。
// 收集到任一错误即整次拒绝，不进入 BDD 分析。

import type {
  Graph,
  GraphError,
  NormalNode,
  NodeType,
  RawGraph,
  RawNode,
} from './types';

const NODE_TYPES: ReadonlySet<string> = new Set([
  'INPUT',
  'CONST0',
  'CONST1',
  'NOT',
  'AND',
  'OR',
  'XOR',
]);

const NAME_RE = /^[A-Z][A-Z0-9_]{0,15}$/;

const ARITY: Record<NodeType, number> = {
  INPUT: 0,
  CONST0: 0,
  CONST1: 0,
  NOT: 1,
  AND: 2,
  OR: 2,
  XOR: 2,
};

const KIND_ORDER: Record<GraphError['kind'], number> = {
  syntax: 0,
  duplicate_id: 1,
  unknown_ref: 2,
  arity: 3,
  output: 4,
  cycle: 5,
};

function pushError(
  list: GraphError[],
  graph: 'A' | 'B',
  kind: GraphError['kind'],
  message: string,
  nodeId?: string,
): void {
  // 去重：同一 (图, 类别, 节点, 消息) 只报一次
  if (
    list.some(
      (e) =>
        e.graph === graph &&
        e.kind === kind &&
        e.nodeId === nodeId &&
        e.message === message,
    )
  ) {
    return;
  }
  list.push(
    nodeId === undefined
      ? { graph, kind, message }
      : { graph, nodeId, kind, message },
  );
}

interface ParsedEntry {
  index: number;
  node: NormalNode | null;
}

/**
 * 校验单份门图文本。
 */
export function validateGraph(text: string, graph: 'A' | 'B'): {
  graph?: Graph;
  errors: GraphError[];
} {
  const errors: GraphError[] = [];

  let raw: RawGraph;
  try {
    raw = JSON.parse(text) as RawGraph;
  } catch (e) {
    pushError(
      errors,
      graph,
      'syntax',
      `JSON 语法错误：${(e as Error).message}`,
    );
    return { errors: sortErrors(errors, new Map()) };
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    pushError(
      errors,
      graph,
      'syntax',
      '顶层结构必须是对象，且包含 nodes 与 output 字段',
    );
    return { errors: sortErrors(errors, new Map()) };
  }

  const { nodes: rawNodes, output } = raw;

  if (!Array.isArray(rawNodes)) {
    pushError(errors, graph, 'syntax', '缺少 nodes 数组');
    return { errors: sortErrors(errors, new Map()) };
  }
  if (rawNodes.length === 0) {
    pushError(errors, graph, 'syntax', 'nodes 不能为空');
  }

  // 第一轮：逐条做语法/结构规范化，并记录每个 id 的最小下标（排序键）
  const parsed: ParsedEntry[] = [];
  const idFirstIndex = new Map<string, number>();

  rawNodes.forEach((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      pushError(errors, graph, 'syntax', `nodes[${index}] 必须是对象`);
      parsed.push({ index, node: null });
      return;
    }
    const r = item as RawNode;

    if (typeof r.id !== 'string' || r.id.length === 0) {
      pushError(
        errors,
        graph,
        'syntax',
        `nodes[${index}] 缺少字符串类型的 id`,
      );
      parsed.push({ index, node: null });
      return;
    }

    if (idFirstIndex.has(r.id)) {
      pushError(
        errors,
        graph,
        'duplicate_id',
        `重复的节点 id：${r.id}（首次出现于 nodes[${idFirstIndex.get(r.id)}]）`,
        r.id,
      );
    } else {
      idFirstIndex.set(r.id, index);
    }

    let typeOk = false;
    if (typeof r.type !== 'string' || !NODE_TYPES.has(r.type)) {
      pushError(
        errors,
        graph,
        'syntax',
        `节点 ${r.id} 的 type 非法（仅允许 INPUT/CONST0/CONST1/NOT/AND/OR/XOR）`,
        r.id,
      );
    } else {
      typeOk = true;
    }

    if (r.type === 'INPUT') {
      if (typeof r.name !== 'string' || !NAME_RE.test(r.name)) {
        pushError(
          errors,
          graph,
          'syntax',
          `INPUT 节点 ${r.id} 的 name 必须匹配 [A-Z][A-Z0-9_]{0,15}`,
          r.id,
        );
      }
    } else if (r.name !== undefined) {
      pushError(
        errors,
        graph,
        'syntax',
        `非 INPUT 节点 ${r.id} 不允许携带 name 字段`,
        r.id,
      );
    }

    let ins: string[] = [];
    if (r.in === undefined) {
      ins = [];
    } else if (
      !Array.isArray(r.in) ||
      !r.in.every((x) => typeof x === 'string')
    ) {
      pushError(
        errors,
        graph,
        'syntax',
        `节点 ${r.id} 的 in 必须是字符串数组`,
        r.id,
      );
    } else {
      ins = [...(r.in as string[])];
    }

    parsed.push({
      index,
      node: typeOk
        ? { id: r.id, type: r.type as NodeType, name: r.name, in: ins }
        : null,
    });
  });

  // 输出字段检查
  if (typeof output !== 'string' || output.length === 0) {
    pushError(errors, graph, 'output', '缺少字符串类型的 output 字段');
  }

  // 后续语义检查在“类型合法的节点”上进行；重复 id 只保留首份
  const byId = new Map<string, NormalNode>();
  for (const p of parsed) {
    if (p.node && !byId.has(p.node.id)) byId.set(p.node.id, p.node);
  }

  if (typeof output === 'string' && output.length > 0 && !byId.has(output)) {
    pushError(errors, graph, 'output', `输出节点不存在：${output}`);
  }

  // 元数检查 + 未知引用检查（天然按节点下标、入边位置升序）
  for (const p of parsed) {
    const n = p.node;
    if (!n) continue;
    const expected = ARITY[n.type];
    if (n.in.length !== expected) {
      pushError(
        errors,
        graph,
        'arity',
        `节点 ${n.id}（${n.type}）需要 ${expected} 条入边，实际 ${n.in.length} 条`,
        n.id,
      );
    }
    n.in.forEach((ref, pos) => {
      if (!byId.has(ref)) {
        pushError(
          errors,
          graph,
          'unknown_ref',
          `节点 ${n.id} 的第 ${pos + 1} 条入边引用了不存在的节点：${ref}`,
          n.id,
        );
      }
    });
  }

  // 环检查：在“引用全部可解析”的边构成的子图上做 Kahn 拓扑排序。
  // 按 nodes 下标升序入队，无法出队的节点按最小下标报告，保证可复算。
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const n of byId.values()) {
    indegree.set(n.id, 0);
    dependents.set(n.id, []);
  }
  for (const n of byId.values()) {
    // 同一前驱重复出现只计一次（重复边无意义；元数已限制边数）
    const refs = new Set(n.in.filter((r) => byId.has(r)));
    indegree.set(n.id, refs.size);
    for (const r of refs) dependents.get(r)!.push(n.id);
  }

  const queue: string[] = [];
  for (const [id, d] of indegree) {
    if (d === 0) queue.push(id);
  }
  queue.sort((a, b) => idFirstIndex.get(a)! - idFirstIndex.get(b)!);

  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    const newlyReady: string[] = [];
    for (const dep of dependents.get(id) ?? []) {
      indegree.set(dep, indegree.get(dep)! - 1);
      if (indegree.get(dep) === 0) newlyReady.push(dep);
    }
    if (newlyReady.length > 0) {
      queue.push(...newlyReady);
      queue.sort((a, b) => idFirstIndex.get(a)! - idFirstIndex.get(b)!);
    }
  }

  if (visited !== byId.size) {
    const cyclic = [...indegree.entries()]
      .filter(([, d]) => d > 0)
      .map(([id]) => id)
      .sort((a, b) => idFirstIndex.get(a)! - idFirstIndex.get(b)!);
    for (const id of cyclic) {
      pushError(
        errors,
        graph,
        'cycle',
        `节点 ${id} 位于环中（或依赖于环），门图必须无环`,
        id,
      );
    }
  }

  if (errors.length > 0) {
    return { errors: sortErrors(errors, idFirstIndex) };
  }

  const nodes: NormalNode[] = parsed
    .map((p) => p.node)
    .filter((n): n is NormalNode => n !== null);

  return {
    graph: { nodes, output: output as string },
    errors: [],
  };
}

/** 同时校验两份门图并按“旧图优先、输入位置升序”合并错误 */
export function validatePair(textA: string, textB: string): {
  graphA?: Graph;
  graphB?: Graph;
  errors: GraphError[];
} {
  const ra = validateGraph(textA, 'A');
  const rb = validateGraph(textB, 'B');
  return {
    graphA: ra.graph,
    graphB: rb.graph,
    errors: [...ra.errors, ...rb.errors],
  };
}

/**
 * 变量序：两图 INPUT 名的并集，ASCII 升序。
 * 跨图同名 INPUT 即同一变量；只出现在一侧的名字也是独立变量
 * （若输出实际上不依赖它，ROBDD 约简会自动消去该变量，不影响等价结论）。
 */
export function collectVariables(graphA: Graph, graphB: Graph): string[] {
  const names = new Set<string>();
  for (const n of graphA.nodes) {
    if (n.type === 'INPUT') names.add(n.name!);
  }
  for (const n of graphB.nodes) {
    if (n.type === 'INPUT') names.add(n.name!);
  }
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function sortErrors(
  list: GraphError[],
  idFirstIndex: Map<string, number>,
): GraphError[] {
  return [...list].sort((a, b) => {
    // 1) 旧图 A 优先
    const pa = a.graph === 'A' ? 0 : 1;
    const pb = b.graph === 'A' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    // 2) 节点位置升序，图级错误（-1）最前
    const ia =
      a.nodeId === undefined
        ? -1
        : (idFirstIndex.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER);
    const ib =
      b.nodeId === undefined
        ? -1
        : (idFirstIndex.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER);
    if (ia !== ib) return ia - ib;
    // 3) 错误类别次序
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) {
      return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    }
    // 4) 消息字典序兜底，保证完全确定
    return a.message.localeCompare(b.message);
  });
}
