// 门图 -> ROBDD 构建、等价判定、反例直接读取与逐门复算。
//
// 关键约束（需求）：
//  - 两图输出的异或根为 0 终端 => equivalent；
//  - 否则“直接读取”异或根节点维护的最小满足赋值摘要作为反例，
//    本模块不包含任何路径搜索、SAT 回溯或全赋值枚举；
//  - 反例给出后，对两图逐门复算，便于功能安全工程师人工核对。

import { BddManager, type BinOp, type BddNode } from './bdd/bdd';
import type {
  AnalysisResult,
  GateEval,
  Graph,
  NormalNode,
} from './types';
import { collectVariables } from './validation';

interface BuiltGraph {
  bdd: BddManager;
  roots: Map<string, BddNode>;
  order: NormalNode[];
}

/** 按 nodes 数组下标做确定性 Kahn 拓扑排序（调用前图已被校验为无环） */
export function topoOrder(graph: Graph): NormalNode[] {
  const byId = new Map(graph.nodes.map((n, i) => [n.id, { n, i }]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const n of graph.nodes) {
    indegree.set(n.id, new Set(n.in).size);
    dependents.set(n.id, []);
  }
  for (const n of graph.nodes) {
    for (const r of new Set(n.in)) dependents.get(r)!.push(n.id);
  }
  const queue = graph.nodes
    .filter((n) => indegree.get(n.id) === 0)
    .map((n) => n.id);
  const order: NormalNode[] = [];
  while (queue.length > 0) {
    queue.sort((a, b) => byId.get(a)!.i - byId.get(b)!.i);
    const id = queue.shift()!;
    order.push(byId.get(id)!.n);
    for (const dep of dependents.get(id) ?? []) {
      indegree.set(dep, indegree.get(dep)! - 1);
      if (indegree.get(dep) === 0) queue.push(dep);
    }
  }
  return order;
}

function evalOp(type: NormalNode['type'], ins: number[]): 0 | 1 {
  switch (type) {
    case 'NOT':
      return (ins[0] ^ 1) as 0 | 1;
    case 'AND':
      return (ins[0] & ins[1]) as 0 | 1;
    case 'OR':
      return (ins[0] | ins[1]) as 0 | 1;
    case 'XOR':
      return (ins[0] ^ ins[1]) as 0 | 1;
    default:
      return ins[0] as 0 | 1;
  }
}

/** 在给定赋值下对单图逐门复算（拓扑顺序） */
function reevaluate(
  graph: Graph,
  which: 'A' | 'B',
  order: NormalNode[],
  assignment: Record<string, 0 | 1>,
): { trace: GateEval[]; output: 0 | 1 } {
  const values = new Map<string, 0 | 1>();
  const trace: GateEval[] = [];

  for (const n of order) {
    let value: 0 | 1;
    const inputValues = n.in.map((id) => ({ id, value: values.get(id)! }));
    switch (n.type) {
      case 'INPUT':
        value = assignment[n.name!] ?? 0;
        break;
      case 'CONST0':
        value = 0;
        break;
      case 'CONST1':
        value = 1;
        break;
      default:
        value = evalOp(n.type, inputValues.map((x) => x.value));
    }
    values.set(n.id, value);
    trace.push({
      graph: which,
      id: n.id,
      type: n.type,
      inputs: inputValues,
      value,
    });
  }

  return { trace, output: values.get(graph.output)! };
}

function buildBddShared(
  graph: Graph,
  variables: string[],
  shared?: BddManager,
): BuiltGraph {
  // 两图共用同一个 BddManager => 共享唯一表与变量序，结构相同的子函数自动复用
  const bdd = shared ?? new BddManager(variables);
  const levelOf = new Map(variables.map((v, i) => [v, i]));
  const roots = new Map<string, BddNode>();
  const order = topoOrder(graph);

  for (const n of order) {
    let node: BddNode;
    switch (n.type) {
      case 'INPUT':
        node = bdd.ithVar(levelOf.get(n.name!)!);
        break;
      case 'CONST0':
        node = bdd.zero;
        break;
      case 'CONST1':
        node = bdd.one;
        break;
      case 'NOT':
        node = bdd.not(roots.get(n.in[0])!);
        break;
      case 'AND':
      case 'OR':
      case 'XOR':
        node = bdd.apply(
          n.type.toLowerCase() as BinOp,
          roots.get(n.in[0])!,
          roots.get(n.in[1])!,
        );
        break;
    }
    roots.set(n.id, node);
  }
  return { bdd, roots, order };
}

/**
 * 完整分析：校验由调用方先行完成；本函数假定两图均合法。
 */
export function analyze(graphA: Graph, graphB: Graph): AnalysisResult {
  const variables = collectVariables(graphA, graphB);

  const builtA = buildBddShared(graphA, variables);
  const builtB = buildBddShared(graphB, variables, builtA.bdd);

  const outA = builtA.roots.get(graphA.output)!;
  const outB = builtB.roots.get(graphB.output)!;

  // 两输出异或：根为 0 终端即等价
  const diff = builtA.bdd.apply('xor', outA, outB);

  const zeroAssignment: Record<string, 0 | 1> = {};
  for (const v of variables) zeroAssignment[v] = 0;

  if (diff === builtA.bdd.zero) {
    // 等价：用全 0 赋值做一次逐门复算（例行自检：两输出应相同）
    const a0 = reevaluate(graphA, 'A', builtA.order, zeroAssignment);
    const b0 = reevaluate(graphB, 'B', builtB.order, zeroAssignment);
    return {
      equivalent: true,
      variables,
      counterexample: zeroAssignment,
      trace: [...a0.trace, ...b0.trace],
      outputA: a0.output,
      outputB: b0.output,
      bddStats: {
        uniqueNodes: builtA.bdd.uniqueNodeCount,
        cacheHits: builtA.bdd.cacheHits,
        cacheMisses: builtA.bdd.cacheMisses,
      },
    };
  }

  // 不等价：直接读取异或根的最小满足赋值摘要——没有任何搜索/回溯。
  const counterexample = builtA.bdd.satisfyingAssignment(diff)!;

  const aEval = reevaluate(graphA, 'A', builtA.order, counterexample);
  const bEval = reevaluate(graphB, 'B', builtB.order, counterexample);

  return {
    equivalent: false,
    variables,
    counterexample,
    trace: [...aEval.trace, ...bEval.trace],
    outputA: aEval.output,
    outputB: bEval.output,
    bddStats: {
      uniqueNodes: builtA.bdd.uniqueNodeCount,
      cacheHits: builtA.bdd.cacheHits,
      cacheMisses: builtA.bdd.cacheMisses,
    },
  };
}
