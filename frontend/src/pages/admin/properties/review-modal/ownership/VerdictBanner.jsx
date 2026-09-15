import { BadgeCheck, ShieldAlert, ShieldCheck } from 'lucide-react';
import { classNames } from '../../../../../lib/format.js';
import { KIND_LABELS, dateLabel, missingEvidenceId } from './vocabulary.js';

/* A reviewer works a queue, so whether a listing is verified and what blocks it must never be
   reconstructed from a list. The missing list sits inside the banner because Grant points at it. */
export default function VerdictBanner({ verification, panelId }) {
  const blocked = verification.missingKinds.length > 0;
  const Mark = verification.verified ? BadgeCheck : blocked ? ShieldAlert : ShieldCheck;
  return (
    <div className={classNames('rounded-xl border p-3.5', verification.verified
      ? 'border-emerald-400/30 bg-emerald-500/10'
      : blocked ? 'border-amber-400/30 bg-amber-500/10' : 'border-teal-400/30 bg-teal-500/10')}>
      <div className="flex items-start gap-2.5">
        <Mark aria-hidden="true" className={classNames('mt-0.5 h-5 w-5 flex-shrink-0', verification.verified
          ? 'text-emerald-300' : blocked ? 'text-amber-300' : 'text-teal-300')} />
        <div className="min-w-0">
          <p className="text-base font-bold text-gray-50">{verification.verified ? 'Ownership verified' : 'Ownership not verified'}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-300">
            {verification.verified
              ? `Granted ${dateLabel(verification.verifiedAt)} · ${verification.verifiedUntil ? `Valid until ${dateLabel(verification.verifiedUntil)}` : 'No recorded expiry'}`
              : blocked
                ? 'Required evidence is still missing, so the badge cannot be granted yet.'
                : 'Every requirement is recorded. Granting the badge is still a separate decision.'}
          </p>
        </div>
      </div>
      {blocked && (
        <div id={missingEvidenceId(panelId)} className="mt-3 border-t border-amber-400/20 pt-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-300">Still required</p>
          <ul className="mt-1.5 space-y-1">
            {verification.missingKinds.map((kind) => (
              <li key={kind} className="flex items-start gap-2 text-sm text-amber-100">
                <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />
                <span>{KIND_LABELS[kind] || kind} <span className="font-mono text-[11px] text-amber-200/70">({kind})</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
