import { describe, expect, it } from 'vitest';
import { createStarterStory } from '../models/story';
import { LocalStoryRepository } from '../repositories/storyRepository';
import { MemoryStorageService } from '../services/storageService';
import { StoryViewModel } from '../viewmodels/storyViewModel';

describe('story view model', () => {
  it('initializes, edits, persists, and restores the main flow', () => {
    const repository = new LocalStoryRepository(new MemoryStorageService());
    const viewModel = new StoryViewModel(repository);
    viewModel.initialize();
    expect(viewModel.snapshot.status).toBe('ready');
    viewModel.addCharacter('阿洛', '修复师');
    viewModel.addScene('地下档案室', '他们找到被隐藏的航海日志。');
    const scene = viewModel.selectedScene;
    expect(scene?.title).toBe('地下档案室');
    viewModel.toggleCharacter(scene?.id ?? '', viewModel.snapshot.story?.characters[2]?.id ?? '');
    expect(viewModel.snapshot.stats.characters).toBe(3);

    const restored = new StoryViewModel(repository);
    restored.initialize();
    expect(restored.snapshot.story?.scenes.some((item) => item.title === '地下档案室')).toBe(true);
    expect(restored.snapshot.story?.characters.some((item) => item.name === '阿洛')).toBe(true);
  });

  it('shows recoverable validation feedback and resets corrupt storage', () => {
    const storage = new MemoryStorageService();
    storage.write('{broken');
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();
    viewModel.addCharacter(' ', '');
    expect(viewModel.snapshot.notice).toContain('至少');
    viewModel.resetProject();
    expect(viewModel.snapshot.story?.id).toBe(createStarterStory().id);
  });

  it('falls back to example content for unreadable JSON and keeps storage untouched', () => {
    const storage = new MemoryStorageService();
    const corrupt = '{broken';
    storage.write(corrupt);
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();

    expect(viewModel.snapshot.story?.id).toBe(createStarterStory().id);
    expect(viewModel.snapshot.notice).toContain('无法识别');
    expect(viewModel.snapshot.notice).toContain('未被覆盖');
    // 原始内容仍原样留在存储里，没有被打开流程覆盖
    expect(storage.read()).toBe(corrupt);
  });

  it('opens repaired content with defaults and keeps the original stored bytes', () => {
    const storage = new MemoryStorageService();
    const story = createStarterStory();
    (story.characters as unknown[])[0] = null;
    (story.scenes[0] as unknown as Record<string, unknown>).characterIds = ['ghost'];
    const corrupt = JSON.stringify(story);
    storage.write(corrupt);

    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();

    expect(viewModel.snapshot.notice).toContain('不完整');
    expect(viewModel.snapshot.notice).toContain('未被覆盖');
    expect(viewModel.snapshot.story?.characters[0].name).toBe('未命名人物');
    expect(viewModel.snapshot.story?.scenes[0].characterIds).toEqual([]);
    // 存储里的原始内容一个字节都没变
    expect(storage.read()).toBe(corrupt);
  });

  it('opens valid content unchanged and without a repair notice', () => {
    const storage = new MemoryStorageService();
    const clean = JSON.stringify(createStarterStory());
    storage.write(clean);
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();
    expect(viewModel.snapshot.notice).toBe('');
    expect(viewModel.snapshot.story?.title).toBe('最后的灯塔');
    expect(storage.read()).toBe(clean);
  });
});
