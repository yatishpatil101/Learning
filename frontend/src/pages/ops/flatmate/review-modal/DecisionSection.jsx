import { useState } from 'react';
import { Ban, Check, EyeOff, Gavel, History } from 'lucide-react';
import Badge from '../../../../components/ui/Badge.jsx';
import { Block, fmtDate } from '../board.jsx';
import { MOD_LABEL } from '../FlatmateQueueCard.jsx';

const PUBLIC = ['approved', 'live'];

/* The visibility axis. Publishing grants no badge; hiding says nothing about the paperwork. */
export default function DecisionSection({ modStatus, recheck, publishLabel = 'Publish', busy, onDecide }) {
  const [note, setNote] = useState('');
  const actions = [
    { id: 'approved', label: publishLabel, icon: Check, cls: 'dz-btn-success', hidden: PUBLIC.includes(modStatus) },
    { id: 'flagged', label: 'Hide for review', icon: EyeOff, cls: 'dz-btn-ghost', hidden: modStatus === 'flagged' },
    { id: 'removed', label: 'Remove', icon: Ban, cls: 'dz-btn-danger', hidden: modStatus === 'removed' },
  ].filter((a) => !a.hidden);

  return (
    <Block
      icon={Gavel}
      title="Decision"
      aside={<Badge status={modStatus}>{MOD_LABEL[modStatus] || null}</Badge>}
      className="flatmate-decision-section"
    >
      {/* Keyed off the timestamp: the server's own presence test is `recheck_requested_at is not null`. */}
      {recheck?.at ? (
        <div className="flatmate-mod-recheck mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-500/[0.06] p-3 text-sm text-amber-200">
          <History className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">Re-check: {recheck.reason || 'edited'} · {fmtDate(recheck.at)}</span>
          {/* Re-stamping the current state is the server's "I read the edit and it is fine". */}
          <button type="button" disabled={busy} onClick={() => onDecide(modStatus, note)} className="dz-btn dz-btn-success">
            <Check className="h-4 w-4" />Looks fine
          </button>
        </div>
      ) : null}

      <textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Internal note (optional)"
        aria-label="Internal note (optional)"
        className="dz-input w-full"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {actions.map((a) => (
          <button key={a.id} type="button" disabled={busy} onClick={() => onDecide(a.id, note)} className={`dz-btn ${a.cls}`}>
            <a.icon className="h-4 w-4" />{a.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-500">The note stays internal. Publishing does not grant a trust badge.</p>
    </Block>
  );
}
