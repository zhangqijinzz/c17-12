import {
  characterColors,
  createId,
  createStarterStory,
  type StoryCharacter,
  type StoryClue,
  type StoryDocument,
  type StoryScene,
} from '../models/story';
import { getStats, getTimelineWarning, orderedScenes, validateName } from '../models/storyRules';
import type { StoryRepository } from '../repositories/storyRepository';

export type ViewModelStatus = 'loading' | 'ready' | 'editing' | 'error' | 'completed';

/** 打开阶段的存储告警；存在时原内容仍留在存储中，不会被自动覆盖。 */
export interface LoadWarning {
  kind: 'repaired' | 'corrupt';
  issues: string[];
  dismissed: boolean;
}

export interface StoryViewState {
  status: ViewModelStatus;
  story: StoryDocument | null;
  stats: ReturnType<typeof getStats>;
  notice: string;
  error: string;
  search: string;
  activeSection: 'overview' | 'characters' | 'clues';
  loadWarning: LoadWarning | null;
  /** 恢复模式下编辑只留在页面内存中，尚未写入存储。 */
  hasUnpersistedEdits: boolean;
}

type Listener = () => void;

export class StoryViewModel {
  private state: StoryViewState = {
    status: 'loading',
    story: null,
    stats: { characters: 0, scenes: 0, clues: 0, unresolvedClues: 0, completion: 0 },
    notice: '',
    error: '',
    search: '',
    activeSection: 'overview',
    loadWarning: null,
    hasUnpersistedEdits: false,
  };
  private readonly listeners = new Set<Listener>();

  constructor(private readonly repository: StoryRepository) {}

  get snapshot(): StoryViewState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  initialize(): void {
    let outcome: ReturnType<StoryRepository['loadResult']>;
    try {
      outcome = this.repository.loadResult();
    } catch {
      this.setState({ status: 'error', error: '故事读取失败，请重置为示例项目。' });
      return;
    }

    if (outcome.outcome === 'empty') {
      const story = createStarterStory();
      this.setState({ status: 'ready', story, stats: getStats(story), error: '', loadWarning: null });
      return;
    }

    const { story } = outcome;
    const status = story.status === 'complete' ? 'completed' : 'ready';
    if (outcome.outcome === 'intact') {
      this.setState({ status, story, stats: getStats(story), error: '', loadWarning: null });
      return;
    }

    this.setState({
      status,
      story,
      stats: getStats(story),
      error: '',
      loadWarning: { kind: outcome.outcome, issues: outcome.issues, dismissed: false },
    });
  }

  setSearch(search: string): void {
    this.setState({ search });
  }

  setSection(activeSection: StoryViewState['activeSection']): void {
    this.setState({ activeSection });
  }

  selectScene(sceneId: string): void {
    this.updateStory((story) => ({ ...story, selectedSceneId: sceneId }));
  }

  addCharacter(name: string, role: string): void {
    const cleanName = validateName(name);
    if (cleanName === '至少输入 2 个字') {
      this.setState({ notice: cleanName });
      return;
    }
    const story = this.requireStory();
    const character: StoryCharacter = {
      id: createId('character'),
      name: cleanName,
      role: role.trim() || '待定义角色',
      color: characterColors[story.characters.length % characterColors.length],
    };
    this.updateStory((current) => ({ ...current, characters: [...current.characters, character] }));
    this.setState({ notice: `已加入人物「${character.name}」` });
  }

  addScene(title: string, summary: string): void {
    const cleanTitle = validateName(title);
    if (cleanTitle === '至少输入 2 个字') {
      this.setState({ notice: cleanTitle });
      return;
    }
    const story = this.requireStory();
    const scene: StoryScene = {
      id: createId('scene'),
      title: cleanTitle,
      order: story.scenes.length + 1,
      summary: summary.trim() || '还没有写下这一幕发生了什么。',
      conflict: '',
      characterIds: [],
      clueIds: [],
    };
    this.updateStory((current) => ({ ...current, scenes: [...current.scenes, scene], selectedSceneId: scene.id }));
    this.setState({ notice: `已创建场景「${scene.title}」` });
  }

