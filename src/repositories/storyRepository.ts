import { createStarterStory, type StoryDocument } from '../models/story';
import { restoreStory, type StoryLoadResult } from '../models/storyRules';
import type { StorageService } from '../services/storageService';

export type RepositoryLoadOutcome = StoryLoadResult | { outcome: 'empty' };
export interface StoryRepository {
  /** 打开阶段的完整结果：空存储 / 完整 / 已修复 / 无法识别。 */
  loadResult(): RepositoryLoadOutcome;
  load(): StoryDocument;
  save(story: StoryDocument): void;
}

export class LocalStoryRepository implements StoryRepository {
  constructor(private readonly storage: StorageService) {}

  loadResult(): RepositoryLoadOutcome {
    let raw: string | null;
    try {
      raw = this.storage.read();
    } catch {
      return {
        outcome: 'corrupt',
        story: createStarterStory(),
        issues: ['浏览器存储无法访问，已临时退回示例内容。'],
      };
    }
    if (!raw) return { outcome: 'empty' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        outcome: 'corrupt',
        story: createStarterStory(),
        issues: ['存储的内容无法解析（不是有效的 JSON），已退回示例内容。'],
      };
    }

    const result = restoreStory(parsed);
    if (result.outcome === 'corrupt') {
      return {
        outcome: 'corrupt',
        story: createStarterStory(),
        issues: ['存储的故事结构无法识别，已退回示例内容。', ...result.issues],
      };
    }
    return result;
  }

  load(): StoryDocument {
    const result = this.loadResult();
    return result.outcome === 'empty' ? createStarterStory() : result.story;
  }

  save(story: StoryDocument): void {
    this.storage.write(JSON.stringify(story));
  }
}
