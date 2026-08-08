import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; label?: string }
interface State { error: Error | null }

// Class component because componentDidCatch has no hook equivalent. Wraps
// each page's body (see App.tsx) so a bug in one page can't blank the whole
// app — e.g. a hook throwing from a realtime double-subscription, which is
// exactly what happened with useCountdowns() before it was fixed to use a
// per-instance channel name.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`ErrorBoundary${this.props.label ? ` (${this.props.label})` : ''}:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{
        padding: '20px 22px', margin: 16, borderRadius: 8,
        background: 'var(--surface)', border: '1px solid var(--line)',
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>
          Noe gikk galt{this.props.label ? ` i ${this.props.label}` : ''}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)', marginBottom: 14 }}>
          {error.message}
        </div>
        <button className="btn ghost sm" onClick={() => this.setState({ error: null })}>Prøv igjen</button>
      </div>
    );
  }
}
