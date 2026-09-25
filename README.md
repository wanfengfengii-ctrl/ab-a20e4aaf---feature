# 联锁控制器门图等价性工作台

两份门图（旧版 / 改版）可能只在罕见输入组合上产生分歧。本工作台在**纯浏览器**内
对两份门图做形式化等价判定：等价时给出可复算的 `EQUIVALENT` 结论；不等价时
直接给出**唯一反例**，并逐门复算两图，供功能安全工程师人工核对。

- 纯前端：TypeScript + React + Vite + 手写 SVG；**不调用任何业务后端或在线服务**。
- 判定核心：自行实现的 ROBDD（ASCII 升序共享变量序、唯一表、Apply 计算表、
  两条约简规则），**无全赋值枚举、无第三方 BDD 库**。
- 每个唯一化节点同时维护到 1 终端的**最小满足赋值摘要**（低分支可满足走低分支，
  否则走高分支，跳过变量补 0）；反例 = 两输出异或根摘要的**直接读取**，
  代码中不存在路径搜索或回溯。

## 门图 JSON 格式

```json
{
  "nodes": [
    { "id": "a", "type": "INPUT", "name": "A" },
    { "id": "b", "type": "INPUT", "name": "B" },
    { "id": "g1", "type": "AND", "in": ["a", "b"] },
    { "id": "g2", "type": "NOT", "in": ["g1"] }
  ],
  "output": "g2"
}
```

规则：

| 规则 | 说明 |
| --- | --- |
| 节点 id | 字符串，图内唯一 |
| `INPUT` 名 | 匹配 `[A-Z][A-Z0-9_]{0,15}` |
| 类型 | `INPUT` `CONST0` `CONST1` `NOT` `AND` `OR` `XOR` |
| 元数 | `INPUT`/常量 0 入边；`NOT` 1 条；`AND`/`OR`/`XOR` 2 条 |
| 输出 | 每图用顶层 `output` 指定一个存在的节点 |
| 环 | 门图必须无环（拓扑可排序） |
| 跨图变量 | 同名 `INPUT` 为同一变量；变量序取两图并集，ASCII 升序 |

两栏分别粘贴旧图 A（左，优先）与新图 B（右），点击「校验并比较」。

### 错误处理

校验类别：`syntax`、`duplicate_id`、`unknown_ref`、`arity`、`output`、`cycle`。
错误按 **旧图 A 优先 → 图内 `nodes` 下标升序（图级错误最前）→ 类别次序** 汇总展示。
**任一错误即整次拒绝**：不做 BDD 分析，并清空上一次的结论与图形。

## 判定原理（可复算）

1. 对每份图按拓扑顺序构建 ROBDD，两图共用同一个 `BddManager`（共享唯一表）。
2. `D = Apply(xor, outA, outB)`。
3. `D = 0 终端` ⇒ 对所有输入两输出恒等 ⇒ **EQUIVALENT**。
4. 否则直接读 `D` 节点维护的 witness：它是变量序下**字典序最小**的满足赋值，
   即报告的唯一反例；随后用该赋值对两图每个门做普通布尔复算，输出复算轨迹。

关键源码：

- `src/bdd/bdd.ts` — 唯一表 / 计算表 / 约简 / Apply / witness 不变量
- `src/validation.ts` — 解析、校验与错误排序
- `src/analysis.ts` — 建图、异或根、摘要直读、逐门复算
- `src/graphLayout.ts` / `src/components/GraphSvg.tsx` — SVG 图形
- `src/review/sha256.ts` / `src/review/chain.ts` — 本机审查链（见下）

## 本机审查链（封存审查）

一次比较成功后，结论下方出现「封存审查」：填写**审查人**（必填）与备注（可选）
后点击封存，把可复算的结论追加进本机审查链，供换班人员重新打开工作台时核对。

- **记录绑定**：两份通过校验的门图规范化内容、共享变量序、等价结论或
  唯一反例、逐门复算摘要、审查人与备注、封存时刻。
- **确定性 SHA-256 链**：记录摘要 = `SHA-256(规范化序列化(记录正文 + 前序摘要))`，
  首条前序摘要为 64 个 `0`；规范化序列化对对象键排序，同一内容必得同一摘要。
  SHA-256 为仓库内手写实现（`src/review/sha256.ts`），不依赖 Web Crypto，
  浏览器与测试环境行为一致。
- **适用于当前草稿**：封存后若任一输入草稿、比较结论或反例发生变化，
  记录立即失去该标记；草稿与结论复原一致时标记恢复。
- **刷新复核**：链保存在本机 `localStorage`（键
  `interlocking.reviewChain.v1`）。每次打开/刷新逐条重算序号、前序摘要与
  记录摘要；任一不一致即整链显示**不可信**并**停止新增封存**（记录仍可见供核查，
  恢复快照被禁用）。
- **只读快照恢复**：合法链可按序号展开任一记录，点击「恢复快照」把封存的
  规范化门图只读回填并立即复算；复算结论必须与封存内容一致（横幅提示），
  「退出快照」后恢复可编辑。
- **不产生记录的情形**：输入错误、比较被整次拒绝、尚未完成比较、审查人为空、
  链不可信。

## 本地开发与测试

```bash
npm ci
npm run dev          # 开发服务器

npm run build        # 类型检查 + 产物构建（dist/）
npm run preview      # 本地静态预览

npm run test:unit    # Vitest 单元测试
npm run test:e2e     # 构建后跑 Playwright（首次需 npx playwright install chromium）
```

## Docker Compose

构建产物由 nginx 作为纯静态页面提供；另有一个**一次性验收服务** `verify`，
在 compose 网络内对该页面跑 Playwright，跑完即退出（退出码即验收结论）。

```bash
# 启动静态页面，宿主端口由 WEB_PORT 覆盖（默认 8080）
WEB_PORT=9090 docker compose up --build web
# 浏览器访问 http://localhost:9090

# 一次性验收（自动等待 web 就绪，输出测试结果后退出）
docker compose up --build --exit-code-from verify verify
```

## 目录结构

```
src/
  bdd/bdd.ts            ROBDD 核心
  validation.ts         校验与错误排序
  analysis.ts           等价判定 / 反例 / 逐门复算
  graphLayout.ts        确定性分层布局
  review/sha256.ts      手写 SHA-256（确定性、无依赖）
  review/chain.ts       审查链：封存 / 摘要 / 校验 / 存取 / 适用性
  components/GraphSvg.tsx
  components/TraceTable.tsx
  components/ReviewChainPanel.tsx
  App.tsx main.tsx styles.css examples.ts
tests/
  unit/                 Vitest（含 App 级审查链集成测试）
  e2e/                  Playwright
Dockerfile docker-compose.yml nginx.conf
```
