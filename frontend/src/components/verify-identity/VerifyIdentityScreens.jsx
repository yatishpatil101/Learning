import { useEffect, useRef } from 'react';
import Icon from '../Icon.jsx';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { IDENTITY_DOCUMENTS } from '../../lib/identity-verification/documents.js';

export function VerifyShell({ title, stepIndex, onBack, onClose, children }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-[100dvh] bg-[var(--brand-dark)] px-4 pb-[calc(1.5rem+var(--dz-safe-b))] pt-[calc(1rem+var(--dz-safe-t))] text-white">
      <div className="mx-auto flex min-h-[calc(100dvh-2.5rem)] max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[var(--brand-card)] shadow-2xl shadow-black/30">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2.5">
          {onBack
            ? <button type="button" onClick={onBack} aria-label={t('verifyIdentity.shell.backLabel')} className="btn btn-icon btn-sm cursor-pointer"><Icon name="arrow-left" aria-hidden="true" className="h-4 w-4" /></button>
            : <span className="w-8" />}
          <span className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-subtle)]">{title}</span>
          {onClose
            ? <button type="button" onClick={onClose} aria-label={t('verifyIdentity.shell.closeLabel')} className="btn btn-icon btn-sm cursor-pointer"><Icon name="x" aria-hidden="true" className="h-4 w-4" /></button>
            : <span className="w-8" />}
        </div>
        <StepMeter active={stepIndex} />
        {children}
      </div>
    </div>
  );
}

export function PhoneHandoffScreen({ qrCode }) {
  const { t } = useTranslation();
  return (
    <div className="px-6 pb-8 pt-9">
      <BadgeIcon tone="phone" />
      <h1 className="mt-5 text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.02em]">{t('verifyIdentity.phone.title')}</h1>
      <p className="mt-3 text-sm leading-7 text-[var(--text-muted)]">{t('verifyIdentity.phone.body')}</p>
      {qrCode && (
        <img
          src={qrCode}
          alt={t('verifyIdentity.phone.qrAlt')}
          className="mx-auto mt-7 h-52 w-52 rounded-xl bg-white p-3"
        />
      )}
      <p className="mt-7 border-t border-white/10 pt-4 text-xs leading-6 text-[var(--text-subtle)]">
        {t('verifyIdentity.phone.hint')}
      </p>
    </div>
  );
}

