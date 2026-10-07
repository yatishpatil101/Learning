import { useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import Modal from '../../../components/ui/Modal.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import { classNames } from '../../../lib/format.js';
import useKycCase from './useKycCase.js';
import KycActionRail, { Field } from './KycActionRail.jsx';
import KycAccountEditor from './KycAccountEditor.jsx';
import {
  CHECKLISTS,
  DEFAULT_CHECKLIST,
  POSE_LABELS,
  STATUS_LABELS,
  dateLabel,
  docLabel,
  elapsed,
  isOpenQa,
  isOwnQaApproval,
  reasonLabel,
} from './vocabulary.js';

const AMBER = 'border-amber-400/40 bg-amber-500/15 text-amber-100';
const LIVENESS = {
  passed: { label: 'Client-reported: liveness passed', tone: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300' },
  bypassed: { label: 'Client-reported: liveness skipped — check selfie closely', tone: AMBER },
  unavailable: { label: 'Client-reported: liveness unavailable — check selfie closely', tone: AMBER },
};
const CHALLENGE_LABELS = {
  passed: 'Challenge liveness passed',
  bypassed: 'Challenge liveness skipped — check selfie closely',
  unavailable: 'Challenge liveness unavailable — check selfie closely',
};
const TONE = { ok: 'border-white/10 bg-white/5 text-gray-300', warn: 'border-amber-400/30 bg-amber-500/15 text-amber-200', breach: 'border-rose-400/30 bg-rose-500/15 text-rose-200' };
const card = 'rounded-xl border border-white/10 bg-black/10 p-4';

function livenessChip(detail) {
  if (!detail.liveness) return null;
  const base = LIVENESS[detail.liveness] || LIVENESS.unavailable;
  if (detail.livenessSource !== 'challenge') return base;
  return { ...base, label: CHALLENGE_LABELS[detail.liveness] || `Challenge liveness: ${detail.liveness}` };
}

const Chip = ({ tone, children, ...props }) => (
  <span {...props} className={classNames('rounded-full border px-2.5 py-0.5 text-xs font-medium', tone)}>{children}</span>
);

/** One KYC case: the evidence on the left, every decision in the rail on the right. */
export default function KycReviewModal({ openId, nextId, onNext, onClose, onChanged, canWrite, user }) {
  const kase = useKycCase(openId, { canWrite, userId: user?.id, onChanged });
  const { detail, loading, deciding, error } = kase;
  const summaryRef = useRef(null);
  // A decision unmounts the button that held focus; hand it back to the dialog instead of <body>.
  const onSettled = () => requestAnimationFrame(() => {
    if (document.activeElement === document.body) summaryRef.current?.focus();
  });

  const footer = (
    <>
      <button type="button" onClick={kase.refresh} disabled={!detail || loading || deciding} className="dz-btn dz-btn-ghost mr-auto">Refresh links</button>
      <button type="button" onClick={onNext} disabled={!nextId || deciding} className="dz-btn dz-btn-ghost">Next case</button>
      <button type="button" onClick={onClose} className="dz-btn dz-btn-primary">Close</button>
    </>
  );

  return (
    <Modal open={Boolean(openId)} onClose={onClose} title={detail?.userName || 'KYC case'} size="xl" footer={footer}>
      {!detail && loading ? <p className="py-16 text-center text-sm text-gray-500">Loading review…</p> : null}
      {!detail && !loading && error ? <div role="alert" data-testid="ops-identity-decision-error" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
      {detail ? (
        <CaseBody
          key={`${detail.id}|${detail.status}|${detail.qaOutcome || ''}`}
          detail={detail}
          kase={kase}
          user={user}
          canWrite={canWrite}
          summaryRef={summaryRef}
          onSettled={onSettled}
        />
      ) : null}
    </Modal>
  );
}

function CaseBody({ detail, kase, user, canWrite, summaryRef, onSettled }) {
  const [checked, setChecked] = useState(() => new Set());
  const [poseConfirmed, setPoseConfirmed] = useState(false);
  const pending = detail.status === 'pending';
  const openQa = isOpenQa(detail);
  const checklist = CHECKLISTS[detail.docType] || DEFAULT_CHECKLIST;
  const age = pending ? elapsed(detail.submittedAt) : null;
  const chip = livenessChip(detail);
  const toggle = (item) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(item)) next.delete(item); else next.add(item);
    return next;
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <div ref={summaryRef} tabIndex={-1} className="flex flex-wrap items-center gap-2 text-sm text-gray-400 outline-none">
          <span className="tabular-nums text-gray-200">{detail.userMobile || '—'}</span>
          <span>· {detail.userRole || '—'} · {docLabel(detail.docType)}</span>
          <Badge status={detail.status}>{STATUS_LABELS[detail.status] || detail.status}</Badge>
          {age ? <Chip tone={TONE[age.tone]}>Waiting {age.text}{age.tone === 'breach' ? ' · overdue' : ''}</Chip> : null}
          {openQa ? <Chip tone={TONE.warn}>QA: pending</Chip> : detail.qaOutcome ? <Chip tone={TONE.ok}>QA: {detail.qaOutcome}</Chip> : null}
          {detail.numberOverridden ? <Chip tone="border-[var(--teal-2)]/30 bg-[var(--teal-2)]/10 text-[var(--teal-2)]">Number corrected by reviewer</Chip> : null}
        </div>

        {detail.warnings?.length ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
            <p className="font-semibold">Duplicate warnings</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {detail.warnings.map((w) => <li key={`${w.kind}:${w.reviewId}`}>{w.kind.replaceAll('_', ' ')} · {w.userName || w.userId}</li>)}
            </ul>
          </div>
        ) : null}

        <section className={card} aria-label="Document">
          <h3 className="text-sm font-semibold text-white">{docLabel(detail.docType)}</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_230px]">
            <div className="space-y-3">
              <ImageCard title="Front" href={detail.images?.front} />
              {detail.images?.back || detail.docType === 'aadhaar' || detail.docType === 'voter_id' ? <ImageCard title="Back" href={detail.images?.back} /> : null}
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-300">Applicant entered</p>
                <dl className="mt-2 space-y-2">
                  <Field label="Number ending" value={detail.claims?.number || 'Not available'} />
                  <Field label="Name" value={detail.claims?.name || 'Not available'} />
                  {detail.holderDobYearOnly
                    ? <Field label="Birth year" value={detail.claims?.birthYear || detail.claims?.dob?.slice(0, 4) || 'Not available'} />
                    : <Field label="Date of birth" value={detail.claims?.dob || 'Not available'} />}
                </dl>
                <KycAccountEditor detail={detail} canWrite={canWrite} onSaved={kase.refresh} />
              </div>
              {pending || (openQa && !isOwnQaApproval(detail)) ? (
                <fieldset data-testid="ops-identity-checklist">
                  <legend className="text-xs font-semibold text-gray-300">Check on the image</legend>
                  <div className="mt-2 space-y-1.5">
                    {checklist.map((item) => (
                      <label key={item} className="flex cursor-pointer items-start gap-2 text-sm text-gray-200">
                        <input type="checkbox" checked={checked.has(item)} onChange={() => toggle(item)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--teal-2)]" />
                        {item}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : null}
            </div>
          </div>
        </section>

        <section className={card} aria-label="Liveness">
          <h3 className="text-sm font-semibold text-white">Liveness</h3>
          <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_230px]">
            <ImageCard title="Selfie" href={detail.images?.selfie} />
            <div className="space-y-3 text-sm">
              {chip ? <Chip tone={chip.tone}>{chip.label}</Chip> : null}
              {detail.livenessChallenge
                ? <p className="text-gray-300"><span className="font-semibold text-white">Requested pose:</span> {POSE_LABELS[detail.livenessChallenge] || detail.livenessChallenge}</p>
                : <Chip tone={AMBER}>No pose challenge — check liveness carefully</Chip>}
              {pending && detail.livenessChallenge ? (
                <label className="flex cursor-pointer items-start gap-2 text-gray-200">
                  <input data-testid="ops-identity-pose-confirmed" type="checkbox" checked={poseConfirmed} onChange={(e) => setPoseConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--teal-2)]" />
                  Selfie shows the requested pose
                </label>
              ) : null}
            </div>
          </div>
        </section>

        <History detail={detail} />
      </div>

      <aside className="lg:sticky lg:top-0 lg:self-start">
        <KycActionRail
          detail={detail}
          kase={kase}
          user={user}
          canWrite={canWrite}
          checklistLeft={pending ? checklist.length - checked.size : 0}
          poseConfirmed={poseConfirmed}
          onSettled={onSettled}
        />
      </aside>
    </div>
  );
}

