import { expect, test } from '@playwright/test';

// 与 src/reviewChain.ts 的 STORAGE_KEY 保持一致（本机存储中的审查链键）
const CHAIN_KEY = 'interlocking-workbench.review-chain.v1';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('等价结论可封存为审查链记录，并标作适用于当前草稿', async ({ page }) => {
  await page.getByRole('button', { name: '示例：等价改版' }).click();
  // 未完成比较时不产生封存入口
  await expect(page.getByTestId('seal-form')).toHaveCount(0);

  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'true',
  );

  // 审查人为空时封存按钮不可用
  await expect(page.getByTestId('seal-submit')).toBeDisabled();
  await page.getByTestId('reviewer-input').fill('张工');
  await page.getByTestId('remark-input').fill('首轮复核');
  await page.getByTestId('seal-submit').click();

  await expect(page.getByTestId('chain-status')).toContainText(
    '链可信 · 共 1 条封存记录',
  );
  const record = page.getByTestId('chain-record-1');
  await expect(record).toBeVisible();
  await expect(record).toContainText('EQUIVALENT');
  await expect(record).toContainText('审查人：张工');
  await expect(page.getByTestId('applies-1')).toBeVisible();

  // 展开记录：绑定内容齐全
  await record.locator('summary').click();
  await expect(record).toContainText('备注：首轮复核');
  await expect(record).toContainText('共享变量序：[A, B, C]');
  await expect(record.getByText('封存 · 旧图 A（逐门复算摘要）')).toBeVisible();
  await expect(record.getByText('封存 · 新图 B（逐门复算摘要）')).toBeVisible();
  // 首条记录的前序摘要为链起点（64 个 0）
  await expect(page.getByTestId('prevdigest-1')).toHaveText('0'.repeat(64));
  await expect(page.getByTestId('digest-1')).toHaveText(/^[0-9a-f]{64}$/);
});

