// App 级集成测试（jsdom）：真实渲染工作台，覆盖审查链的关键交互——
// 封存、草稿失配、刷新复核、链不一致拒绝、只读快照恢复。
// （Playwright 验收在 Docker verify 服务中跑同一批场景。）
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../../src/App';
import { EXAMPLES } from '../../src/examples';
import { CHAIN_STORAGE_KEY } from '../../src/review/chain';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null = null;

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<App />));
}

function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
}

function $<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return container.querySelector<T>(selector);
}

function $$<T extends HTMLElement = HTMLElement>(selector: string): T[] {
  return [...container.querySelectorAll<T>(selector)];
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function setValue(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = $$<HTMLButtonElement>('button').find((b) =>
    b.textContent?.includes(text),
  );
  if (!btn) throw new Error(`找不到按钮：${text}`);
  return btn;
}

function loadExampleAndCompare(label: string) {
  click(buttonByText(label));
  click(buttonByText('校验并比较'));
}

function seal(reviewer: string, note = '') {
  setValue($<HTMLInputElement>('[data-testid="seal-reviewer"]')!, reviewer);
  if (note) {
    setValue($<HTMLInputElement>('[data-testid="seal-note"]')!, note);
  }
  click($<HTMLButtonElement>('[data-testid="seal-submit"]')!);
}

beforeEach(() => {
  unmount();
  window.localStorage.clear();
  document.body.innerHTML = '';
});

describe('App 审查链集成', () => {
  it('等价比较后封存：记录入链、标记适用于当前草稿、写入本机存储', () => {
    mount();
    loadExampleAndCompare('示例：等价改版');
    expect($('[data-testid="verdict"]')!.getAttribute('data-equivalent')).toBe(
      'true',
    );

    // 审查人必填：未填时按钮禁用
    expect(
      $<HTMLButtonElement>('[data-testid="seal-submit"]')!.disabled,
    ).toBe(true);

    seal('张工', '首班封存');

    expect($('[data-testid="chain-status"]')!.textContent).toContain('链可信');
    expect($('[data-testid="chain-status"]')!.textContent).toContain(
      '共 1 条封存',
    );
    expect($('[data-testid="chain-record-1"]')!.textContent).toContain('#1');
    expect($('[data-testid="chain-record-1"]')!.textContent).toContain(
      'EQUIVALENT',
    );
    expect($('[data-testid="chain-record-1"]')!.textContent).toContain('张工');
    expect($('[data-testid="applicable-1"]')).not.toBeNull();

    // 本机存储已写入且链可复算
    const raw = window.localStorage.getItem(CHAIN_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!);
    expect(stored.records).toHaveLength(1);
    expect(stored.records[0].digest).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.records[0].prevDigest).toBe('0'.repeat(64));
  });

  it('反例比较后封存：记录绑定反例；草稿一改即不再适用', () => {
    mount();
    loadExampleAndCompare('示例：罕见分歧');
    expect($('[data-testid="verdict"]')!.getAttribute('data-equivalent')).toBe(
      'false',
    );
    seal('李工');
    expect($('[data-testid="applicable-1"]')).not.toBeNull();

    // 展开可见反例与复算输出
    click(buttonByText('展开'));
    expect($('[data-testid="chain-detail-1"]')!.textContent).toContain(
      'A=0, B=0, C=1',
    );

    // 改动草稿（尚未重新比较）：标记立即失效
    setValue($<HTMLTextAreaElement>('#ta-b')!, EXAMPLES.equiv.b);
    expect($('[data-testid="applicable-1"]')).toBeNull();

    // 重新比较得到等价结论：旧反例记录仍不适用
    click(buttonByText('校验并比较'));
    expect($('[data-testid="verdict"]')!.getAttribute('data-equivalent')).toBe(
      'true',
    );
    expect($('[data-testid="applicable-1"]')).toBeNull();

    // 新结论可再封存，仅新记录适用
    seal('王工');
    expect($('[data-testid="chain-record-2"]')).not.toBeNull();
    expect($('[data-testid="applicable-2"]')).not.toBeNull();
    expect($('[data-testid="applicable-1"]')).toBeNull();
  });

  it('刷新（重挂载）后逐条重算链：可信且摘要不变', () => {
    mount();
    loadExampleAndCompare('示例：等价改版');
    seal('张工');
    const digest = JSON.parse(
      window.localStorage.getItem(CHAIN_STORAGE_KEY)!,
    ).records[0].digest as string;

    unmount();
    mount(); // 模拟换班人员重新打开工作台

    expect($('[data-testid="chain-status"]')!.textContent).toContain('链可信');
    expect($('[data-testid="chain-record-1"]')!.textContent).toContain('#1');
    click(buttonByText('展开'));
    expect($('[data-testid="chain-digest-1"]')!.textContent).toBe(digest);
    // 尚未比较，无“适用于当前草稿”标记
    expect($('[data-testid="applicable-1"]')).toBeNull();
  });

  it('链内不一致：显示不可信并停止新增封存', () => {
    mount();
    loadExampleAndCompare('示例：等价改版');
    seal('张工');

    // 篡改本机存储中的记录
    const raw = JSON.parse(window.localStorage.getItem(CHAIN_STORAGE_KEY)!);
    raw.records[0].note = '被篡改';
    window.localStorage.setItem(CHAIN_STORAGE_KEY, JSON.stringify(raw));

    unmount();
    mount();

    expect($('[data-testid="review-chain"]')!.getAttribute('data-status')).toBe(
      'untrusted',
    );
    expect($('[data-testid="chain-status"]')!.textContent).toContain(
      '链不可信',
    );
    expect($('[data-testid="chain-status"]')!.textContent).toContain(
      '已停止新增封存',
    );
    expect(
      $<HTMLButtonElement>('[data-testid="restore-1"]')!.disabled,
    ).toBe(true);

    // 即使完成新比较，也不得新增封存
    loadExampleAndCompare('示例：等价改版');
    expect($('[data-testid="seal-blocked"]')!.textContent).toContain(
      '已停止新增封存',
    );
    expect($('[data-testid="seal-submit"]')).toBeNull();
  });

  it('恢复只读快照后再次比较：结论与封存一致，退出后可编辑', () => {
    mount();
    loadExampleAndCompare('示例：罕见分歧');
    seal('张工');

    // 清空模拟换班
    click(buttonByText('清空'));
    expect($('[data-testid="verdict"]')).toBeNull();

    click($('[data-testid="restore-1"]')!);

    const banner = $('[data-testid="snapshot-banner"]')!;
    expect(banner.getAttribute('data-consistent')).toBe('true');
    expect(banner.textContent).toContain('复算结论与封存内容一致');
    expect($<HTMLTextAreaElement>('#ta-a')!.readOnly).toBe(true);
    expect($<HTMLTextAreaElement>('#ta-b')!.readOnly).toBe(true);
    expect($('[data-testid="verdict"]')!.getAttribute('data-equivalent')).toBe(
      'false',
    );
    expect(
      $$('[data-testid="counterexample"] .ce__bit').map((b) => b.textContent),
    ).toEqual(['0', '0', '1']);
    expect($('[data-testid="applicable-1"]')).not.toBeNull();

    click($('[data-testid="exit-snapshot"]')!);
    expect($<HTMLTextAreaElement>('#ta-a')!.readOnly).toBe(false);
  });

  it('输入错误/比较被拒绝：无封存入口、不产生记录', () => {
    mount();
    loadExampleAndCompare('示例：各类错误');
    expect($('[data-testid="errors"]')).not.toBeNull();
    expect($('[data-testid="seal-section"]')).toBeNull();
    expect($('[data-testid="review-chain"]')!.textContent).toContain(
      '尚无封存记录',
    );
    expect(window.localStorage.getItem(CHAIN_STORAGE_KEY)).toBeNull();
  });
});