export function StartScreen({ docType, consented, onDocTypeChange, onConsentChange, onStart }) {
  const { t } = useTranslation();
  return (
    <form className="flex flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); onStart(); }}>
      <div className="flex-1 px-6 pb-4 pt-6">
        <div className="flex items-center gap-4">
          <div className="shrink-0"><BadgeIcon tone="none" /></div>
          <h1 className="text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.02em]">{t('verifyIdentity.start.title')}</h1>
        </div>
        <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{t('verifyIdentity.start.body')}</p>

        <div className="mt-6 grid grid-cols-2 gap-3" role="radiogroup" aria-label={t('verifyIdentity.start.docsLabel')}>
          {IDENTITY_DOCUMENTS.map((item) => {
            const selected = item.key === docType;
            return (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`verify-doc-tile-${item.key}`}
                onClick={() => onDocTypeChange(item.key)}
                className={`min-h-[116px] cursor-pointer rounded-2xl border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal-2)] ${selected ? 'border-[var(--teal-2)] bg-[var(--teal-2)]/12' : 'border-white/10 bg-white/[0.04] hover:border-[var(--teal-2)]/45 hover:bg-white/[0.07]'}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-[var(--teal-3)]">
                    <Icon name={item.icon} aria-hidden="true" className="h-5 w-5" />
                  </span>
                  {item.key === 'aadhaar' && <span className="rounded bg-[var(--emerald)]/15 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-[var(--emerald)]">{t('verifyIdentity.documents.aadhaar.tag')}</span>}
                </span>
                <span className="mt-3 block text-sm font-semibold leading-5">{t(`verifyIdentity.documents.${item.key}.label`)}</span>
                <span className="mt-1 block text-xs text-[var(--text-subtle)]">{t(`verifyIdentity.documents.${item.key}.hint`)}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <p className="text-sm font-semibold">{t('verifyIdentity.start.consentTitle')}</p>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-[var(--text-muted)]">
            <li>• {t('verifyIdentity.start.consent.line1')}</li>
            <li>• {t('verifyIdentity.start.consent.line2')}</li>
            <li>• {t('verifyIdentity.start.consent.line3')}</li>
          </ul>
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/10 p-3 text-sm leading-6 text-[var(--text-muted)]">
            <input
              type="checkbox"
              required
              checked={consented}
              onChange={(event) => onConsentChange(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[var(--teal-2)]"
            />
            <span>{t('verifyIdentity.start.agree')}</span>
          </label>
        </div>
      </div>
      <StickyAction>
        <button type="submit" data-testid="verify-start-cta" disabled={!consented} className="btn btn-primary btn-lg w-full">
          {t('verifyIdentity.start.cta')}
        </button>
      </StickyAction>
    </form>
  );
}

export function CaptureScreen({
  doc,
  captures,
  activeFrame,
  videoRef,
  guideRef,
  qualityHint,
  selfieHint,
  selfieNotice,
  cameraError,
  liveness,
  onCapture,
  onRetryCamera,
  onRetakeActive,
}) {
  const { t } = useTranslation();
  const isSelfie = activeFrame === 'selfie';
  const frames = sheetFrames(doc, captures, t);
  const frameLabel = t(`verifyIdentity.capture.frames.${activeFrame}`);
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 px-6 pb-4 pt-5">
        <MiniProgress frames={frames} activeFrame={activeFrame} />
        <div className="relative mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black">
          <video ref={videoRef} muted playsInline className={`w-full object-cover ${isSelfie ? 'aspect-[3/4]' : 'aspect-video'}`} />
          {isSelfie
            ? <div ref={guideRef} className={`pointer-events-none absolute left-1/2 top-1/2 h-[72%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-4 transition-colors ${liveness.done ? 'border-[var(--emerald)]' : 'border-[var(--teal-2)]'}`} />
            : <div ref={guideRef} className="pointer-events-none absolute left-1/2 top-1/2 aspect-[1.585] w-[86%] -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-white/90" />}
        </div>

        {isSelfie ? <LivenessPanel liveness={liveness} selfieHint={selfieHint} /> : <HintPanel title={t(`verifyIdentity.capture.${activeFrame === 'back' ? 'backSide' : 'frontSide'}`)} body={qualityHint} />}
        {isSelfie && selfieNotice && <div role="alert" className="mt-3 rounded-xl border border-[var(--amber)]/30 bg-[var(--amber)]/[0.07] px-4 py-3 text-sm text-[var(--amber)]">{selfieNotice}</div>}

        {cameraError && (
          <div className="mt-5 rounded-xl border border-[var(--amber)]/30 bg-[var(--amber)]/[0.07] px-4 py-4 text-sm leading-6">
            <p className="flex items-center gap-2 font-semibold"><Icon name="camera" aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--amber)]" /> {t('verifyIdentity.capture.noCamera')}</p>
            <p className="mt-1.5 text-[var(--text-muted)]">{cameraError}</p>
            <button type="button" onClick={onRetryCamera} className="btn btn-secondary mt-4">{t('verifyIdentity.actions.tryAgain')}</button>
          </div>
        )}
      </div>
      {!cameraError && (
        <StickyAction>
          <button
            type="button"
            data-testid="capture-button"
            disabled={liveness.blocked}
            onClick={onCapture}
            className="btn btn-primary btn-lg w-full"
          >
            {isSelfie ? t('verifyIdentity.capture.takeSelfie') : t('verifyIdentity.capture.takeFrame', { frame: frameLabel })}
          </button>
          {captures[activeFrame] && (
            <button type="button" onClick={onRetakeActive} className="mt-3 min-h-[44px] w-full cursor-pointer text-sm text-[var(--text-muted)] underline-offset-4 hover:text-white hover:underline">
              {t('verifyIdentity.capture.retakeFrame', { frame: frameLabel })}
            </button>
          )}
        </StickyAction>
      )}
    </div>
  );
}

export function ReviewScreen({
  doc,
  captures,
  reviewError,
  duplicateConflict,
  disputeOpen,
  disputeNote,
  disputeSubmitting,
  disputeError,
  submitting,
  onRetake,
  onSubmit,
  onOpenDispute,
  onCloseDispute,
  onDisputeNoteChange,
  onSubmitDispute,
}) {
  const { t } = useTranslation();
  const reportRef = useRef(null);
  return (
    <form className="flex flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="flex-1 space-y-5 px-6 pb-4 pt-5">
        <div>
          <h1 className="text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.02em]">{t('verifyIdentity.review.title')}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{t('verifyIdentity.review.body')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <PreviewCard label={t('verifyIdentity.capture.frames.front')} capture={captures.front} onRetake={() => onRetake('front')} />
          {doc.needsBack
            ? <PreviewCard label={t('verifyIdentity.capture.frames.back')} capture={captures.back} onRetake={() => onRetake('back')} />
            : <div className="grid place-items-center rounded-xl border border-dashed border-white/12 p-4 text-center text-xs leading-5 text-[var(--text-subtle)]">{t('verifyIdentity.review.noBack')}</div>}
          <div className="col-span-2">
            <PreviewCard label={t('verifyIdentity.capture.frames.selfie')} capture={captures.selfie} onRetake={() => onRetake('selfie')} />
          </div>
        </div>
        <p className="text-xs leading-5 text-[var(--text-subtle)]">{t('verifyIdentity.review.nameHint')}</p>
        {duplicateConflict && <DuplicateState reportRef={reportRef} conflict={duplicateConflict} onOpenDispute={onOpenDispute} />}
        {reviewError && <div role="alert" className="rounded-xl border border-[var(--rose)]/30 bg-[var(--rose)]/10 px-4 py-3 text-sm text-[#fda4af]">{reviewError}</div>}
      </div>
      <StickyAction>
        <button
          type="submit"
          disabled={submitting || Boolean(duplicateConflict) || !captures.front || !captures.selfie || (doc.needsBack && !captures.back)}
          className="btn btn-primary btn-lg w-full"
        >
          {submitting ? t('verifyIdentity.review.sending') : t('verifyIdentity.review.submit')}
        </button>
      </StickyAction>
      {disputeOpen && (
        <DisputeSheet
          note={disputeNote}
          busy={disputeSubmitting}
          error={disputeError}
          onNoteChange={onDisputeNoteChange}
          onClose={onCloseDispute}
          onSubmit={onSubmitDispute}
          restoreRef={reportRef}
        />
      )}
    </form>
  );
}

function StepMeter({ active }) {
  const { t } = useTranslation();
  const steps = ['start', 'capture', 'review', 'status'];
  return (
    <div className="border-b border-white/10 px-4 py-3">
      <ol className="grid grid-cols-4 gap-2" aria-label={t('verifyIdentity.shell.stepsLabel')}>
        {steps.map((step, index) => (
          <li key={step} className="min-w-0">
            <div className={`h-1.5 rounded-full ${index <= active ? 'bg-[var(--teal-2)]' : 'bg-white/10'}`} />
            <p className={`mt-1 truncate text-center text-[0.65rem] font-semibold ${index === active ? 'text-[var(--teal-3)]' : 'text-[var(--text-subtle)]'}`}>{t(`verifyIdentity.steps.${step}`)}</p>
          </li>
        ))}
      </ol>
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

function MiniProgress({ frames, activeFrame }) {
  const { t } = useTranslation();
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label={t('verifyIdentity.capture.progressLabel')}>
      {frames.map((frame) => {
        const active = frame.key === activeFrame;
        const done = Boolean(frame.capture);
        return (
          <li key={frame.key} data-testid={`verify-shot-${frame.key}`} className={`rounded-xl border px-3 py-2 text-center text-xs font-semibold ${done ? 'border-[var(--emerald)]/40 bg-[var(--emerald)]/10 text-[var(--emerald)]' : active ? 'border-[var(--teal-2)]/50 bg-[var(--teal-2)]/10 text-[var(--teal-3)]' : 'border-white/10 bg-white/[0.04] text-[var(--text-subtle)]'}`}>
            {frame.label}
          </li>
        );
      })}
    </ol>
  );
}

function LivenessPanel({ liveness, selfieHint }) {
  const { t } = useTranslation();
  return (
    <>
      <ol className={`mt-4 grid gap-2 ${liveness.stages.length > 1 ? 'grid-cols-3' : 'grid-cols-1'}`}>
        {liveness.stages.map((item, index) => (
          <li key={item.key} data-testid={`liveness-stage-${item.key}`} data-state={item.state} className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs font-medium ${item.state === 'done' ? 'border-[var(--emerald)]/40 bg-[var(--emerald)]/10 text-[var(--emerald)]' : item.state === 'active' ? 'border-[var(--teal-2)]/50 bg-[var(--teal-2)]/10 text-[var(--teal-3)]' : 'border-white/10 bg-white/[0.04] text-[var(--text-subtle)]'}`}>
            {item.state === 'done' ? <Icon name="check-circle" aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : <span aria-hidden="true" className="font-mono text-[0.7rem] tabular-nums opacity-70">{index + 1}</span>}
            <span>{item.title}</span>
          </li>
        ))}
      </ol>
      <HintPanel title={liveness.done ? t('verifyIdentity.capture.checksPassed') : liveness.stageLabel} body={selfieHint} />
      {liveness.blocked && <p className="mt-2 text-center text-xs text-[var(--text-subtle)]">{t('verifyIdentity.capture.finishChecks')}</p>}
      {liveness.bypassed && !liveness.done && !liveness.unavailable && (
        <p className="mt-2 flex items-start justify-center gap-2 text-center text-xs leading-5 text-[var(--amber)]">
          <Icon name="alert-triangle" aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('verifyIdentity.capture.checksBypassed')}</span>
        </p>
      )}
    </>
  );
}

