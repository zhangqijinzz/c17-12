import { describe, expect, it } from 'vitest';
import { createStarterStory, type StoryDocument } from '../models/story';
import {
  getStats,
  getTimelineWarning,
  orderedScenes,
  repairStoryDocument,
  sanitizeStory,
  validateName,
} from '../models/storyRules';

describe('story domain rules', () => {
  it('sorts scenes and calculates unresolved clues', () => {
    const story = createStarterStory();
    story.scenes = [...story.scenes].reverse();
    expect(orderedScenes(story).map((scene) => scene.title)).toEqual(['旧港口的来信', '风暴前夜']);
    expect(getStats(story)).toMatchObject({ characters: 2, scenes: 2, clues: 1, unresolvedClues: 1, completion: 80 });
  });

  it('guards invalid names and duplicate timeline orders', () => {
    const story = createStarterStory();
    story.scenes[1].order = story.scenes[0].order;
    expect(validateName(' ')).toBe('至少输入 2 个字');
    expect(getTimelineWarning(story)).toContain('重复');
  });

  it('rejects corrupt persisted documents', () => {
    expect(sanitizeStory('{bad json}')).toBeNull();
    expect(sanitizeStory({ version: 99 })).toBeNull();
    expect(sanitizeStory(createStarterStory())).not.toBeNull();
  });
});

describe('repairStoryDocument — 干净内容原样返回', () => {
  it('returns the original object untouched when fully valid', () => {
    const story = createStarterStory();
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('clean');
    expect(result.issues).toEqual([]);
    expect(result.story).toBe(story);
  });

  it('does not change a single field of valid content', () => {
    const story = createStarterStory();
    const snapshot = JSON.parse(JSON.stringify(story));
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('clean');
    expect(result.story).toEqual(snapshot);
  });
});

describe('repairStoryDocument — 无法识别时退回示例', () => {
  it.each([
    ['null', null],
    ['字符串', 'hello'],
    ['数字', 42],
    ['数组', [1, 2]],
    ['版本不兼容', { version: 99 }],
    ['人物列表不是数组', { version: 1, characters: 'x', scenes: [], clues: [] }],
    ['场景列表不是数组', { version: 1, characters: [], scenes: {}, clues: [] }],
    ['伏笔列表不是数组', { version: 1, characters: [], scenes: [], clues: null }],
  ])('falls back for %s', (_label, input) => {
    const result = repairStoryDocument(input);
    expect(result.outcome).toBe('fallback');
    expect(result.story.id).toBe(createStarterStory().id);
  });
});

describe('repairStoryDocument — 逐条记录修复', () => {
  it('replaces an empty character record and keeps the rest', () => {
    const story = createStarterStory();
    (story.characters as unknown[])[0] = null;
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('repaired');
    const repaired = result.story;
    expect(repaired.characters).toHaveLength(2);
    expect(repaired.characters[0].name).toBe('未命名人物');
    expect(repaired.characters[0].id).toBeTruthy();
    expect(repaired.characters[1].name).toBe('裘恩');
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('fills defaults for a character missing name / role / color', () => {
    const story = createStarterStory();
    const partial = { id: story.characters[0].id } as Partial<StoryDocument['characters'][number]>;
    (story.characters as unknown[])[0] = partial;
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('repaired');
    const repaired = result.story;
    expect(repaired.characters[0]).toMatchObject({
      id: story.characters[0].id,
      name: '未命名人物',
      role: '待定义角色',
    });
    expect(repaired.characters[0].color).toBeTruthy();
  });

  it('replaces an empty scene record and keeps valid fields of others', () => {
    const story = createStarterStory();
    (story.scenes as unknown[])[1] = {};
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('repaired');
    const repaired = result.story;
    expect(repaired.scenes).toHaveLength(2);
    expect(repaired.scenes[1].title).toBe('未命名场景');
    expect(repaired.scenes[1].order).toBe(2);
    expect(repaired.scenes[0].title).toBe('旧港口的来信');
  });

  it('reindexes a scene whose order is missing', () => {
    const story = createStarterStory();
    delete (story.scenes[0] as Partial<StoryDocument['scenes'][number]>).order;
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.scenes[0].order).toBe(1);
  });

  it('defaults missing summary / conflict to empty strings', () => {
    const story = createStarterStory();
    const scene = story.scenes[0] as unknown as Record<string, unknown>;
    delete scene.summary;
    delete scene.conflict;
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.scenes[0].summary).toBe('');
    expect(result.story.scenes[0].conflict).toBe('');
  });

  it('replaces an empty clue record', () => {
    const story = createStarterStory();
    (story.clues as unknown[])[0] = null;
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.clues).toHaveLength(1);
    expect(result.story.clues[0].title).toBe('未命名伏笔');
  });
});

describe('repairStoryDocument — 引用校验与修复', () => {
  it('removes dangling and non-string character references from a scene', () => {
    const story = createStarterStory();
    const scene = story.scenes[0] as unknown as Record<string, unknown>;
    scene.characterIds = [story.characters[0].id, 'ghost-character', 42, story.characters[1].id];
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.scenes[0].characterIds).toEqual([story.characters[0].id, story.characters[1].id]);
  });

  it('empties a corrupted characterIds list', () => {
    const story = createStarterStory();
    (story.scenes[0] as unknown as Record<string, unknown>).characterIds = 'not-an-array';
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.scenes[0].characterIds).toEqual([]);
  });

  it('removes dangling clue references from a scene', () => {
    const story = createStarterStory();
    (story.scenes[1] as unknown as Record<string, unknown>).clueIds = ['ghost-clue'];
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.scenes[1].clueIds).toEqual([]);
  });

  it('back-fills missing scene.clueIds from the clue setup reference', () => {
    const story = createStarterStory();
    (story.scenes[0] as unknown as Record<string, unknown>).clueIds = [];
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.scenes[0].clueIds).toContain(story.clues[0].id);
  });

  it('clears a clue setup / payoff reference that points to a missing scene', () => {
    const story = createStarterStory();
    const clue = story.clues[0] as unknown as Record<string, unknown>;
    clue.setupSceneId = 'ghost-scene';
    clue.payoffSceneId = 'another-ghost';
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.clues[0].setupSceneId).toBe('');
    expect(result.story.clues[0].payoffSceneId).toBe('');
  });

  it('repairs a dangling selectedSceneId to the first scene', () => {
    const story = createStarterStory();
    story.selectedSceneId = 'ghost-scene';
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.selectedSceneId).toBe(story.scenes[0].id);
  });

  it('fills defaults for missing top-level title / id / status / updatedAt', () => {
    const story = createStarterStory();
    const doc = story as unknown as Record<string, unknown>;
    delete doc.title;
    delete doc.id;
    delete doc.status;
    delete doc.updatedAt;
    const result = repairStoryDocument(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.title).toBe('未命名故事');
    expect(result.story.id).toBeTruthy();
    expect(result.story.status).toBe('draft');
    expect(result.story.updatedAt).toBeTruthy();
  });
});
