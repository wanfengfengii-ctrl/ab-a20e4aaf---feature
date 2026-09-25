import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('页面渲染双栏输入与比较按钮', async ({ page }) => {
  await expect(page.locator('#ta-a')).toBeVisible();
  await expect(page.locator('#ta-b')).toBeVisible();
  await expect(page.getByRole('button', { name: '校验并比较' })).toBeVisible();
});

test('等价改版给出 EQUIVALENT，并渲染两幅 SVG 与逐门复算表', async ({ page }) => {
  await page.getByRole('button', { name: '示例：等价改版' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();

  const verdict = page.getByTestId('verdict');
  await expect(verdict).toBeVisible();
  await expect(verdict).toHaveAttribute('data-equivalent', 'true');
  await expect(verdict).toContainText('EQUIVALENT');

  // 两图都有 SVG 节点
  await expect(page.locator('[data-testid="旧图 A"] svg g[data-node-id]')).toHaveCount(5);
  await expect(page.locator('[data-testid="新图 B"] svg g[data-node-id]')).toHaveCount(6);

  // 逐门复算两表齐全
  await expect(page.getByText('旧图 A 逐门复算（拓扑顺序）')).toBeVisible();
  await expect(page.getByText('新图 B 逐门复算（拓扑顺序）')).toBeVisible();
});

test('罕见分歧直接给出反例 A=0,B=0,C=1，输出 A=1/B=0', async ({ page }) => {
  await page.getByRole('button', { name: '示例：罕见分歧' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();

  const verdict = page.getByTestId('verdict');
  await expect(verdict).toHaveAttribute('data-equivalent', 'false');
  await expect(verdict).toContainText('NOT EQUIVALENT');

  const ce = page.getByTestId('counterexample');
  await expect(ce).toBeVisible();
  const bits = ce.locator('.ce__bit');
  await expect(bits).toHaveText(['0', '0', '1']);
  await expect(ce).toContainText('旧图 A = 1');
  await expect(ce).toContainText('新图 B = 0');
});

test('任一错误整次拒绝：显示分类错误且不出现结论与图形', async ({ page }) => {
  await page.getByRole('button', { name: '示例：各类错误' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();

  const errors = page.getByTestId('errors');
  await expect(errors).toBeVisible();
  const items = errors.locator('.error');
  expect(await items.count()).toBeGreaterThanOrEqual(5);

  // 旧图错误全部排在新图错误之前
  const tags = await errors.locator('.error__tag').allInnerTexts();
  const lastA = tags.lastIndexOf('A');
  const firstB = tags.indexOf('B');
  expect(lastA).toBeGreaterThanOrEqual(0);
  expect(firstB).toBeGreaterThan(lastA);

  // 旧结论与图形清空
  await expect(page.getByTestId('verdict')).toHaveCount(0);
  await expect(page.locator('svg')).toHaveCount(0);

  // 错误类别齐全（syntax/duplicate_id/arity/unknown_ref/output/cycle）
  const expectedCounts: Record<string, number> = {
    syntax: 1,
    duplicate_id: 1,
    unknown_ref: 1,
    arity: 3, // A 图 g1、g2；B 图 g1
    output: 1,
    cycle: 1,
  };
  for (const [kind, count] of Object.entries(expectedCounts)) {
    await expect(errors.locator(`.error--${kind}`)).toHaveCount(count);
  }
});

test('修正错误后重新比较可得到结论（拒绝状态可恢复）', async ({ page }) => {
  await page.getByRole('button', { name: '示例：各类错误' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('errors')).toBeVisible();

  await page.getByRole('button', { name: '示例：等价改版' }).click();
  await page.getByRole('button', { name: '校验并比较' }).click();
  await expect(page.getByTestId('verdict')).toHaveAttribute(
    'data-equivalent',
    'true',
  );
  await expect(page.getByTestId('errors')).toHaveCount(0);
});
