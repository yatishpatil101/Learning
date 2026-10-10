import { useState } from 'react';
import {
  approveIdentityReview,
  qaIdentityReview,
  rejectIdentityReview,
  revokeIdentityReview,
} from '../../../services/identityReviewService.js';
import { classNames } from '../../../lib/format.js';
import DateField from '../../../components/ui/DateField.jsx';
import {
  NOTE_REQUIRED_REASONS,
  STAFF_REASONS,
  dateLabel,
  isOpenQa,
  isOwnQaApproval,
  normalizedName,
  reasonLabel,
  sameId,
} from './vocabulary.js';

const maxBirthYear = new Date().getFullYear() - 19;
const LOCKED_NOTE_ID = 'ops-identity-locked-note';
const box = 'rounded-xl border border-white/10 bg-black/10 p-4';
const fieldClass = 'mt-1 w-full rounded-[10px] border border-white/10 bg-white/5 px-3 py-2 text-sm text-white';
const reasonReady = (text) => text.trim().length >= 10 && text.trim().length <= 300;

function initialApproval(detail) {
  const dob = detail?.claims?.dob || '';
  return {
    number: '',
    name: detail?.claims?.name || '',
    dob,
    birthYear: String(detail?.claims?.birthYear || dob.slice(0, 4) || ''),
    yearOnly: Boolean(detail?.holderDobYearOnly),
    numberMismatch: false,
    numberOverride: false,
  };
}

/* Every decision for the open case lives here, in the order a reviewer meets them. The server is the
   gate for claim, maker-checker and QA; these checks only stop a request that would be refused. */
