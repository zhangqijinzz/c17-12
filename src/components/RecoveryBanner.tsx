import type { LoadWarning, StoryViewModel } from '../viewmodels/storyViewModel';

interface RecoveryBannerProps {
  viewModel: StoryViewModel;
  warning: LoadWarning;
}

export function RecoveryBanner({ viewModel, warning }: RecoveryBannerProps) {
  if (warning.dismissed) {
    return (
      <div className="recovery-strip" role="status">
        <span>
          {warning.kind === 'repaired'
            ? '正在查看修复后的内容，原内容仍保留在存储中且未被覆盖。'
            : '正在临时预览示例内容，原内容仍保留在存储中且未被覆盖。'}
          {viewModel.snapshot.hasUnpersistedEdits && ' 当前编辑只留在页面中，刷新后会丢失。'}
        </span>
        <span className="recovery-actions">
          {warning.kind === 'repaired' && <button className="banner-primary" onClick={() => viewModel.saveRecoveredStory()}>保存修复版</button>}
          <button onClick={() => viewModel.resetProject()}>恢复示例</button>
        </span>
      </div>
    );
  }

  return (
    <div className={warning.kind === 'repaired' ? 'recovery-banner repaired' : 'recovery-banner corrupt'} role="alert">
      <div className="recovery-copy">
        <strong>
          {warning.kind === 'repaired'
            ? '原内容没有正常读取：部分记录或引用缺失，已按默认值补全后继续打开。'
            : '原内容没有正常读取，已临时退回示例内容。'}
        </strong>
        <p>原始内容仍保留在浏览器存储中，没有被覆盖；在你明确处理之前，编辑不会自动保存。</p>
        {warning.issues.length > 0 && (
          <ul className="recovery-issues">
            {warning.issues.map((issue, index) => <li key={index}>{issue}</li>)}
          </ul>
        )}
      </div>
      <div className="recovery-actions">
        {warning.kind === 'repaired'
          ? <button className="banner-primary" onClick={() => viewModel.saveRecoveredStory()}>保存修复后的内容（覆盖原内容）</button>
          : <button className="banner-primary" onClick={() => viewModel.resetProject()}>恢复示例并覆盖原内容</button>}
        {warning.kind === 'repaired' && <button onClick={() => viewModel.resetProject()}>放弃修复，恢复示例</button>}
        <button className="banner-dismiss" onClick={() => viewModel.dismissLoadWarning()}>先不处理，保留原内容</button>
      </div>
    </div>
  );
}
