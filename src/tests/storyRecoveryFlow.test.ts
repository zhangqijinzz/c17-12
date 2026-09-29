import { describe, expect, it } from 'vitest';
import { createStarterStory, type StoryDocument } from '../models/story';
import { LocalStoryRepository } from '../repositories/storyRepository';
import { MemoryStorageService } from '../services/storageService';
import { StoryViewModel } from '../viewmodels/storyViewModel';

function corruptedDocument(): string {
  const story = createStarterStory() as unknown as Record<string, unknown>;
  story.characters = [...(story.characters as unknown[]), null, { name: '阿洛' }];
  (story.scenes as unknown[])[0] = { id: createStarterStory().scenes[0].id, title: '旧港口的来信', order: 1, characterIds: ['ghost'] };
  return JSON.stringify(story);
}

describe('LocalStoryRepository 打开结果', () => {
  it('空存储返回 empty，损坏 JSON 返回 corrupt，且都不写回存储', () => {
    const emptyStorage = new MemoryStorageService();
    const emptyRepo = new LocalStoryRepository(emptyStorage);
    expect(emptyRepo.loadResult().outcome).toBe('empty');
    expect(emptyStorage.read()).toBeNull();

    const brokenStorage = new MemoryStorageService();
    brokenStorage.write('{broken');
    const brokenRepo = new LocalStoryRepository(brokenStorage);
    const brokenResult = brokenRepo.loadResult();
    expect(brokenResult.outcome).toBe('corrupt');
    if (brokenResult.outcome === 'empty') throw new Error('不应当为空存储');
    expect(brokenResult.story.id).toBe(createStarterStory().id);
    expect(brokenStorage.read()).toBe('{broken');
  });

  it('可修复文档返回 repaired 且原内容保留在存储里', () => {
    const storage = new MemoryStorageService();
    const raw = corruptedDocument();
    storage.write(raw);
    const result = new LocalStoryRepository(storage).loadResult();
    expect(result.outcome).toBe('repaired');
    if (result.outcome === 'empty' || result.outcome === 'corrupt') throw new Error('应当为 repaired');
    expect(result.story.characters.some((character) => character.name === '阿洛')).toBe(true);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(storage.read()).toBe(raw);
  });
});

describe('StoryViewModel 恢复模式', () => {
  it('修复模式下列出问题，并且打开期间不写回存储', () => {
    const storage = new MemoryStorageService();
    const raw = corruptedDocument();
    storage.write(raw);
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();

    expect(viewModel.snapshot.loadWarning?.kind).toBe('repaired');
    expect(viewModel.snapshot.loadWarning?.issues.length).toBeGreaterThan(0);
    expect(storage.read()).toBe(raw);
  });

  it('修复模式下编辑只留在页面内存中，原内容继续保留在存储里', () => {
    const storage = new MemoryStorageService();
    const raw = corruptedDocument();
    storage.write(raw);
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();

    viewModel.addCharacter('新人', '旁白');
    expect(viewModel.snapshot.hasUnpersistedEdits).toBe(true);
    expect(viewModel.snapshot.stats.characters).toBe(4);
    expect(storage.read()).toBe(raw);
  });

  it('显式保存修复版后才覆盖存储并解除恢复模式', () => {
    const storage = new MemoryStorageService();
    storage.write(corruptedDocument());
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();

    viewModel.saveRecoveredStory();
    expect(viewModel.snapshot.loadWarning).toBeNull();
    const saved = JSON.parse(storage.read() ?? '{}') as StoryDocument;
    expect(saved.characters.some((character) => character.name === '阿洛')).toBe(true);

    // 解除恢复模式后，后续编辑恢复自动保存
    viewModel.addCharacter('后续人物', '');
    const resaved = JSON.parse(storage.read() ?? '{}') as StoryDocument;
    expect(resaved.characters.some((character) => character.name === '后续人物')).toBe(true);
  });

  it('无法修复时临时打开示例，恢复示例前原内容不被覆盖', () => {
    const storage = new MemoryStorageService();
    storage.write('{broken');
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();

    expect(viewModel.snapshot.loadWarning?.kind).toBe('corrupt');
    expect(viewModel.snapshot.story?.id).toBe(createStarterStory().id);
    expect(storage.read()).toBe('{broken');

    viewModel.addCharacter('试着编辑', '');
    expect(storage.read()).toBe('{broken');

    viewModel.resetProject();
    expect(viewModel.snapshot.loadWarning).toBeNull();
    expect(JSON.parse(storage.read() ?? '{}').id).toBe(createStarterStory().id);
  });

  it('忽略告警后原内容仍然受保护不被自动保存', () => {
    const storage = new MemoryStorageService();
    const raw = corruptedDocument();
    storage.write(raw);
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();

    viewModel.dismissLoadWarning();
    expect(viewModel.snapshot.loadWarning?.dismissed).toBe(true);
    viewModel.addCharacter('静默编辑', '');
    expect(storage.read()).toBe(raw);
  });

  it('正常内容打开后没有任何告警，且编辑照常自动保存', () => {
    const storage = new MemoryStorageService();
    storage.write(JSON.stringify(createStarterStory()));
    const viewModel = new StoryViewModel(new LocalStoryRepository(storage));
    viewModel.initialize();
    expect(viewModel.snapshot.loadWarning).toBeNull();
    viewModel.addCharacter('新角色', '路人');
    expect(viewModel.snapshot.hasUnpersistedEdits).toBe(false);
    expect(storage.read()).not.toBe(JSON.stringify(createStarterStory()));
  });
});
