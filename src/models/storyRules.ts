import {
  characterColors,
  createId,
  createStarterStory,
  type StoryCharacter,
  type StoryClue,
  type StoryDocument,
  type StoryScene,
  type StoryStats,
  type StoryStatus,
} from '../models/story';

export type StoryLoadOutcome = 'clean' | 'repaired' | 'fallback';

export interface StoryLoadResult {
  outcome: StoryLoadOutcome;
  story: StoryDocument;
  issues: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const DEFAULT_CHARACTER_NAME = '未命名人物';
const DEFAULT_SCENE_TITLE = '未命名场景';
const DEFAULT_CLUE_TITLE = '未命名伏笔';
const DEFAULT_STORY_TITLE = '未命名故事';
const DEFAULT_ROLE = '待定义角色';

function defaultCharacter(index: number): StoryCharacter {
  return {
    id: createId('character'),
    name: DEFAULT_CHARACTER_NAME,
    role: DEFAULT_ROLE,
    color: characterColors[index % characterColors.length],
  };
}

function defaultScene(index: number): StoryScene {
  return {
    id: createId('scene'),
    title: DEFAULT_SCENE_TITLE,
    order: index + 1,
    summary: '',
    conflict: '',
    characterIds: [],
    clueIds: [],
  };
}

function defaultClue(): StoryClue {
  return { id: createId('clue'), title: DEFAULT_CLUE_TITLE, setupSceneId: '', payoffSceneId: '' };
}

function kindLabel(kind: 'character' | 'scene' | 'clue'): string {
  return kind === 'character' ? '人物' : kind === 'scene' ? '场景' : '伏笔';
}

function readRecordId(
  record: Record<string, unknown>,
  kind: 'character' | 'scene' | 'clue',
  index: number,
  seen: Set<string>,
  issue: (message: string) => void,
): string {
  const raw = record.id;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    if (seen.has(raw)) {
      issue(`${kindLabel(kind)}「${raw}」的 id 与其他记录重复，已重新生成`);
      return createId(kind);
    }
    return raw;
  }
  issue(`第 ${index + 1} 条${kindLabel(kind)}记录缺少 id，已自动生成`);
  return createId(kind);
}

function readNonEmptyString(
  record: Record<string, unknown>,
  field: 'name' | 'title',
  fallback: string,
  issue: () => void,
): string {
  const raw = record[field];
  if (typeof raw === 'string' && raw.trim().length > 0) return raw;
  issue();
  return fallback;
}

/**
 * 深度校验从存储中读出的故事文档。
 *
 * 与旧实现只看最外层不同，这里会逐条校验人物 / 场景 / 伏笔记录，
 * 并校验记录之间的相互引用（场景出场人物、场景伏笔、伏笔的埋下 / 回收场景）。
 *
 * - clean：内容完整自洽，原样返回（不改动一个字）。
 * - repaired：存在可修复的缺失或失效引用，补全默认值后返回修复版。
 * - fallback：文档骨架无法识别（非对象、版本不兼容、三个列表不是数组），退回示例内容。
 */
