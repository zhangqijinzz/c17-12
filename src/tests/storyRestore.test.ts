import { describe, expect, it } from 'vitest';
import { createStarterStory, type StoryDocument } from '../models/story';
import { restoreStory, sanitizeStory } from '../models/storyRules';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function baseStory(): StoryDocument {
  return clone(createStarterStory());
}

describe('restoreStory —— 正常内容保持不变', () => {
  it('完整文档判定为 intact 且返回同一引用', () => {
    const story = baseStory();
    const result = restoreStory(story);
    expect(result.outcome).toBe('intact');
    expect(result.story).toBe(story);
    expect(result.issues).toEqual([]);
  });

  it('作者手工填写的空冲突、待回收伏笔等合法空值不会被改动', () => {
    const story = baseStory();
    story.scenes[1].conflict = '';
    story.scenes[1].characterIds = [];
    const result = restoreStory(story);
    expect(result.outcome).toBe('intact');
    expect(result.story.scenes[1].conflict).toBe('');
    expect(result.story.scenes[1].characterIds).toEqual([]);
  });

  it('手工添加的未知字段在正常打开时逐字保留', () => {
    const story = baseStory() as unknown as StoryDocument & Record<string, unknown>;
    story.note = '作者私人备注';
    (story.characters[0] as unknown as Record<string, unknown>).mood = '坚定';
    const result = restoreStory(story);
    expect(result.outcome).toBe('intact');
    expect(result.story).toBe(story);
  });
});

describe('restoreStory —— 最外层结构', () => {
  it('非对象、错误版本、缺少核心列表判定为 corrupt', () => {
    expect(restoreStory('{bad json}').outcome).toBe('corrupt');
    expect(restoreStory(null).outcome).toBe('corrupt');
    expect(restoreStory([]).outcome).toBe('corrupt');
    expect(restoreStory({ version: 99 }).outcome).toBe('corrupt');
    const missingScenes = baseStory();
    delete (missingScenes as Partial<StoryDocument>).scenes;
    expect(restoreStory(missingScenes).outcome).toBe('corrupt');
  });

  it('标题、状态、编号等顶层字段缺失时补默认值继续打开', () => {
    const story = baseStory() as unknown as Record<string, unknown>;
    delete story.title;
    story.status = 'weird';
    delete story.id;
    delete story.updatedAt;
    const result = restoreStory(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.title).toBe('未命名故事');
    expect(result.story.status).toBe('draft');
    expect(result.story.id).toBe('story-recovered');
    expect(typeof result.story.updatedAt).toBe('string');
  });

  it('selectedSceneId 悬空时回落到第一个场景', () => {
    const story = baseStory();
    story.selectedSceneId = 'scene-gone';
    const result = restoreStory(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.selectedSceneId).toBe(story.scenes[0].id);
  });
});

