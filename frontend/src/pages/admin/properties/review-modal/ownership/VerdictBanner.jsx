import { BadgeCheck, ShieldAlert, ShieldCheck } from 'lucide-react';
import { classNames } from '../../../../../lib/format.js';
import { KIND_LABELS, dateLabel, missingEvidenceId } from './vocabulary.js';

const TONE = {
  verified: { box: 'border-emerald-400/30 bg-emerald-500/10', icon: 'text-emerald-300' },
  blocked: { box: 'border-amber-400/30 bg-amber-500/10', icon: 'text-amber-300' },
  ready: { box: 'border-teal-400/30 bg-teal-500/10', icon: 'text-teal-300' },
};

/* The missing list carries the id the disabled Grant button describes itself by. */
export default function VerdictBanner({ verification, panelId }) {
  const blocked = verification.missingKinds.length > 0;
  const state = verification.verified ? 'verified' : blocked ? 'blocked' : 'ready';
  const Mark = { verified: BadgeCheck, blocked: ShieldAlert, ready: ShieldCheck }[state];
  const since = verification.verifiedAt ? ` since ${dateLabel(verification.verifiedAt)}` : '';
  const until = verification.verifiedUntil ? ` · valid until ${dateLabel(verification.verifiedUntil)}` : '';
  return (
    <div className={classNames('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-3', TONE[state].box)}>
      <Mark aria-hidden="true" className={classNames('h-5 w-5 shrink-0', TONE[state].icon)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-gray-50">{verification.verified ? 'Ownership verified' : 'Ownership not verified'}</p>
        <p className="text-xs text-gray-300">
          {verification.verified
            ? `Badge is live${since}${until}`
            : blocked ? 'Missing evidence blocks the badge.' : 'All evidence recorded. Granting is still a separate decision.'}
        </p>
      </div>
      {blocked ? (
        <ul id={missingEvidenceId(panelId)} aria-label="Missing evidence" className="flex flex-wrap gap-1.5">
          {verification.missingKinds.map((kind) => (
            <li key={kind} className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-100">
              {KIND_LABELS[kind] || kind}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