export function repairStoryDocument(input: unknown): StoryLoadResult {
  const fallback = (reason: string): StoryLoadResult => ({
    outcome: 'fallback',
    story: createStarterStory(),
    issues: [reason],
  });

  if (!isPlainObject(input)) return fallback('存储的内容不是有效的故事文档');
  const doc = input as Record<string, unknown>;

  if (doc.version !== 1) return fallback('文档版本无法识别，可能来自不兼容的版本');
  if (!Array.isArray(doc.characters) || !Array.isArray(doc.scenes) || !Array.isArray(doc.clues)) {
    return fallback('人物、场景或伏笔列表损坏，无法逐条读取');
  }

  const issues: string[] = [];
  const issue = (message: string): void => {
    issues.push(message);
  };

  // ---- 人物记录：逐条校验 ----
  const characters: StoryCharacter[] = [];
  const characterIds = new Set<string>();
  (doc.characters as unknown[]).forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      issue(`第 ${index + 1} 条人物记录为空或无法识别，已替换为默认人物`);
      const replacement = defaultCharacter(characters.length);
      characters.push(replacement);
      characterIds.add(replacement.id);
      return;
    }
    const record = raw as Record<string, unknown>;
    const id = readRecordId(record, 'character', index, characterIds, issue);
    const name = readNonEmptyString(record, 'name', DEFAULT_CHARACTER_NAME, () =>
      issue(`第 ${index + 1} 条人物记录缺少姓名，已补为默认名称`),
    );
    const role =
      typeof record.role === 'string' && record.role.trim().length > 0
        ? record.role
        : (issue(`人物「${name}」缺少身份，已补为默认身份`), DEFAULT_ROLE);
    const color =
      typeof record.color === 'string' && (characterColors as readonly string[]).includes(record.color)
        ? record.color
        : (issue(`人物「${name}」的代表色缺失或无效，已补为默认颜色`),
          characterColors[characters.length % characterColors.length]);
    const character: StoryCharacter = { id, name, role, color };
    characters.push(character);
    characterIds.add(id);
  });

  // ---- 场景记录：逐条校验（先保留原始记录，伏笔引用稍后统一处理） ----
  const scenes: StoryScene[] = [];
  const sceneIds = new Set<string>();
  const sceneRawRecords: (Record<string, unknown> | null)[] = [];
  (doc.scenes as unknown[]).forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      issue(`第 ${index + 1} 条场景记录为空或无法识别，已替换为默认场景`);
      const replacement = defaultScene(scenes.length);
      scenes.push(replacement);
      sceneIds.add(replacement.id);
      sceneRawRecords.push(null);
      return;
    }
    const record = raw as Record<string, unknown>;
    sceneRawRecords.push(record);
    const id = readRecordId(record, 'scene', index, sceneIds, issue);
    const title = readNonEmptyString(record, 'title', DEFAULT_SCENE_TITLE, () =>
      issue(`第 ${index + 1} 条场景记录缺少标题，已补为默认标题`),
    );
    const order =
      typeof record.order === 'number' && Number.isFinite(record.order)
        ? record.order
        : (issue(`场景「${title}」的顺序缺失或无效，已按列表顺序重新编号`), scenes.length + 1);
    const summary =
      typeof record.summary === 'string'
        ? record.summary
        : (issue(`场景「${title}」的摘要缺失，已留空`), '');
    const conflict =
      typeof record.conflict === 'string'
        ? record.conflict
        : (issue(`场景「${title}」的核心冲突缺失，已留空`), '');

    let characterIdsList: string[];
    if (Array.isArray(record.characterIds)) {
      const valid: string[] = [];
      for (const entry of record.characterIds as unknown[]) {
        if (typeof entry !== 'string') {
          issue(`场景「${title}」的出场人物列表含无效项，已移除该项`);
          continue;
        }
        if (!characterIds.has(entry)) {
          issue(`场景「${title}」引用了不存在的人物，已移除该引用`);
          continue;
        }
        valid.push(entry);
      }
      characterIdsList = valid;
    } else {
      issue(`场景「${title}」的出场人物列表损坏，已清空`);
      characterIdsList = [];
    }

    const scene: StoryScene = { id, title, order, summary, conflict, characterIds: characterIdsList, clueIds: [] };
    scenes.push(scene);
    sceneIds.add(id);
  });

  // ---- 伏笔记录：逐条校验，并校验与场景的相互引用 ----
  const clues: StoryClue[] = [];
  const clueIds = new Set<string>();
  (doc.clues as unknown[]).forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      issue(`第 ${index + 1} 条伏笔记录为空或无法识别，已替换为默认伏笔`);
      const replacement = defaultClue();
      clues.push(replacement);
      clueIds.add(replacement.id);
      return;
    }
    const record = raw as Record<string, unknown>;
    const id = readRecordId(record, 'clue', index, clueIds, issue);
    const title = readNonEmptyString(record, 'title', DEFAULT_CLUE_TITLE, () =>
      issue(`第 ${index + 1} 条伏笔记录缺少标题，已补为默认标题`),
    );
    const setupSceneId = readSceneRef(record, 'setupSceneId', sceneIds, title, '埋下', issue);
    const payoffSceneId = readSceneRef(record, 'payoffSceneId', sceneIds, title, '回收', issue);
    const clue: StoryClue = { id, title, setupSceneId, payoffSceneId };
    clues.push(clue);
    clueIds.add(id);
  });

  // ---- 场景的伏笔引用：校验存在性，并与伏笔的埋下引用保持双向一致 ----
  scenes.forEach((scene, index) => {
    const record = sceneRawRecords[index];
    let clueIdList: string[];
    if (record && Array.isArray(record.clueIds)) {
      const valid: string[] = [];
      for (const entry of record.clueIds as unknown[]) {
        if (typeof entry !== 'string') {
          issue(`场景「${scene.title}」的伏笔列表含无效项，已移除该项`);
          continue;
        }
        if (!clueIds.has(entry)) {
          issue(`场景「${scene.title}」引用了不存在的伏笔，已移除该引用`);
          continue;
        }
        valid.push(entry);
      }
      clueIdList = valid;
    } else if (record) {
      issue(`场景「${scene.title}」的伏笔列表损坏，已清空`);
      clueIdList = [];
    } else {
      clueIdList = [];
    }
    for (const clue of clues) {
      if (clue.setupSceneId === scene.id && !clueIdList.includes(clue.id)) {
        issue(`场景「${scene.title}」缺少伏笔「${clue.title}」的反向引用，已补全`);
        clueIdList.push(clue.id);
      }
    }
    scene.clueIds = clueIdList;
  });

  // ---- 顶层字段：缺失则补默认值 ----
  const storyId =
    typeof doc.id === 'string' && doc.id.trim().length > 0
      ? doc.id
      : (issue('文档 id 缺失，已重新生成'), createId('story'));
  const title =
    typeof doc.title === 'string' && doc.title.trim().length > 0
      ? doc.title
      : (issue('文档标题缺失，已补为默认标题'), DEFAULT_STORY_TITLE);
  const status: StoryStatus =
    doc.status === 'draft' || doc.status === 'complete'
      ? doc.status
      : (issue('文档状态无效，已设为草稿'), 'draft');
  const selectedSceneId =
    typeof doc.selectedSceneId === 'string' && (doc.selectedSceneId === '' || sceneIds.has(doc.selectedSceneId))
      ? doc.selectedSceneId
      : (issue('当前选中的场景不存在，已改选第一个场景'), scenes[0]?.id ?? '');
  const updatedAt =
    typeof doc.updatedAt === 'string'
      ? doc.updatedAt
      : (issue('更新时间缺失或无效，已补为当前时间'), new Date().toISOString());

  if (issues.length === 0) {
    return { outcome: 'clean', story: input as unknown as StoryDocument, issues: [] };
  }

  const repaired: StoryDocument = {
    version: 1,
    id: storyId,
    title,
    status,
    characters,
    scenes,
    clues,
    selectedSceneId,
    updatedAt,
  };
  return { outcome: 'repaired', story: repaired, issues };
}

