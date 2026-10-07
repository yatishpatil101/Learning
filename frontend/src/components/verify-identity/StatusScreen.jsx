import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { REJECTION_COPY } from '../../lib/identity-verification/documents.js';

export default function StatusScreen({ status, verifiedName, withdrawing, withdrawError, onDone, onRetry, onWithdraw, onCancelWithdraw, onConfirmWithdraw }) {
  const { t, i18n } = useTranslation();
  const copy = statusCopy(status, t, verifiedName);
  const rejected = status.status === 'rejected';
  const revoked = status.status === 'revoked';
  const retryable = Boolean(status.canRetry);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!withdrawing) {
      setBusy(false);
      return undefined;
    }
    cancelRef.current?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onCancelWithdraw();
        return;
      }
      if (event.key !== 'Tab') return;
      const first = cancelRef.current;
      const last = confirmRef.current;
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [busy, onCancelWithdraw, withdrawing]);

  async function confirmWithdraw() {
    setBusy(true);
    try {
      await onConfirmWithdraw();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 px-6 pb-4 pt-6">
        <BadgeIcon tone={status.status} />
        <h1 className="mt-5 text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.02em]">{copy.title}</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{copy.body}</p>
        <Timeline status={status.status} />
        {(rejected || revoked) && (
          <div className={`mt-5 rounded-xl border px-4 py-4 text-sm leading-6 ${revoked ? 'border-[var(--amber)]/30 bg-[var(--amber)]/[0.07]' : 'border-[var(--rose)]/25 bg-[var(--rose)]/[0.07]'}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">{revoked ? t('verifyIdentity.status.removedLabel') : t('verifyIdentity.status.needsAttention')}</p>
            <p className="mt-2">{revoked ? (status.revocationReason || t('verifyIdentity.status.removedBody')) : rejectionText(status, t)}</p>
            {Number.isFinite(status.attemptsRemaining) && (
              <p className="mt-3 font-mono text-xs tabular-nums text-[var(--text-subtle)]">{t('verifyIdentity.status.attemptsLeft', { count: status.attemptsRemaining })}</p>
            )}
          </div>
        )}
        {(status.docLast4 || status.revokedAt || status.retryAfter) && (
          <dl className="mt-5 border-t border-white/10 pt-4 text-xs">
            {status.docLast4 && <MetaRow label={t('verifyIdentity.status.document')} value={`•••• ${status.docLast4}`} />}
            {status.revokedAt && <MetaRow label={t('verifyIdentity.status.revoked')} value={new Date(status.revokedAt).toLocaleString(i18n.language)} />}
            {status.retryAfter && <MetaRow label={t('verifyIdentity.status.retryAfter')} value={new Date(status.retryAfter).toLocaleString(i18n.language)} />}
          </dl>
        )}
        {withdrawError && <div role="alert" className="mt-5 rounded-xl border border-[var(--rose)]/30 bg-[var(--rose)]/10 px-4 py-3 text-sm text-rose-300">{withdrawError}</div>}
      </div>
      <StickyAction>
        <button type="button" onClick={retryable ? onRetry : onDone} className="btn btn-primary btn-lg w-full">
          {retryable ? t('verifyIdentity.actions.tryAgain') : t('verifyIdentity.actions.done')}
        </button>
        {status.status !== 'none' && (
          <button type="button" data-testid="verify-withdraw-link" onClick={onWithdraw} className="mt-3 min-h-[44px] w-full cursor-pointer text-sm text-[var(--text-subtle)] underline-offset-4 hover:text-white hover:underline">
            {t('verifyIdentity.withdraw.link')}
          </button>
        )}
      </StickyAction>
      {withdrawing && (
        <div className="fixed inset-0 z-[1500] flex items-end bg-black/60 px-4 pb-[calc(1rem+var(--dz-safe-b))]">
          <div role="dialog" aria-modal="true" aria-labelledby="withdraw-title" className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-[var(--brand-card)] p-5 shadow-2xl">
            <h2 id="withdraw-title" className="text-lg font-semibold">{t('verifyIdentity.withdraw.title')}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{t('verifyIdentity.withdraw.body')}</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button ref={cancelRef} type="button" disabled={busy} onClick={onCancelWithdraw} className="btn btn-secondary">{t('verifyIdentity.actions.cancel')}</button>
              <button ref={confirmRef} type="button" disabled={busy} data-testid="verify-withdraw-confirm" onClick={confirmWithdraw} className="btn btn-danger">{busy ? t('verifyIdentity.withdraw.removing') : t('verifyIdentity.withdraw.remove')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StickyAction({ children }) {
  return (
    <div className="sticky bottom-[var(--dz-bottom-inset)] mt-auto border-t border-white/10 bg-[var(--brand-card)]/95 px-6 pb-[calc(1rem+var(--dz-safe-b))] pt-4 backdrop-blur">
      {children}
    </div>
  );
}

function BadgeIcon({ tone = 'none' }) {
  const map = {
    verified: { icon: 'badge-check', color: 'var(--emerald)' },
    rejected: { icon: 'shield-alert', color: 'var(--rose)' },
    revoked: { icon: 'shield-alert', color: 'var(--amber)' },
    pending: { icon: 'clock', color: 'var(--amber)' },
    none: { icon: 'fingerprint', color: 'var(--teal-3)' },
  };
  const { icon, color } = map[tone] || map.none;
  return (
    <div aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-xl border" style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
      <Icon name={icon} className="h-7 w-7" />
    </div>
  );
}

function Timeline({ status }) {
  const { t } = useTranslation();
  const labels = [
    t('verifyIdentity.status.timeline.submitted'),
    t('verifyIdentity.status.timeline.review'),
    status === 'verified'
      ? t('verifyIdentity.status.timeline.verified')
      : status === 'revoked'
        ? t('verifyIdentity.status.timeline.removed')
        : status === 'rejected'
          ? t('verifyIdentity.status.timeline.attention')
          : t('verifyIdentity.status.timeline.verified'),
  ];
  const outcome = { verified: ['var(--emerald)', 'check'], rejected: ['var(--rose)', 'x'], revoked: ['var(--amber)', 'alert-triangle'] }[status];
  const active = outcome ? 2 : status === 'pending' ? 1 : -1;
  const fill = `${(Math.max(active, 0) / (labels.length - 1)) * 100}%`;
  return (
    <ol className="relative mt-7 grid grid-cols-3" data-testid="verify-status-progress">
      <span aria-hidden="true" className="absolute left-[16.67%] right-[16.67%] top-4 h-1 -translate-y-1/2 rounded-full bg-white/10">
        <span className="block h-full rounded-full bg-[var(--teal-2)] transition-[width] duration-500" style={{ width: fill }} />
      </span>
      {labels.map((label, index) => {
        const isCurrent = index === active && !outcome;
        const [color, icon] = index === active && outcome ? outcome : index <= active ? ['var(--teal-2)', 'check'] : [];
        return (
          <li key={label} aria-current={index === active ? 'step' : undefined} className="relative flex flex-col items-center gap-2 text-center">
            <span className="relative grid h-8 w-8 place-items-center">
              {isCurrent && <span aria-hidden="true" className="absolute inset-0 rounded-full bg-[var(--amber)]/40 motion-safe:animate-ping" />}
              <span
                className="relative grid h-8 w-8 place-items-center rounded-full border-2 bg-[var(--brand-card)]"
                style={isCurrent ? { borderColor: 'var(--amber)', color: 'var(--amber)' } : color ? { borderColor: color, background: color, color: 'var(--brand-card)' } : { borderColor: 'rgb(var(--dz-c-white) / calc(0.15 * var(--dz-line-boost)))' }}
              >
                {isCurrent ? <Icon name="clock" className="h-4 w-4" /> : icon && <Icon name={icon} className="h-4 w-4" />}
              </span>
            </span>
            <span className={`text-xs font-semibold ${index <= active ? 'text-white' : 'text-[var(--text-subtle)]'}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function MetaRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-[var(--text-subtle)]">{label}</dt>
      <dd className="font-mono tabular-nums text-[var(--text-muted)]">{value}</dd>
    </div>
  );
}

function statusCopy(status, t, verifiedName) {
  if (status.status === 'pending') return { title: t('verifyIdentity.status.pendingTitle'), body: t('verifyIdentity.status.pendingBody') };
  if (status.status === 'verified') return { title: t('verifyIdentity.status.verifiedTitle'), body: verifiedName ? t('verifyIdentity.status.verifiedAs', { name: verifiedName }) : t('verifyIdentity.status.verifiedBody') };
  if (status.status === 'rejected') return { title: t('verifyIdentity.status.rejectedTitle'), body: t('verifyIdentity.status.rejectedBody') };
  if (status.status === 'revoked') return { title: t('verifyIdentity.status.revokedTitle'), body: t('verifyIdentity.status.revokedBody') };
  return { title: t('verifyIdentity.status.noneTitle'), body: t('verifyIdentity.status.noneBody') };
}

function rejectionText(status, t) {
  const key = REJECTION_COPY[status.rejectionReason] || REJECTION_COPY.other;
  return status.rejectionNote || t(`verifyIdentity.rejection.${key}`);
}
