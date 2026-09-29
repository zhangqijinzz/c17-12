import { Component, type ErrorInfo, type ReactNode } from 'react';
import { STORAGE_KEY } from '../services/storageService';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  message: string | null;
}

/**
 * 最后一道防线：即使渲染阶段发生意外异常，也给出可操作的恢复入口，
 * 而不是让整个工作台变成无法点击的空白页面。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('故事工作台渲染异常', error, info);
  }

  private handleReset = (): void => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 存储不可用时仍然尝试重新加载
    }
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.message) {
      return (
        <div className="app-loading" role="alert">
          <span className="brand-mark">✦</span>
          <h1>工作台遇到意外问题</h1>
          <p>页面渲染时出现异常，但存储里的内容没有被删除。可以刷新重试，或清空本地故事数据后重新开始。</p>
          <div className="recovery-actions">
            <button className="banner-primary" onClick={() => window.location.reload()}>刷新重试</button>
            <button className="secondary-button" onClick={this.handleReset}>清空本地故事数据</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