function readSceneRef(
  record: Record<string, unknown>,
  field: 'setupSceneId' | 'payoffSceneId',
  sceneIds: Set<string>,
  clueTitle: string,
  kind: '埋下' | '回收',
  issue: (message: string) => void,
): string {
  const raw = record[field];
  if (typeof raw !== 'string') {
    issue(`伏笔「${clueTitle}」的${kind}场景无效，已清空`);
    return '';
  }
  if (raw === '' || sceneIds.has(raw)) return raw;
  issue(`伏笔「${clueTitle}」${kind}的场景不存在，已解除引用`);
  return '';
}

/**
 * 兼容旧调用：返回可打开的故事文档，无法识别时返回 null（退回示例）。
 */
export function sanitizeStory(input: unknown): StoryDocument | null {
  const result = repairStoryDocument(input);
  return result.outcome === 'fallback' ? null : result.story;
}

export function orderedScenes(story: StoryDocument): StoryScene[] {
  return [...story.scenes].sort((a, b) => a.order - b.order);
}

export function getStats(story: StoryDocument): StoryStats {
  const unresolvedClues = story.clues.filter((clue) => clue.payoffSceneId === '').length;
  const totalSignals = story.characters.length + story.scenes.length + story.clues.length;
  const completedSignals = story.characters.length + story.scenes.length + (story.clues.length - unresolvedClues);
  const completion = totalSignals === 0 ? 0 : Math.round((completedSignals / totalSignals) * 100);
  return {
    characters: story.characters.length,
    scenes: story.scenes.length,
    clues: story.clues.length,
    unresolvedClues,
    completion,
  };
}

export function validateName(value: string): string {
  const cleanValue = value.trim();
  return cleanValue.length < 2 ? '至少输入 2 个字' : cleanValue;
}

export function getTimelineWarning(story: StoryDocument): string | null {
  const orders = story.scenes.map((scene) => scene.order);
  return new Set(orders).size !== orders.length ? '时间线存在重复顺序，请重新排列。' : null;
}
