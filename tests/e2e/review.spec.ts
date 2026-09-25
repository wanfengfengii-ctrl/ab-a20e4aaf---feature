import { expect, test, type Page } from '@playwright/test';
import { EXAMPLES } from '../../src/examples';

const CHAIN_KEY = 'interlocking.reviewChain.v1';

async function compareExample(page: Page, key: 'equiv' | 'differ' | 'errors') {
  const label =
    key === 'equiv'
      ? '示例：等价改版'
      : key === 'differ'
        ? '示例：罕见分歧'
        : '示例：各类错误';
  await page.getByRole('button', { name: label }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
}

async function sealCurrent(page: Page, reviewer: string, note = '') {
  await page.getByTestId('seal-reviewer').fill(reviewer);
  if (note) await page.getByTestId('seal-note').fill(note);
  await page.getByTestId('seal-submit').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('等价结论可封存：记录入链并标记适用于当前草稿', async ({ page }) => {
  await compareExample(page, 'equiv');
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'true',
  );

  // 审查人必填：未填写时按钮不可用，不产生记录
  await expect(page.getByTestId('seal-submit')).toBeDisabled();
  await sealCurrent(page, '张工', '首班封存');

  const chain = page.getByTestId('review-chain');
  await expect(chain).toHaveAttribute('data-status', 'ok');
  await expect(page.getByTestId('chain-status')).toContainText('链可信');
  await expect(page.getByTestId('chain-status')).toContainText('共 1 条封存');

  const rec = page.getByTestId('chain-record-1');
  await expect(rec).toContainText('#1');
  await expect(rec).toContainText('EQUIVALENT');
  await expect(rec).toContainText('张工');
  await expect(page.getByTestId('applicable-1')).toBeVisible();

  // 展开：摘要、变量序与逐门复算摘要齐全
  await rec.getByRole('button', { name: '展开' }).click();
  const digest = page.getByTestId('chain-digest-1');
  await expect(digest).toBeVisible();
  expect(await digest.innerText()).toMatch(/^[0-9a-f]{64}$/);
  const detail = page.getByTestId('chain-detail-1');
  await expect(detail).toContainText('[A, B, C]');
  await expect(detail.getByText('封存：旧图 A 逐门复算（拓扑顺序）')).toBeVisible();
  await expect(detail.getByText('封存：新图 B 逐门复算（拓扑顺序）')).toBeVisible();
});

test('反例结论可封存：记录绑定唯一反例与复算输出', async ({ page }) => {
  await compareExample(page, 'differ');
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'false',
  );
  await sealCurrent(page, '李工');

  const rec = page.getByTestId('chain-record-1');
  await expect(rec).toContainText('NOT EQUIVALENT');
  await expect(page.getByTestId('applicable-1')).toBeVisible();

  await rec.getByRole('button', { name: '展开' }).click();
  const detail = page.getByTestId('chain-detail-1');
  await expect(detail).toContainText('A=0, B=0, C=1');
  await expect(detail).toContainText('旧图 A = 1 / 新图 B = 0');
});

test('草稿或结论变化后，记录不再标作适用于当前草稿', async ({ page }) => {
  await compareExample(page, 'equiv');
  await sealCurrent(page, '张工');
  await expect(page.getByTestId('applicable-1')).toBeVisible();

  // 改动新图 B 草稿（尚未重新比较）：标记立即失效
  await page.locator('#ta-b').fill(EXAMPLES.differ.b);
  await expect(page.getByTestId('applicable-1')).toHaveCount(0);

  // 重新比较得到不同结论（反例）：旧记录仍不适用于当前草稿
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'false',
  );
  await expect(page.getByTestId('applicable-1')).toHaveCount(0);

  // 新结论可再封存为第二条；此时仅第二条适用
  await sealCurrent(page, '李工');
  await expect(page.getByTestId('chain-record-2')).toContainText(
    'NOT EQUIVALENT',
  );
  await expect(page.getByTestId('applicable-2')).toBeVisible();
  await expect(page.getByTestId('applicable-1')).toHaveCount(0);
});

