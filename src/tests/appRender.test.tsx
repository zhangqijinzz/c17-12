// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../App';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_KEY = 'story-architect.document.v1';

function renderApp(): { container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
  return { container };
}

describe('App 打开阶段容错', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('损坏数据下不白屏，显示未覆盖提示，且重置入口可恢复示例', () => {
    const corrupt = JSON.stringify({
      version: 1,
      id: 'story-x',
      title: '我的故事',
      status: 'draft',
      characters: [null, { id: 'c1' }],
      scenes: [{ id: 's1', title: '场景一', order: 1, characterIds: ['ghost'] }],
      clues: [],
      selectedSceneId: 'ghost',
      updatedAt: 'bad-date',
    });
    window.localStorage.setItem(STORAGE_KEY, corrupt);

    const { container } = renderApp();

    // 没有白屏：品牌与工作台正常渲染
    expect(container.textContent).toContain('StoryArchitect');
    // 明确告知：内容不完整 + 仍在存储 + 未被覆盖
    expect(container.textContent).toContain('不完整');
    expect(container.textContent).toContain('未被覆盖');
    // 「恢复示例」入口存在且可点
    const resetButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('恢复示例'),
    );
    expect(resetButton).toBeTruthy();
    // 打开流程没有覆盖存储里的原始内容
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(corrupt);

    // 点击重置：恢复示例项目
    act(() => {
      resetButton?.click();
    });
    expect(container.textContent).toContain('已恢复示例项目');
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBe(corrupt);
  });

  it('无法解析的内容同样不白屏，并提示示例已打开、原内容未覆盖', () => {
    window.localStorage.setItem(STORAGE_KEY, '{broken');

    const { container } = renderApp();

    expect(container.textContent).toContain('StoryArchitect');
    expect(container.textContent).toContain('无法识别');
    expect(container.textContent).toContain('未被覆盖');
    const resetButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('恢复示例'),
    );
    expect(resetButton).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('{broken');
  });
});
