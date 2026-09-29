import { characterColors, createStarterStory, type StoryDocument, type StoryStats } from './story';

export type StoryLoadOutcome = 'intact' | 'repaired' | 'corrupt';

export interface StoryLoadResult {
  outcome: StoryLoadOutcome;
  /** 校验后的文档；corrupt 时为一份可安全渲染的兜底内容（仓储层通常会替换为示例）。 */
  story: StoryDocument;
  /** 校验中发现的问题，逐条说明修复或回退的原因。 */
  issues: string[];
}

const DEFAULT_CHARACTER_COLOR = characterColors[0];
const FALLBACK_STORY = createStarterStory();

function corruptResult(issues: string[]): StoryLoadResult {
  return { outcome: 'corrupt', story: FALLBACK_STORY, issues };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function uniqueStrings(values: unknown[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    if (isString(value) && !result.includes(value)) result.push(value);
  }
  return result;
}

function recordLabel(label: string | null, index: number): string {
  return label ? `${label}（第 ${index + 1} 条）` : `第 ${index + 1} 条`;
}

function sceneLabel(title: string | null, index: number): string {
  const order = title && title.trim() !== '' ? `「${title}」` : '';
  return `第 ${index + 1} 幕${order}`;
}

function deepEquals(left: unknown, right: unknown, seen = new WeakMap<object, object>()): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (!isPlainRecord(left) || !isPlainRecord(right)) {
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) return false;
      return left.every((item, index) => deepEquals(item, right[index], seen));
    }
    return false;
  }
  const previous = seen.get(left);
  if (previous) return previous === right;
  seen.set(left, right);
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  const equal = leftKeys.every((key) => deepEquals(left[key], right[key], seen));
  seen.delete(left);
  return equal;
}

/**
 * 打开阶段的深度校验入口。
 * - intact：内容完整，返回的 story 与输入逐字段一致（同一引用）；
 * - repaired：结构可用但记录或引用存在缺失，已按默认值补全；
 * - corrupt：最外层结构无法识别，调用方应退回示例内容。
 */