function ImageCard({ title, href }) {
  return (
    <figure className="overflow-hidden rounded-lg border border-white/10 bg-black/30">
      <figcaption className="flex items-center justify-between px-3 py-1.5 text-xs text-gray-300">
        <span>{title}</span>
        {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-teal">Open <ExternalLink className="h-3 w-3" aria-hidden="true" /></a> : null}
      </figcaption>
      {href
        ? <img src={href} alt={`${title} identity evidence`} className="max-h-72 w-full object-contain" />
        : <p className="grid h-32 place-items-center text-xs text-gray-500">No image available</p>}
    </figure>
  );
}

function History({ detail }) {
  const events = [
    detail.submittedAt && ['Submitted', `${dateLabel(detail.submittedAt)}${detail.attemptCount > 1 ? ` · attempt ${detail.attemptCount}` : ''}`],
    detail.decidedAt && ['Decided', `${dateLabel(detail.decidedAt)} by ${detail.reviewerName || '—'}`],
    detail.rejectionReason && ['Rejection', `${reasonLabel(detail.rejectionReason)}${detail.rejectionNote ? ` — ${detail.rejectionNote}` : ''}`],
    detail.qaSampledAt && ['QA', detail.qaOutcome
      ? `${detail.qaOutcome} by ${detail.qaReviewedByName || '—'} · ${dateLabel(detail.qaReviewedAt)}`
      : `Sampled ${dateLabel(detail.qaSampledAt)} · awaiting check`],
    detail.revokedAt && ['Revoked', `${dateLabel(detail.revokedAt)} by ${detail.revokedByName || '—'} · ${detail.revocationReason || 'No reason recorded'}`],
    detail.filesPurgedAt && ['Images purged', dateLabel(detail.filesPurgedAt)],
  ].filter(Boolean);
  return (
    <details className={card} data-testid="ops-identity-history">
      <summary className="cursor-pointer text-sm font-semibold text-white">History <span className="font-normal text-gray-500">· {events.length}</span></summary>
      <dl className="mt-3 space-y-2">
        {events.map(([label, value]) => <Field key={label} label={label} value={value} />)}
      </dl>
    </details>
  );
}
