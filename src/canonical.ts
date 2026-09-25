// 确定性规范化序列化：作为 SHA-256 摘要的唯一输入形式。
//
// 规则（与 JSON 数据模型一致，但消除键序与空白的不确定性）：
//  - 对象：键按 ASCII 升序排列，值为 undefined 的键跳过（同 JSON.stringify）；
//  - 数组：保持顺序；undefined 元素按 null 处理（同 JSON.stringify）；
//  - 字符串用 JSON.stringify 转义；数字须为有限值；无任何空白。
// 同一逻辑内容 => 同一字符串 => 同一摘要，与运行环境、对象构造顺序无关。

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('canonicalize: 不支持非有限数值');
      }
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        const items = value.map((v) =>
          canonicalize(v === undefined ? null : v),
        );
        return `[${items.join(',')}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const body = entries
        .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`)
        .join(',');
      return `{${body}}`;
    }
    default:
      throw new Error(`canonicalize: 不支持的类型 ${typeof value}`);
  }
}