function HintPanel({ title, body }) {
  return (
    <>
      <p className="mt-4 text-center text-sm font-semibold">{title}</p>
      <p role="status" className="mt-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-center text-sm leading-6 text-[var(--text-muted)]">{body}</p>
    </>
  );
}

function PreviewCard({ label, capture, onRetake }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]">{label}</p>
      {capture
        ? <img src={capture.url} alt={t('verifyIdentity.review.previewAlt', { label })} className="mt-2 h-28 w-full rounded-lg object-cover" />
        : <div className="mt-2 grid h-28 place-items-center rounded-lg border border-dashed border-white/12 text-xs text-[var(--text-subtle)]">{t('verifyIdentity.review.notTaken')}</div>}
      <button type="button" onClick={onRetake} className="mt-2 min-h-[44px] cursor-pointer text-xs font-semibold text-[var(--teal-3)] transition-colors hover:text-[var(--teal-2)]">{t('verifyIdentity.review.retake')}</button>
    </div>
  );
}

function DuplicateState({ conflict, onOpenDispute, reportRef }) {
  const { t } = useTranslation();
  const done = conflict.state === 'sent' || conflict.state === 'open';
  return (
    <div role="alert" className={`rounded-xl border px-4 py-3 text-sm leading-6 ${done ? 'border-[var(--emerald)]/30 bg-[var(--emerald)]/10 text-[var(--emerald)]' : 'border-[var(--amber)]/30 bg-[var(--amber)]/[0.07] text-[var(--text-muted)]'}`}>
      <p className="font-semibold text-white">
        {conflict.state === 'sent'
          ? t('verifyIdentity.dispute.sent')
          : conflict.state === 'open'
            ? t('verifyIdentity.dispute.open')
            : t('verifyIdentity.dispute.duplicate')}
      </p>
      {done ? (
        <Link to="/support" className="mt-2 inline-flex min-h-[36px] items-center text-[var(--teal-3)] underline-offset-4 hover:underline">
          {t('verifyIdentity.dispute.supportLink')}
        </Link>
      ) : (
        <button ref={reportRef} type="button" onClick={onOpenDispute} className="btn btn-primary mt-3">
          {t('verifyIdentity.dispute.reportCta')}
        </button>
      )}
    </div>
  );
}

