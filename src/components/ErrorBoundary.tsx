import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  onReset: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * 渲染兜底：即便故事内容触发了渲染期异常，也不会白屏，
 * 作者仍能通过「恢复示例项目」入口重置，且不会自动覆盖存储中的原始内容。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('故事工作台渲染失败：', error, info);
  }

  handleReset = (): void => {
    this.setState({ hasError: false });
    this.props.onReset();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-loading">
          <span className="brand-mark">✦</span>
          <p>故事内容渲染时出现问题，当前数据已保留在浏览器存储中。</p>
          <button className="complete-button" onClick={this.handleReset}>
            恢复示例项目
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