  updateScene(sceneId: string, patch: Partial<Pick<StoryScene, 'title' | 'summary' | 'conflict'>>): void {
    this.updateStory((story) => ({
      ...story,
      scenes: story.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)),
    }), false);
  }

  toggleCharacter(sceneId: string, characterId: string): void {
    this.updateStory((story) => ({
      ...story,
      scenes: story.scenes.map((scene) => {
        if (scene.id !== sceneId) return scene;
        const hasCharacter = scene.characterIds.includes(characterId);
        return { ...scene, characterIds: hasCharacter ? scene.characterIds.filter((id) => id !== characterId) : [...scene.characterIds, characterId] };
      }),
    }));
  }

  moveScene(sceneId: string, direction: 'up' | 'down'): void {
    const scenes = orderedScenes(this.requireStory());
    const index = scenes.findIndex((scene) => scene.id === sceneId);
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || nextIndex < 0 || nextIndex >= scenes.length) return;
    [scenes[index], scenes[nextIndex]] = [scenes[nextIndex], scenes[index]];
    this.updateStory((story) => ({ ...story, scenes: scenes.map((scene, sceneIndex) => ({ ...scene, order: sceneIndex + 1 })) }));
    this.setState({ notice: '时间线顺序已更新' });
  }

  addClue(title: string, setupSceneId: string, payoffSceneId: string): void {
    const cleanTitle = validateName(title);
    if (cleanTitle === '至少输入 2 个字') {
      this.setState({ notice: cleanTitle });
      return;
    }
    if (!setupSceneId) {
      this.setState({ notice: '请先选择伏笔埋下的场景' });
      return;
    }
    const clue: StoryClue = { id: createId('clue'), title: cleanTitle, setupSceneId, payoffSceneId };
    this.updateStory((story) => ({
      ...story,
      clues: [...story.clues, clue],
      scenes: story.scenes.map((scene) => scene.id === setupSceneId ? { ...scene, clueIds: [...scene.clueIds, clue.id] } : scene),
    }));
    this.setState({ notice: payoffSceneId ? '伏笔关系已建立' : '伏笔已记录，等待回收' });
  }

  completeProject(): void {
    const story = this.requireStory();
    const completed = { ...story, status: 'complete' as const };
    if (this.state.loadWarning) {
      // 恢复模式下不写存储：标记只保留在页面内存中，刷新后以存储里的状态重新打开
      this.setState({
        story: completed,
        stats: getStats(completed),
        status: 'completed',
        hasUnpersistedEdits: true,
        notice: '完成标记只保留在当前页面，保存修复版后才会写入存储。',
      });
      return;
    }
    if (!this.persist(completed)) return;
    this.setState({ story: completed, stats: getStats(completed), status: 'completed', notice: '项目已标记为完成，仍可继续编辑' });
  }

  resetProject(): void {
    const story = createStarterStory();
    if (!this.persist(story)) return;
    this.setState({
      status: 'ready',
      story,
      stats: getStats(story),
      notice: '已恢复示例项目，存储中的原内容已被示例内容覆盖。',
      error: '',
      loadWarning: null,
      hasUnpersistedEdits: false,
    });
  }

  /** 收起告警横幅；原内容仍保留在存储中，自动保存继续停用。 */
  dismissLoadWarning(): void {
    const warning = this.state.loadWarning;
    if (!warning) return;
    this.setState({ loadWarning: { ...warning, dismissed: true } });
  }

  /** 作者确认后，把修复后的内容显式写回存储（恢复模式下允许覆盖原内容的途径之一）。 */
  saveRecoveredStory(): void {
    const story = this.requireStory();
    if (!this.persist(story)) return;
    this.setState({
      notice: '修复后的内容已保存到浏览器，存储中的原内容已被覆盖。',
      loadWarning: null,
      hasUnpersistedEdits: false,
    });
  }

  get visibleCharacters(): StoryCharacter[] {
    const story = this.requireStory();
    const keyword = this.state.search.trim().toLowerCase();
    return story.characters.filter((character) => `${character.name}${character.role}`.toLowerCase().includes(keyword));
  }

  get visibleScenes(): StoryScene[] {
    const story = this.requireStory();
    const keyword = this.state.search.trim().toLowerCase();
    return orderedScenes(story).filter((scene) => `${scene.title}${scene.summary}${scene.conflict}`.toLowerCase().includes(keyword));
  }

  get selectedScene(): StoryScene | null {
    const story = this.state.story;
    return story?.scenes.find((scene) => scene.id === story.selectedSceneId) ?? null;
  }

  get timelineWarning(): string | null {
    const story = this.state.story;
    return story ? getTimelineWarning(story) : null;
  }

  private requireStory(): StoryDocument {
    if (!this.state.story) throw new Error('故事尚未初始化');
    return this.state.story;
  }

  private updateStory(updater: (story: StoryDocument) => StoryDocument, showEditing = true): void {
    const story = updater(this.requireStory());
    if (this.state.loadWarning) {
      // 恢复模式下绝不自动写回：原内容留在存储里，编辑先保留在页面内存中。
      this.setState({
        story,
        stats: getStats(story),
        status: showEditing ? 'editing' : this.state.status,
        error: '',
        hasUnpersistedEdits: true,
      });
      return;
    }
    if (!this.persist(story)) return;
    this.setState({ story, stats: getStats(story), status: showEditing ? 'editing' : this.state.status, error: '' });
  }

  /** 写回存储。返回 false 表示写入失败（调用方不得清空内存中的编辑）。 */
  private persist(story: StoryDocument): boolean {
    try {
      this.repository.save({ ...story, updatedAt: new Date().toISOString() });
      return true;
    } catch {
      this.setState({ status: 'error', error: '保存失败，但当前编辑仍保留在页面中。' });
      return false;
    }
  }

  private setState(patch: Partial<StoryViewState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}