function DisputeSheet({ note, busy, error, onNoteChange, onClose, onSubmit, restoreRef }) {
  const { t } = useTranslation();
  const noteRef = useRef(null);
  const cancelRef = useRef(null);
  const submitRef = useRef(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    busyRef.current = busy;
    onCloseRef.current = onClose;
  }, [busy, onClose]);

  useEffect(() => {
    const restoreTarget = restoreRef.current;
    noteRef.current?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = [noteRef.current, cancelRef.current, submitRef.current].filter(Boolean);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
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
    return () => {
      document.removeEventListener('keydown', handleKey);
      restoreTarget?.focus();
    };
  }, [restoreRef]);

  return (
    <div className="fixed inset-0 z-[1500] flex items-end bg-black/60 px-4 pb-[calc(1rem+var(--dz-safe-b))]">
      <div role="dialog" aria-modal="true" aria-labelledby="dispute-title" className="mx-auto w-full max-w-md rounded-2xl border border-white/10 bg-[var(--brand-card)] p-5 shadow-2xl">
        <h2 id="dispute-title" className="text-lg font-semibold">{t('verifyIdentity.dispute.sheetTitle')}</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{t('verifyIdentity.dispute.sheetBody')}</p>
        <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)]" htmlFor="identity-dispute-note">
          {t('verifyIdentity.dispute.noteLabel')}
        </label>
        <textarea
          ref={noteRef}
          id="identity-dispute-note"
          value={note}
          maxLength={500}
          onChange={(event) => onNoteChange(event.target.value)}
          className="mt-2 min-h-24 w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-[var(--teal-2)]"
          placeholder={t('verifyIdentity.dispute.notePlaceholder')}
        />
        <p className="mt-1 text-right text-[0.68rem] text-[var(--text-subtle)]">{note.length}/500</p>
        {error && <div role="alert" className="mt-3 rounded-xl border border-[var(--rose)]/30 bg-[var(--rose)]/10 px-3 py-2 text-sm text-[#fda4af]">{error}</div>}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button ref={cancelRef} type="button" disabled={busy} onClick={onClose} className="btn btn-secondary">{t('verifyIdentity.actions.cancel')}</button>
          <button ref={submitRef} type="button" disabled={busy} onClick={onSubmit} className="btn btn-primary">{busy ? t('verifyIdentity.dispute.sending') : t('verifyIdentity.dispute.send')}</button>
        </div>
      </div>
    </div>
  );
}

function BadgeIcon({ tone = 'none' }) {
  const map = {
    verified: { icon: 'badge-check', color: 'var(--emerald)' },
    rejected: { icon: 'shield-alert', color: 'var(--rose)' },
    revoked: { icon: 'shield-alert', color: 'var(--amber)' },
    pending: { icon: 'clock', color: 'var(--amber)' },
    phone: { icon: 'camera', color: 'var(--teal-3)' },
    none: { icon: 'fingerprint', color: 'var(--teal-3)' },
  };
  const { icon, color } = map[tone] || map.none;
  return (
    <div aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-xl border" style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
      <Icon name={icon} className="h-7 w-7" />
    </div>
  );
}

function sheetFrames(doc, captures, t) {
  const frames = [{ key: 'front', label: t('verifyIdentity.capture.frames.front') }];
  if (doc.needsBack) frames.push({ key: 'back', label: t('verifyIdentity.capture.frames.back') });
  frames.push({ key: 'selfie', label: t('verifyIdentity.capture.frames.selfie') });
  return frames.map((frame) => ({ ...frame, capture: captures?.[frame.key] || null }));
}