export function restoreStory(input: unknown): StoryLoadResult {
  if (!isPlainRecord(input)) {
    return corruptResult(['存储的内容不是可识别的故事结构。']);
  }

  const candidate = input as Record<string, unknown>;
  if (candidate.version !== 1) {
    return corruptResult(['故事数据版本无法识别。']);
  }
  if (!Array.isArray(candidate.characters) || !Array.isArray(candidate.scenes) || !Array.isArray(candidate.clues)) {
    return corruptResult(['缺少人物、场景或伏笔列表，结构不完整。']);
  }

  const issues: string[] = [];

  // ---- 人物：逐条校验，空项/非对象直接丢弃 ----
  const characterIds = new Set<string>();
  const characters = candidate.characters.map((rawItem: unknown, index: number) => {
    if (!isPlainRecord(rawItem)) {
      issues.push(`人物列表${recordLabel(null, index)}是空项或格式损坏，已忽略。`);
      return null;
    }
    const item = rawItem as Record<string, unknown>;
    let changed = false;
    const next: Record<string, unknown> = { ...item };

    if (!isString(item.id) || item.id.trim() === '') {
      next.id = `character-recovered-${index + 1}`;
      issues.push(`人物列表${recordLabel(isString(item.name) ? item.name : null, index)}缺少编号，已补默认编号。`);
      changed = true;
    }
    const id = next.id as string;
    if (characterIds.has(id)) {
      next.id = `${id}-dup-${index + 1}`;
      issues.push(`人物${recordLabel(isString(next.name) ? (next.name as string) : null, index)}编号重复，已重新分配。`);
      changed = true;
    }
    characterIds.add(next.id as string);

    if (!isString(item.name)) {
      next.name = '未命名人物';
      issues.push(`人物列表第 ${index + 1} 条缺少姓名，已补默认值。`);
      changed = true;
    }
    if (!isString(item.role)) {
      next.role = '待定义角色';
      issues.push(`人物「${next.name as string}」缺少身份，已补默认值。`);
      changed = true;
    }
    if (!isString(item.color) || !characterColors.includes(item.color as (typeof characterColors)[number])) {
      next.color = DEFAULT_CHARACTER_COLOR;
      issues.push(`人物「${next.name as string}」的颜色标记无效，已补默认值。`);
      changed = true;
    }
    return changed
      ? (next as unknown as StoryDocument['characters'][number])
      : (item as unknown as StoryDocument['characters'][number]);
  }).filter((item): item is StoryDocument['characters'][number] => item !== null);

  // ---- 场景：字段、出场人物、伏笔引用逐一核对 ----
  const sceneIds = new Set<string>();
  let hasInvalidSceneOrder = false;
  interface ResolvedScene { item: StoryDocument['scenes'][number]; title: string; changed: boolean; originalIndex: number; }
  const sceneEntries: ResolvedScene[] = [];
  candidate.scenes.forEach((rawItem: unknown, index: number) => {
    if (!isPlainRecord(rawItem)) {
      issues.push(`场景列表${recordLabel(null, index)}是空项或格式损坏，已忽略。`);
      return;
    }
    const item = rawItem as Record<string, unknown>;
    let changed = false;
    const next: Record<string, unknown> = { ...item };

    if (!isString(item.id) || item.id.trim() === '') {
      next.id = `scene-recovered-${index + 1}`;
      issues.push(`${sceneLabel(isString(item.title) ? item.title : null, index)}缺少编号，已补默认编号。`);
      changed = true;
    }
    if (sceneIds.has(next.id as string)) {
      next.id = `${next.id as string}-dup-${index + 1}`;
      issues.push(`${sceneLabel(isString(next.title) ? (next.title as string) : null, index)}编号重复，已重新分配。`);
      changed = true;
    }
    sceneIds.add(next.id as string);

    if (!isString(item.title)) {
      next.title = '未命名场景';
      issues.push(`场景列表第 ${index + 1} 条缺少标题，已补默认值。`);
      changed = true;
    }
    if (!isFiniteNumber(item.order) || item.order < 1 || Math.floor(item.order) !== item.order) {
      hasInvalidSceneOrder = true;
      issues.push(`${sceneLabel(isString(next.title) ? (next.title as string) : null, index)}的顺序编号无效。`);
      changed = true;
    }
    if (!isString(item.summary)) {
      next.summary = '还没有写下这一幕发生了什么。';
      issues.push(`${sceneLabel(isString(next.title) ? (next.title as string) : null, index)}缺少剧情摘要，已补默认值。`);
      changed = true;
    }
    if (!isString(item.conflict)) {
      next.conflict = '';
      issues.push(`${sceneLabel(isString(next.title) ? (next.title as string) : null, index)}缺少核心冲突字段，已补为空。`);
      changed = true;
    }

    if (Array.isArray(item.characterIds)) {
      const original = item.characterIds as unknown[];
      const cleaned = uniqueStrings(original);
      const dangling = cleaned.filter((characterId) => !characterIds.has(characterId));
      if (dangling.length > 0) {
        issues.push(`${sceneLabel(isString(next.title) ? (next.title as string) : null, index)}引用了 ${dangling.length} 个不存在的人物，已移除。`);
      }
      const kept = cleaned.filter((characterId) => characterIds.has(characterId));
      if (kept.length !== original.length || !kept.every((value, i) => value === original[i])) changed = true;
      next.characterIds = kept;
    } else {
      next.characterIds = [];
      issues.push(`${sceneLabel(isString(next.title) ? (next.title as string) : null, index)}的出场人物列表缺失，已补为空列表。`);
      changed = true;
    }

    if (Array.isArray(item.clueIds)) {
      // 线索尚未解析，先去重保序，悬空引用在伏笔解析后处理
      const original = item.clueIds as unknown[];
      const cleaned = uniqueStrings(original);
      if (cleaned.length !== original.length || !cleaned.every((value, i) => value === original[i])) changed = true;
      next.clueIds = cleaned;
    } else {
      next.clueIds = [];
      issues.push(`${sceneLabel(isString(next.title) ? (next.title as string) : null, index)}的伏笔引用列表缺失，已补为空列表。`);
      changed = true;
    }

    sceneEntries.push({
      item: changed
        ? (next as unknown as StoryDocument['scenes'][number])
        : (item as unknown as StoryDocument['scenes'][number]),
      title: next.title as string,
      changed,
      originalIndex: index,
    });
  });

  // order 非法时按当前排列位置整体重排，保证时间线可用
  if (hasInvalidSceneOrder) {
    sceneEntries.forEach((entry, index) => {
      const order = index + 1;
      if (entry.item.order !== order) {
        entry.item = { ...entry.item, order };
        entry.changed = true;
      }
    });
    issues.push('已按当前排列重新编排序号。');
  }

  // ---- 伏笔：编号、标题、关联场景逐一核对 ----
  const clueIds = new Set<string>();
  const clues = candidate.clues.map((rawItem: unknown, index: number) => {
    if (!isPlainRecord(rawItem)) {
      issues.push(`伏笔列表${recordLabel(null, index)}是空项或格式损坏，已忽略。`);
      return null;
    }
    const item = rawItem as Record<string, unknown>;
    let changed = false;
    const next: Record<string, unknown> = { ...item };

    if (!isString(item.id) || item.id.trim() === '') {
      next.id = `clue-recovered-${index + 1}`;
      issues.push(`伏笔列表${recordLabel(isString(item.title) ? item.title : null, index)}缺少编号，已补默认编号。`);
      changed = true;
    }
    if (clueIds.has(next.id as string)) {
      next.id = `${next.id as string}-dup-${index + 1}`;
      issues.push(`伏笔${recordLabel(isString(next.title) ? (next.title as string) : null, index)}编号重复，已重新分配。`);
      changed = true;
    }
    clueIds.add(next.id as string);

    if (!isString(item.title)) {
      next.title = '未命名伏笔';
      issues.push(`伏笔列表第 ${index + 1} 条缺少标题，已补默认值。`);
      changed = true;
    }
    if (!isString(item.setupSceneId)) {
      next.setupSceneId = '';
      issues.push(`伏笔「${next.title as string}」缺少埋下场景，已置空。`);
      changed = true;
    } else if (!sceneIds.has(item.setupSceneId)) {
      issues.push(`伏笔「${next.title as string}」埋下场景不存在，已置空。`);
      next.setupSceneId = '';
      changed = true;
    }
    if (!isString(item.payoffSceneId)) {
      next.payoffSceneId = '';
      issues.push(`伏笔「${next.title as string}」缺少回收场景字段，已标记为待回收。`);
      changed = true;
    } else if (item.payoffSceneId !== '' && !sceneIds.has(item.payoffSceneId)) {
      issues.push(`伏笔「${next.title as string}」回收场景不存在，已标记为待回收。`);
      next.payoffSceneId = '';
      changed = true;
    }
    return changed
      ? (next as unknown as StoryDocument['clues'][number])
      : (item as unknown as StoryDocument['clues'][number]);
  }).filter((item): item is StoryDocument['clues'][number] => item !== null);

  // 场景的伏笔引用在伏笔列表解析完后再核对
  const resolvedScenes = sceneEntries.map((entry) => {
    let item = entry.item;
    let changed = entry.changed;
    const dangling = item.clueIds.filter((clueId) => !clueIds.has(clueId));
    if (dangling.length > 0) {
      issues.push(`${sceneLabel(entry.title, entry.originalIndex)}引用了 ${dangling.length} 个不存在的伏笔，已移除。`);
      item = { ...item, clueIds: item.clueIds.filter((clueId) => clueIds.has(clueId)) };
      changed = true;
    }
    // 未做任何修改的记录保持原引用，确保正常内容逐字节不变
    return changed
      ? item
      : ((candidate.scenes as unknown[])[entry.originalIndex] as StoryDocument['scenes'][number]);
  });

  // ---- 最外层剩余字段 ----
  const documentPatch: Partial<StoryDocument> = {};
  if (!isString(candidate.id) || candidate.id.trim() === '') {
    documentPatch.id = 'story-recovered';
    issues.push('故事缺少编号，已补默认编号。');
  }
  if (!isString(candidate.title)) {
    documentPatch.title = '未命名故事';
    issues.push('故事缺少标题，已补默认值。');
  }
  if (candidate.status !== 'draft' && candidate.status !== 'complete') {
    documentPatch.status = 'draft';
    issues.push('故事状态无法识别，已按草稿打开。');
  }
  if (!isString(candidate.selectedSceneId) || !sceneIds.has(candidate.selectedSceneId)) {
    documentPatch.selectedSceneId = resolvedScenes[0]?.id ?? '';
    issues.push('当前选中场景缺失，已切换到第一个场景。');
  }
  if (!isString(candidate.updatedAt) || candidate.updatedAt.trim() === '') {
    documentPatch.updatedAt = new Date(0).toISOString();
  }

  const story: StoryDocument = {
    ...(candidate as unknown as StoryDocument),
    ...documentPatch,
    characters,
    scenes: resolvedScenes,
    clues,
  };

  if (issues.length === 0 && deepEquals(story, candidate)) {
    return { outcome: 'intact', story: candidate as unknown as StoryDocument, issues: [] };
  }
  return { outcome: 'repaired', story, issues };
}

/**
 * 兼容旧调用：返回一份可以安全打开的文档；结构完全无法识别时返回 null。
 */
export function sanitizeStory(input: unknown): StoryDocument | null {
  const result = restoreStory(input);
  return result.outcome === 'corrupt' ? null : result.story;
}

export function orderedScenes(story: StoryDocument): StoryDocument['scenes'] {
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