test('反例结论封存，并与前序记录串接为确定性链', async ({ page }) => {
  // 第一条：等价结论
  await page.getByRole('button', { name: '示例：等价改版' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await page.getByTestId('reviewer-input').fill('张工');
  await page.getByTestId('seal-submit').click();
  await expect(page.getByTestId('chain-record-1')).toBeVisible();

  // 第二条：反例结论（草稿换成罕见分歧后，记录 1 不再适用）
  await page.getByRole('button', { name: '示例：罕见分歧' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'false',
  );
  await page.getByTestId('remark-input').fill('反例复核');
  await page.getByTestId('seal-submit').click();

  await expect(page.getByTestId('chain-status')).toContainText('共 2 条');
  await expect(page.getByTestId('applies-1')).toHaveCount(0);
  await expect(page.getByTestId('applies-2')).toBeVisible();

  const rec2 = page.getByTestId('chain-record-2');
  await expect(rec2).toContainText('NOT EQUIVALENT');
  await rec2.locator('summary').click();
  await expect(rec2).toContainText('反例：A=0, B=0, C=1');
  await expect(rec2).toContainText('复算输出：旧图 A = 1，新图 B = 0');
  await expect(rec2).toContainText('备注：反例复核');

  // 链式串接：记录 2 的前序摘要 = 记录 1 的记录摘要
  const rec1 = page.getByTestId('chain-record-1');
  await rec1.locator('summary').click();
  const digest1 = await page.getByTestId('digest-1').innerText();
  const prev2 = await page.getByTestId('prevdigest-2').innerText();
  expect(prev2).toBe(digest1);
});

test('封存后任一输入草稿变化，记录不再标作适用于当前草稿', async ({ page }) => {
  await page.getByRole('button', { name: '示例：等价改版' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await page.getByTestId('reviewer-input').fill('张工');
  await page.getByTestId('seal-submit').click();
  await expect(page.getByTestId('applies-1')).toBeVisible();

  // 修改草稿（INPUT 名 A -> A2，仍为合法门图，但规范化内容已变）
  const ta = page.locator('#ta-a');
  const draft = await ta.inputValue();
  await ta.fill(draft.replace('"name": "A"', '"name": "A2"'));
  // 草稿一变即失配（无需重新比较）
  await expect(page.getByTestId('applies-1')).toHaveCount(0);

  // 重新比较得到新结论后，旧记录仍不适用于当前草稿
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('verdict')).toBeVisible();
  await expect(page.getByTestId('applies-1')).toHaveCount(0);
});

test('刷新后逐条复核恢复审查链，可恢复只读快照再次比较且结论一致', async ({
  page,
}) => {
  await page.getByRole('button', { name: '示例：罕见分歧' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await page.getByTestId('reviewer-input').fill('张工');
  await page.getByTestId('remark-input').fill('交班前封存');
  await page.getByTestId('seal-submit').click();
  await expect(page.getByTestId('chain-record-1')).toBeVisible();

  // 模拟换班人员重新打开工作台
  await page.reload();
  await expect(page.getByTestId('chain-status')).toContainText(
    '链可信 · 共 1 条封存记录',
  );
  const record = page.getByTestId('chain-record-1');
  await expect(record).toContainText('NOT EQUIVALENT');
  await expect(record).toContainText('审查人：张工');
  // 草稿为空、尚未比较：不得标作适用于当前草稿
  await expect(page.getByTestId('applies-1')).toHaveCount(0);

  // 展开并恢复只读快照
  await record.locator('summary').click();
  await page.getByTestId('restore-1').click();

  await expect(page.getByTestId('snapshot-banner')).toBeVisible();
  await expect(page.getByTestId('snapshot-banner')).toContainText(
    '封存记录 #1',
  );
  await expect(page.locator('#ta-a')).toHaveAttribute('readonly', '');
  await expect(page.locator('#ta-b')).toHaveAttribute('readonly', '');

  // 恢复后自动复核一次，结论与封存内容一致
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'false',
  );
  await expect(page.getByTestId('snapshot-check')).toContainText('核对一致');
  await expect(page.getByTestId('counterexample')).toBeVisible();

  // 快照内容再次比较，结论仍与封存一致
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('snapshot-check')).toContainText('核对一致');
  // 快照即封存草稿，记录重新标作适用
  await expect(page.getByTestId('applies-1')).toBeVisible();
  // 快照核对模式下不新增封存
  await expect(page.getByTestId('seal-form')).toHaveCount(0);

  // 退出快照，编辑区恢复可编辑
  await page.getByRole('button', { name: '退出快照' }).click();
  await expect(page.getByTestId('snapshot-banner')).toHaveCount(0);
  await expect(page.locator('#ta-a')).not.toHaveAttribute('readonly', '');
  await expect(page.locator('#ta-b')).not.toHaveAttribute('readonly', '');
});

test('链内不一致即显示不可信并停止新增封存', async ({ page }) => {
  // 先构造一条合法链
  await page.getByRole('button', { name: '示例：等价改版' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await page.getByTestId('reviewer-input').fill('张工');
  await page.getByTestId('seal-submit').click();
  await expect(page.getByTestId('chain-status')).toContainText('共 1 条');

  // 篡改本机存储中的记录内容（结论被改动但摘要未重算）
  await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error('审查链不存在');
    const data = JSON.parse(raw);
    data.records[0].equivalent = false;
    window.localStorage.setItem(key, JSON.stringify(data));
  }, CHAIN_KEY);

  // 刷新恢复时逐条重算，发现不一致
  await page.reload();
  await expect(page.getByTestId('chain-status')).toContainText('链不可信');
  const broken = page.getByTestId('chain-broken');
  await expect(broken).toBeVisible();
  await expect(broken).toContainText('第 1 条记录');
  await expect(broken).toContainText('记录摘要与内容不匹配');
  // 不可信链不展示记录
  await expect(page.getByTestId('chain-record-1')).toHaveCount(0);

  // 即使完成一次成功比较，也不得出现封存入口
  await page.getByRole('button', { name: '示例：等价改版' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'true',
  );
  await expect(page.getByTestId('seal-form')).toHaveCount(0);

  // 清除不可信链后可重新开始封存
  await page.getByTestId('chain-clear').click();
  await expect(page.getByTestId('chain-status')).toContainText(
    '链可信 · 共 0 条封存记录',
  );
  await expect(page.getByTestId('seal-form')).toBeVisible();
});

test('输入错误整次拒绝时不产生封存入口与记录', async ({ page }) => {
  await page.getByRole('button', { name: '示例：各类错误' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();

  await expect(page.getByTestId('errors')).toBeVisible();
  await expect(page.getByTestId('seal-form')).toHaveCount(0);
  await expect(page.getByTestId('chain-status')).toContainText('共 0 条');
});
