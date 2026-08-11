import { Component } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './Icon.jsx';

/**
 * The one thing standing between a thrown render and a white screen.
 *
 * The app had no boundary at all, which meant any error thrown during render — a bad shape off the
 * API, a chunk that 404s after a deploy, a null deref in a card — unmounted the entire tree and
 * left the visitor looking at `<body>`. There is no recovery from that except a manual reload, and
 * nothing in the console tells the reader that a reload is what they need.
 *
 * ## Two boundaries, not one
 *
 * A single boundary at the root would catch everything and blank everything: the navbar, the
 * bottom nav and the connectivity banner would all go down with the route that broke, so the one
 * affordance that reliably fixes a broken page — navigating somewhere else — disappears exactly
 * when it is needed. So the primary boundary sits *inside* the layouts, around `<Outlet />`: a
 * crash in /property/:id replaces the property page and nothing else, and the chrome around it
 * still works. The root boundary in `main.jsx` is the backstop for the chrome and the providers
 * themselves, where there is nothing left to preserve and a reload is the honest advice.
 *
 * ## Not a silent catch
 *
 * `componentDidCatch` logs before it renders anything, with the route, the scope and the React
 * component stack, so a caught error is *more* diagnosable than an uncaught one, not less. The
 * short reference shown to the user is the same string that is logged, so a support ticket that
 * quotes it can be matched to the console line a colleague pasted.
 *
 * @param {string}  scope     which boundary this is, in logs and in the fallback's layout
 * @param {unknown} resetKey  changing it clears the error — layouts pass the pathname, so
 *                            navigating away from a broken route recovers without a reload
 */

function ErrorFallback({ error, reference, scope, onRetry }) {
  const { t } = useTranslation();
  const atRoot = scope === 'app';
  return (
    <div className="mx-auto max-w-lg px-4 py-16 sm:py-24" data-testid="error-boundary">
      <div className="glass-card rounded-2xl p-6 flex flex-col items-center text-center gap-3">
        <Icon name="alert-triangle" className="w-8 h-8 text-amber-400" />
        <h1 className="text-lg font-bold text-white">{t('common.errorBoundary.title')}</h1>
        <p className="text-gray-300 text-sm leading-relaxed">
          {atRoot ? t('common.errorBoundary.bodyApp') : t('common.errorBoundary.bodyRoute')}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
          {/* Re-render first: a transient failure (a read that resolved to the wrong shape once)
              clears here without losing the rest of the session. Reload is offered alongside
              rather than instead, because the other common cause — a stale lazy chunk after a
              deploy — cannot be fixed by re-rendering the same broken module. */}
          <button type="button" onClick={onRetry} className="pn-control pn-control--action px-4 gap-1.5">
            <Icon name="refresh-cw" className="w-4 h-4" /> {t('common.errorBoundary.tryAgain')}
          </button>
          <button type="button" onClick={() => window.location.reload()} className="pn-control px-4 gap-1.5">
            {t('common.errorBoundary.reload')}
          </button>
          {/* A plain anchor, not <Link>: the root boundary sits outside the router, and at that
              point a full document load is what is wanted anyway. */}
          {atRoot ? <a href="/" className="pn-control px-4 gap-1.5">{t('common.errorBoundary.goHome')}</a> : null}
        </div>
        {/* Quotable. The reference is what ties this screen to the console line and to any log
            drain that collects it; the message is included because in dev it usually names the
            cause outright, and in prod it is still the difference between "a page broke" and a
            reproducible report. */}
        <p className="text-[11px] text-gray-500 mt-2 break-all">
          {t('common.errorBoundary.reference', { ref: reference })}
          {error?.message ? <> · <code className="text-gray-400">{String(error.message).slice(0, 160)}</code></> : null}
        </p>
      </div>
    </div>
  );
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reference: '', resetKey: props.resetKey };
    this.retry = this.retry.bind(this);
  }

  /* Route changes clear the error. Without this, a crash on one route leaves the fallback mounted
     over every subsequent navigation — the boundary itself becomes the outage. Compared against a
     copy held in state rather than in a ref so it survives the error render. */
  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) return { error: null, reference: '', resetKey: props.resetKey };
    return null;
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const reference = Math.random().toString(36).slice(2, 8).toUpperCase();
    /* Logged, always, and loudly. A boundary that renders a friendly card and says nothing is a
       worse outage than the blank page, because the blank page at least gets reported. */
    console.error(
      `[error-boundary] ${this.props.scope || 'unknown'} caught a render error (ref ${reference})`,
      {
        scope: this.props.scope || 'unknown',
        path: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '',
        reference,
        message: error?.message,
      },
      error,
      info?.componentStack,
    );
    this.setState({ reference });
  }

  retry() {
    this.setState({ error: null, reference: '' });
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorFallback
          error={this.state.error}
          reference={this.state.reference}
          scope={this.props.scope}
          onRetry={this.retry}
        />
      );
    }
    return this.props.children;
  }
}
