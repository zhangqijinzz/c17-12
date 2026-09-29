// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import App from '../App';
import { STORAGE_KEY } from '../services/storageService';

// 告知 React 当前环境支持 act 批处理，消除环境告警
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function brokenDocument(): string {
  return JSON.stringify({
    version: 1,
    id: 'story-manual',
    title: '手工改过的故事',
    status: 'draft',
    characters: [
      { id: 'c1', name: '米拉', role: '守望人', color: 'coral' },
      null,
      { id: 'c2' },
    ],
    scenes: [
      {
        id: 's1',
        title: '残缺的一幕',
        order: 'x',
        characterIds: ['c1', 'ghost'],
      },
    ],
    clues: [{ id: 'k1', title: '悬空伏笔', setupSceneId: 's-gone', payoffSceneId: 's1' }],
    selectedSceneId: 's-gone',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('真实浏览器存储 + React 打开损坏数据', () => {
  it('不白屏：修复打开、显示逐条说明、原内容留在存储中', () => {
    const raw = brokenDocument();
    window.localStorage.setItem(STORAGE_KEY, raw);

    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      createRoot(container).render(<StrictMode><App /></StrictMode>);
    });

    // 工作台标题与修复后的内容正常渲染
    expect(container.textContent).toContain('手工改过的故事');
    expect(container.textContent).toContain('残缺的一幕');
    expect(container.textContent).toContain('未命名人物');

    // 明确告知原内容没有正常读取、仍在存储中未被覆盖
    expect(container.textContent).toContain('原内容没有正常读取');
    expect(container.textContent).toContain('没有被覆盖');
    // 逐条问题可看到（空项、缺字段、悬空引用、选中场景）
    expect(container.textContent).toContain('空项');
    expect(container.textContent).toContain('不存在的人物');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);

    // 恢复入口始终可点
    expect(container.querySelector('button')).toBeTruthy();
  });

  it('完全无法识别时也不白屏，临时显示示例且不覆盖原内容', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json');
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      createRoot(container).render(<StrictMode><App /></StrictMode>);
    });

    expect(container.textContent).toContain('最后的灯塔');
    expect(container.textContent).toContain('原内容没有正常读取');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('{not json');
  });
});