describe('restoreStory —— 逐条记录校验', () => {
  it('人物列表中的空项被剔除，缺字段的记录补默认值', () => {
    const story = baseStory() as unknown as Record<string, unknown>;
    story.characters = [
      ...(story.characters as unknown[]),
      null,
      { id: 'x', name: '阿洛' },
      42,
    ];
    const result = restoreStory(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.characters).toHaveLength(3);
    const recovered = result.story.characters[2];
    expect(recovered.name).toBe('阿洛');
    expect(recovered.role).toBe('待定义角色');
    expect(recovered.color).toBe('coral');
  });

  it('场景记录缺少必要文本字段时补默认值', () => {
    const story = baseStory() as unknown as Record<string, unknown>;
    story.scenes = [{ id: 'scene-x', title: '新场景', order: 3 }];
    const result = restoreStory(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.scenes[0].summary).toBe('还没有写下这一幕发生了什么。');
    expect(result.story.clues[0].setupSceneId).toBe('');
  });

  it('伏笔缺少标题和场景引用时补默认值，悬空回收场景置空', () => {
    const story = baseStory();
    story.clues.push({
      id: 'clue-bad',
      title: '罗盘刻痕',
      setupSceneId: story.scenes[0].id,
      payoffSceneId: 'scene-never',
    } as StoryDocument['clues'][number]);
    story.clues.push({ id: 'clue-bad2' } as unknown as StoryDocument['clues'][number]);
    const result = restoreStory(story);
    expect(result.outcome).toBe('repaired');
    const clueBad = result.story.clues.find((clue) => clue.id === 'clue-bad');
    expect(clueBad?.payoffSceneId).toBe('');
    const clueBad2 = result.story.clues.find((clue) => clue.id === 'clue-bad2');
    expect(clueBad2?.title).toBe('未命名伏笔');
    expect(clueBad2?.setupSceneId).toBe('');
  });

  it('重复编号会被重新分配', () => {
    const story = baseStory();
    story.characters.push({ ...story.characters[0], id: story.characters[0].id });
    const result = restoreStory(story);
    const ids = result.story.characters.map((character) => character.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('非法 order 按当前排列重新编号，合法的跳号和重复顺序保持不动', () => {
    const story = baseStory();
    story.scenes[1].order = '二' as unknown as number;
    const invalid = restoreStory(story);
    expect(invalid.story.scenes.map((scene) => scene.order)).toEqual([1, 2]);

    const gap = baseStory();
    gap.scenes[1].order = 99;
    expect(restoreStory(gap).outcome).toBe('intact');

    const duplicate = baseStory();
    duplicate.scenes[1].order = duplicate.scenes[0].order;
    expect(restoreStory(duplicate).outcome).toBe('intact');
  });
});

describe('restoreStory —— 相互引用校验', () => {
  it('场景引用不存在的人物时移除该引用', () => {
    const story = baseStory();
    story.scenes[0].characterIds = [story.characters[0].id, 'ghost-character'];
    const result = restoreStory(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.scenes[0].characterIds).toEqual([story.characters[0].id]);
  });

  it('场景引用不存在的伏笔时移除该引用，有效引用保留', () => {
    const story = baseStory();
    story.scenes[0].clueIds = [story.clues[0].id, 'ghost-clue'];
    const result = restoreStory(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.scenes[0].clueIds).toEqual([story.clues[0].id]);
  });

  it('引用数组里的非字符串、重复值会被清理且保序', () => {
    const story = baseStory();
    const firstId = story.characters[0].id;
    story.scenes[0].characterIds = [firstId, firstId, 123, null] as unknown as string[];
    const result = restoreStory(story);
    expect(result.story.scenes[0].characterIds).toEqual([firstId]);
  });

  it('空项被丢弃后，其余场景的引用与原始下标不错位', () => {
    const story = baseStory() as unknown as Record<string, unknown>;
    story.scenes = [
      null,
      {
        id: 'scene-only',
        title: '唯一的一幕',
        order: 1,
        summary: '内容',
        conflict: '',
        characterIds: [],
        clueIds: [],
      },
    ];
    const result = restoreStory(story);
    expect(result.outcome).toBe('repaired');
    expect(result.story.scenes).toHaveLength(1);
    // 第二条记录合法，应保持原引用（而不是错取到被丢弃的空项）
    expect(result.story.scenes[0]).toBe((story.scenes as unknown[])[1]);
    expect(result.story.selectedSceneId).toBe('scene-only');
  });

  it('修复后所有引用都能在对应列表中找到', () => {
    const story = baseStory() as unknown as Record<string, unknown>;
    story.scenes = [
      {
        id: 's1',
        title: '一幕',
        order: '一',
        summary: 'x',
        conflict: 'y',
        characterIds: ['c1', 'c-missing'],
        clueIds: ['k-missing', 'k1'],
      },
    ];
    story.characters = [{ id: 'c1', name: '甲', role: '主角', color: 'blue' }, null];
    story.clues = [{ id: 'k1', title: '线索', setupSceneId: 's1', payoffSceneId: 's-missing' }];
    story.selectedSceneId = 's-missing';
    const result = restoreStory(story);
    expect(result.outcome).toBe('repaired');
    const characterIds = new Set(result.story.characters.map((character) => character.id));
    const sceneIds = new Set(result.story.scenes.map((scene) => scene.id));
    const clueIds = new Set(result.story.clues.map((clue) => clue.id));
    for (const scene of result.story.scenes) {
      scene.characterIds.forEach((id) => expect(characterIds.has(id)).toBe(true));
      scene.clueIds.forEach((id) => expect(clueIds.has(id)).toBe(true));
    }
    for (const clue of result.story.clues) {
      if (clue.setupSceneId) expect(sceneIds.has(clue.setupSceneId)).toBe(true);
      if (clue.payoffSceneId) expect(sceneIds.has(clue.payoffSceneId)).toBe(true);
    }
    expect(sceneIds.has(result.story.selectedSceneId)).toBe(true);
  });
});

describe('sanitizeStory 兼容入口', () => {
  it('完整和可修复内容返回文档，无法识别返回 null', () => {
    expect(sanitizeStory(baseStory())).not.toBeNull();
    expect(sanitizeStory({ version: 99 })).toBeNull();
    const partial = baseStory() as unknown as Record<string, unknown>;
    delete partial.title;
    expect(sanitizeStory(partial)?.title).toBe('未命名故事');
  });
});
