// 内置示例门图，便于一键体验与验收。

const equivA = JSON.stringify(
  {
    nodes: [
      { id: 'a', type: 'INPUT', name: 'A' },
      { id: 'b', type: 'INPUT', name: 'B' },
      { id: 'c', type: 'INPUT', name: 'C' },
      { id: 'g1', type: 'AND', in: ['a', 'b'] },
      { id: 'g2', type: 'OR', in: ['g1', 'c'] },
    ],
    output: 'g2',
  },
  null,
  2,
);

// 与 A 布尔恒等但结构改版：(A∧B)∨C == (A∨C)∧(B∨C)
const equivB = JSON.stringify(
  {
    nodes: [
      { id: 'x', type: 'INPUT', name: 'A' },
      { id: 'y', type: 'INPUT', name: 'B' },
      { id: 'z', type: 'INPUT', name: 'C' },
      { id: 'h1', type: 'OR', in: ['x', 'z'] },
      { id: 'h2', type: 'OR', in: ['y', 'z'] },
      { id: 'h3', type: 'AND', in: ['h1', 'h2'] },
    ],
    output: 'h3',
  },
  null,
  2,
);

// 罕见组合才分歧：旧 = (A∧B)∨C，新 = A∧B。
// 仅当 C=1 且 A∧B=0 时两图不同；最小反例 A=0,B=0,C=1。
const differB = JSON.stringify(
  {
    nodes: [
      { id: 'x', type: 'INPUT', name: 'A' },
      { id: 'y', type: 'INPUT', name: 'B' },
      { id: 'h1', type: 'AND', in: ['x', 'y'] },
    ],
    output: 'h1',
  },
  null,
  2,
);

const errA = JSON.stringify(
  {
    nodes: [
      { id: 'a', type: 'INPUT', name: 'bad-name' },
      { id: 'a', type: 'INPUT', name: 'A' },
      { id: 'g1', type: 'AND', in: ['a'] },
      { id: 'g2', type: 'NOT', in: ['g2', 'missing'] },
    ],
    output: 'nope',
  },
  null,
  2,
);

const errB = JSON.stringify(
  {
    nodes: [
      { id: 'a', type: 'INPUT', name: 'A' },
      { id: 'g1', type: 'XOR', in: ['a'] },
    ],
    output: 'g1',
  },
  null,
  2,
);

export const EXAMPLES = {
  equiv: { label: '示例：等价改版', a: equivA, b: equivB },
  differ: { label: '示例：罕见分歧', a: equivA, b: differB },
  errors: { label: '示例：各类错误', a: errA, b: errB },
} as const;
