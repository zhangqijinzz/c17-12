import { createStarterStory, type StoryDocument } from '../models/story';
import { repairStoryDocument, type StoryLoadResult } from '../models/storyRules';
import type { StorageService } from '../services/storageService';

export interface StoryRepository {
  load(): StoryLoadResult;
  save(story: StoryDocument): void;
}

export class LocalStoryRepository implements StoryRepository {
  constructor(private readonly storage: StorageService) {}

  load(): StoryLoadResult {
    const raw = this.storage.read();
    // 从未写入过：首次打开，直接给示例内容，不属于「读取失败」。
    if (raw === null) {
      return { outcome: 'clean', story: createStarterStory(), issues: [] };
    }
    try {
      return repairStoryDocument(JSON.parse(raw));
    } catch {
      // 解析失败：退回示例内容。注意这里绝不调用 save，
      // 作者的原始内容仍原样留在存储里，没有被覆盖。
      return {
        outcome: 'fallback',
        story: createStarterStory(),
        issues: ['存储的内容不是有效的 JSON，无法解析'],
      };
    }
  }

  save(story: StoryDocument): void {
    this.storage.write(JSON.stringify(story));
  }
}
