import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  title?: string
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('[ErrorBoundary]', error.message, info.componentStack?.slice(0, 400))
  }

  render() {
    if (!this.state.hasError) return this.props.children

    if (this.props.fallback) return this.props.fallback

    return (
      <div className="hud-panel flex flex-col items-center justify-center p-4 min-h-[80px] text-center">
        <div
          className="hud-label mb-1"
          style={{ color: 'var(--color-hud-error)', letterSpacing: '0.12em' }}
        >
          {this.props.title ?? 'PANEL ERROR'}
        </div>
        <p className="text-xs text-hud-text-dim mb-3 max-w-[260px] leading-tight">
          {this.state.error?.message ?? 'An unexpected render error occurred.'}
        </p>
        <button
          className="hud-label text-hud-primary border border-hud-primary/30 px-2 py-0.5 hover:border-hud-primary/70 transition-colors"
          onClick={() => this.setState({ hasError: false, error: undefined })}
        >
          RETRY
        </button>
      </div>
    )
  }
}