test('刷新后逐条重算链：序号、前序摘要与记录摘要一致', async ({ page }) => {
  await compareExample(page, 'equiv');
  await sealCurrent(page, '张工');
  await page.getByTestId('chain-record-1').getByRole('button', { name: '展开' }).click();
  const digest1 = await page.getByTestId('chain-digest-1').innerText();

  await compareExample(page, 'differ');
  await sealCurrent(page, '李工');
  await page.getByTestId('chain-record-2').getByRole('button', { name: '展开' }).click();
  const digest2 = await page.getByTestId('chain-digest-2').innerText();

  // 换班人员重新打开工作台（刷新）
  await page.reload();

  await expect(page.getByTestId('chain-status')).toContainText('链可信');
  await expect(page.getByTestId('chain-status')).toContainText('共 2 条封存');
  await expect(page.getByTestId('chain-record-1')).toContainText('#1');
  await expect(page.getByTestId('chain-record-2')).toContainText('#2');

  // 重算后的记录摘要与封存时完全一致
  await page.getByTestId('chain-record-1').getByRole('button', { name: '展开' }).click();
  await expect(page.getByTestId('chain-digest-1')).toHaveText(digest1);
  await page.getByTestId('chain-record-2').getByRole('button', { name: '展开' }).click();
  await expect(page.getByTestId('chain-digest-2')).toHaveText(digest2);

  // 尚未比较，任何记录都不标作适用于当前草稿
  await expect(page.getByTestId('applicable-1')).toHaveCount(0);
  await expect(page.getByTestId('applicable-2')).toHaveCount(0);
});

test('链内不一致：显示不可信并停止新增封存', async ({ page }) => {
  await compareExample(page, 'equiv');
  await sealCurrent(page, '张工');
  await expect(page.getByTestId('chain-status')).toContainText('链可信');

  // 模拟本机数据被改动（草稿/历史误配）
  await page.evaluate((key) => {
    const raw = JSON.parse(window.localStorage.getItem(key)!);
    raw.records[0].reviewer = '篡改者';
    window.localStorage.setItem(key, JSON.stringify(raw));
  }, CHAIN_KEY);

  await page.reload();

  await expect(page.getByTestId('review-chain')).toHaveAttribute(
    'data-status',
    'untrusted',
  );
  await expect(page.getByTestId('chain-status')).toContainText('链不可信');
  await expect(page.getByTestId('chain-status')).toContainText(
    '已停止新增封存',
  );
  // 记录仍可见供核查，但恢复快照被禁用
  await expect(page.getByTestId('chain-record-1')).toBeVisible();
  await expect(page.getByTestId('restore-1')).toBeDisabled();

  // 即使完成一次新的比较，也不得新增封存
  await compareExample(page, 'equiv');
  await expect(page.getByTestId('verdict')).toBeVisible();
  await expect(page.getByTestId('seal-blocked')).toContainText(
    '审查链不可信，已停止新增封存',
  );
  await expect(page.getByTestId('seal-submit')).toHaveCount(0);
});

test('恢复只读快照后再次比较，结论与封存内容一致', async ({ page }) => {
  await compareExample(page, 'differ');
  await sealCurrent(page, '张工', '反例待复核');

  // 清空工作台，模拟换班
  await page.getByRole('button', { name: '清空' }).click();
  await expect(page.getByTestId('verdict')).toHaveCount(0);

  // 从链中恢复第 1 条快照：草稿只读回填并自动复算
  await page.getByTestId('restore-1').click();

  const banner = page.getByTestId('snapshot-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('data-consistent', 'true');
  await expect(banner).toContainText('复算结论与封存内容一致');

  await expect(page.locator('#ta-a')).toHaveAttribute('readonly', '');
  await expect(page.locator('#ta-b')).toHaveAttribute('readonly', '');

  // 复算结论与封存一致：NOT EQUIVALENT，反例 A=0,B=0,C=1
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'false',
  );
  await expect(page.getByTestId('counterexample').locator('.ce__bit')).toHaveText(
    ['0', '0', '1'],
  );
  // 恢复的记录重新标作适用于当前草稿
  await expect(page.getByTestId('applicable-1')).toBeVisible();

  // 退出快照后恢复可编辑
  await page.getByTestId('exit-snapshot').click();
  await expect(page.locator('#ta-a')).not.toHaveAttribute('readonly', '');
});

test('输入错误/比较被拒绝时不产生封存入口与记录', async ({ page }) => {
  await compareExample(page, 'errors');
  await expect(page.getByTestId('errors')).toBeVisible();

  // 拒绝状态下没有封存入口
  await expect(page.getByTestId('seal-section')).toHaveCount(0);
  // 链保持为空
  await expect(page.getByTestId('review-chain')).toContainText('尚无封存记录');
  const stored = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    CHAIN_KEY,
  );
  expect(stored).toBeNull();
});