export default function KycActionRail({ detail, kase, user, canWrite, checklistLeft, poseConfirmed, onSettled }) {
  const [mode, setMode] = useState('approve');
  const [approval, setApproval] = useState(() => initialApproval(detail));
  const [rejection, setRejection] = useState({ reason: STAFF_REASONS.includes(detail.rejectionReason) ? detail.rejectionReason : 'blurry', note: '' });
  const [revocation, setRevocation] = useState({ reason: '', confirm: false });
  const [qaAction, setQaAction] = useState({ reason: '', confirm: false });
  const [releaseConfirm, setReleaseConfirm] = useState(false);
  const { deciding, claimNotice, error } = kase;

  const pending = detail.status === 'pending';
  const isOwnCase = sameId(detail.userId, user?.id);
  const canStaffAct = canWrite && !isOwnCase;
  const claimBlocked = pending && Boolean(claimNotice || (detail.claimedByName && !detail.claimedByMe));
  const claimNeeded = canStaffAct && pending && !detail.claimedByName && !detail.claimedByMe;
  const canDecidePending = canStaffAct && pending && !claimBlocked;
  const canForceRelease = user?.role === 'admin' && pending && detail.claimedByName && !detail.claimedByMe;
  const openQa = isOpenQa(detail);
  const approverName = detail.approvedByName || detail.reviewerName;
  const isQaApprover = isOwnQaApproval(detail);
  const canQaAct = canWrite && !isOwnCase && !isQaApprover;

  const rejectionReady = !NOTE_REQUIRED_REASONS.has(rejection.reason) || rejection.note.trim().length >= 10;
  const poseReady = !detail.livenessChallenge || poseConfirmed;
  const dobReady = approval.yearOnly
    ? /^(19|20)\d{2}$/.test(approval.birthYear) && Number(approval.birthYear) <= maxBirthYear
    : Boolean(approval.dob);
  const approvalReady = Boolean(approval.number.trim() && approval.name.trim()) && dobReady && poseReady && checklistLeft === 0;
  const accountNameHint = detail.accountName && approval.name.trim() && normalizedName(detail.accountName) !== normalizedName(approval.name)
    ? `Account name: ${detail.accountName} → will become ${approval.name.trim()}`
    : '';

  const run = async (submit, failure, options) => {
    const code = await kase.decide(submit, failure, options);
    if (code === 'identity_number_mismatch') setApproval((a) => ({ ...a, numberMismatch: true, numberOverride: false }));
    onSettled();
  };
  const approve = () => approvalReady && canDecidePending
    && run(() => approveIdentityReview(detail.id, { ...approval, poseConfirmed }), 'Could not approve this review.', { requireClaim: true });
  const reject = () => rejectionReady && canDecidePending
    && run(() => rejectIdentityReview(detail.id, rejection), 'Could not reject this review.', { requireClaim: true });
  const revoke = () => {
    if (!reasonReady(revocation.reason) || !canStaffAct) return;
    if (!revocation.confirm) setRevocation((r) => ({ ...r, confirm: true }));
    else run(() => revokeIdentityReview(detail.id, revocation.reason.trim()), 'Could not revoke this badge.');
  };
  const confirmQa = () => canQaAct && run(() => qaIdentityReview(detail.id, { outcome: 'confirmed' }), 'Could not confirm this QA check.');
  const revokeQa = () => {
    if (!reasonReady(qaAction.reason) || !canQaAct) return;
    if (!qaAction.confirm) setQaAction((q) => ({ ...q, confirm: true }));
    else run(() => qaIdentityReview(detail.id, { outcome: 'revoked', reason: qaAction.reason.trim() }), 'Could not revoke this QA check.');
  };
  const forceRelease = () => {
    if (!releaseConfirm) setReleaseConfirm(true);
    else kase.forceRelease().then(() => { setReleaseConfirm(false); onSettled(); });
  };

  return (
    <div className="space-y-3">
      {claimNotice ? <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{claimNotice}</div> : null}
      {error ? <div role="alert" data-testid="ops-identity-decision-error" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
      {canWrite && isOwnCase ? <Note>You cannot decide your own identity case.</Note> : null}

      {pending && claimBlocked ? (
        <div id={LOCKED_NOTE_ID} className={classNames(box, 'text-sm text-gray-300')}>
          Approve and reject are locked while another reviewer holds this case.
          {canForceRelease ? (
            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="text-xs text-amber-100">Admin: release {detail.claimedByName}&apos;s claim so someone else can pick it.</p>
              {releaseConfirm ? <p className="mt-2 text-xs text-amber-100">Confirm force release. The reviewer&apos;s hold will be cleared.</p> : null}
              <button type="button" onClick={forceRelease} disabled={deciding} className="dz-btn dz-btn-ghost dz-btn-sm mt-2">{deciding ? 'Releasing…' : releaseConfirm ? 'Confirm force release' : 'Force release'}</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {claimNeeded && !claimBlocked ? (
        <button type="button" onClick={kase.claim} disabled={deciding} className="dz-btn dz-btn-primary w-full">Claim case</button>
      ) : null}

      {canDecidePending ? (
        <section className={box} aria-label="Decision">
          <div role="tablist" aria-label="Decision" className="grid grid-cols-2 gap-0.5 rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
            {['approve', 'reject'].map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                disabled={deciding}
                className={classNames('h-8 rounded-md text-xs font-semibold transition-colors', mode === m ? (m === 'approve' ? 'bg-brand-teal text-ink' : 'bg-rose-500/80 text-white') : 'text-gray-400 hover:text-white')}
              >
                {m === 'approve' ? 'Approve' : 'Reject'}
              </button>
            ))}
          </div>
          {mode === 'approve' ? (
            <div className="mt-4 space-y-3">
              <Input label="Document number" value={approval.number} autoComplete="off" spellCheck={false} onChange={(number) => setApproval((a) => ({ ...a, number, numberMismatch: false, numberOverride: false }))} />
              {approval.numberMismatch ? (
                <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                  <p>Your number doesn&apos;t match the applicant&apos;s entry. Re-check the image.</p>
                  <label className="mt-2 flex items-start gap-2 text-xs">
                    <input type="checkbox" checked={approval.numberOverride} onChange={(e) => setApproval((a) => ({ ...a, numberOverride: e.target.checked }))} className="mt-0.5 h-4 w-4 accent-[var(--teal-2)]" />
                    <span>I read it from the image — the applicant&apos;s entry was wrong</span>
                  </label>
                </div>
              ) : null}
              <Input label="Holder name" value={approval.name} onChange={(name) => setApproval((a) => ({ ...a, name }))} />
              {accountNameHint ? <p className="text-xs text-gray-400">{accountNameHint}</p> : null}
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input data-testid="ops-identity-year-only" type="checkbox" checked={approval.yearOnly} onChange={(e) => setApproval((a) => ({ ...a, yearOnly: e.target.checked }))} className="h-4 w-4 accent-[var(--teal-2)]" />
                Year only (old Aadhaar)
              </label>
              {approval.yearOnly
                ? <Input data-testid="ops-identity-birth-year" label="Birth year" inputMode="numeric" maxLength={4} value={approval.birthYear} onChange={(v) => setApproval((a) => ({ ...a, birthYear: v.replace(/\D/g, '').slice(0, 4) }))} />
                : (
                  <div className="block text-sm text-gray-300">Date of birth
                    <DateField value={approval.dob} min="1900-01-01" max={new Date().toISOString().slice(0, 10)} onChange={(dob) => setApproval((a) => ({ ...a, dob }))} ariaLabel="Date of birth" className={fieldClass} />
                  </div>
                )}
              {checklistLeft > 0 || !poseReady ? (
                <p className="text-xs text-amber-300" data-testid="ops-identity-approve-hint">
                  {checklistLeft > 0 ? `Tick ${checklistLeft} more check${checklistLeft === 1 ? '' : 's'}` : 'Confirm the selfie pose'} to approve.
                </p>
              ) : null}
              <button type="button" data-testid="ops-identity-approve" onClick={approve} disabled={deciding || !approvalReady} className="dz-btn dz-btn-success w-full">{deciding ? 'Saving…' : 'Approve review'}</button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <label className="block text-sm text-gray-300">Reason
                <select value={rejection.reason} onChange={(e) => setRejection((r) => ({ ...r, reason: e.target.value }))} className={fieldClass}>
                  {STAFF_REASONS.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
                </select>
              </label>
              <label className="block text-sm text-gray-300">Note
                <textarea value={rejection.note} onChange={(e) => setRejection((r) => ({ ...r, note: e.target.value }))} rows={3} className={fieldClass} />
              </label>
              {!rejectionReady ? <p className="text-xs text-amber-300">This reason needs a note of at least 10 characters.</p> : null}
              <button type="button" data-testid="ops-identity-reject" onClick={reject} disabled={deciding || !rejectionReady} className="dz-btn dz-btn-danger w-full">{deciding ? 'Saving…' : 'Reject review'}</button>
            </div>
          )}
        </section>
      ) : null}

      {openQa ? (
        <section className={box} aria-label="QA check">
          <p className="text-sm font-semibold text-white">QA check</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <Field label="Approved by" value={approverName || '—'} />
            {detail.qaSampledAt ? <Field label="Sampled" value={dateLabel(detail.qaSampledAt)} /> : null}
            <Field label="Holder name" value={detail.holderName || '—'} />
            <Field label={detail.holderDobYearOnly ? 'Birth year' : 'Date of birth'} value={detail.holderDobYearOnly ? (detail.holderDob?.slice(0, 4) || '—') : (detail.holderDob || '—')} />
          </dl>
          {!canQaAct ? (
            <Note className="mt-3">{isQaApprover ? 'You approved this — another reviewer must check it.' : 'You cannot QA your own identity case.'}</Note>
          ) : (
            <div className="mt-4 space-y-3">
              <button type="button" onClick={confirmQa} disabled={deciding} className="dz-btn dz-btn-success w-full">{deciding ? 'Saving…' : 'Confirm'}</button>
              <ReasonBox testId="ops-identity-qa-revoke-reason" label="Revocation reason" value={qaAction.reason} onChange={(reason) => setQaAction({ reason, confirm: false })} />
              {qaAction.confirm ? <p className="text-xs text-rose-100">Confirm QA revocation. The badge will be removed and audited.</p> : null}
              <button type="button" data-testid="ops-identity-qa-revoke" onClick={revokeQa} disabled={deciding || !reasonReady(qaAction.reason)} className="dz-btn dz-btn-danger w-full">{deciding ? 'Saving…' : qaAction.confirm ? 'Confirm revoke' : 'Revoke'}</button>
            </div>
          )}
        </section>
      ) : null}

      {detail.status === 'verified' && !openQa && canStaffAct ? (
        <section className={classNames(box, 'border-rose-500/20')} aria-label="Revoke badge">
          <p className="text-sm font-semibold text-white">Revoke badge</p>
          <div className="mt-3 space-y-3">
            <ReasonBox testId="ops-identity-revoke-reason" label="Reason" value={revocation.reason} onChange={(reason) => setRevocation({ reason, confirm: false })} />
            {revocation.confirm ? <p className="text-xs text-rose-100">Confirm revocation. The badge will be removed and audited.</p> : null}
            <button type="button" data-testid="ops-identity-revoke-confirm" onClick={revoke} disabled={deciding || !reasonReady(revocation.reason)} className="dz-btn dz-btn-danger w-full">{deciding ? 'Saving…' : revocation.confirm ? 'Confirm revoke' : 'Revoke badge'}</button>
          </div>
        </section>
      ) : null}

      {(detail.status === 'rejected' || detail.status === 'revoked') ? (
        <p className="px-1 text-xs text-gray-500">Closed {dateLabel(detail.revokedAt || detail.decidedAt)} — nothing left to decide.</p>
      ) : null}
    </div>
  );
}

function Note({ children, className }) {
  return <p className={classNames('rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100', className)}>{children}</p>;
}

export function Field({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-white">{value}</dd>
    </div>
  );
}

function ReasonBox({ testId, label, value, onChange }) {
  const length = value.trim().length;
  return (
    <div>
      <label className="block text-sm text-gray-300">{label}
        <textarea data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={fieldClass} />
      </label>
      <div className="mt-1 flex justify-between text-xs">
        <span className={reasonReady(value) ? 'text-gray-500' : 'text-amber-300'}>10–300 characters required.</span>
        <span className="tabular-nums text-gray-500">{length}/300</span>
      </div>
    </div>
  );
}

function Input({ label, onChange, 'data-testid': testId, ...props }) {
  return (
    <label className="block text-sm text-gray-300">{label}
      <input data-testid={testId} {...props} onChange={(e) => onChange(e.target.value)} className={fieldClass} />
    </label>
  );
}
