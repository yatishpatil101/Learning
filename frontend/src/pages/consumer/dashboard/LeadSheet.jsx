import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import { avatarFor, timeAgo } from '../../../lib/format.js';
import { CallBtn, WhatsAppBtn } from './components.jsx';
/* Lead detail sheet — progressive disclosure for a single request. */

const toDateInput = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function LeadSheet({ lead, annotation, onClose, onSaveAnnotation, busy = false }) {
  const [note, setNote] = useState(annotation?.note || '');
  const [followUp, setFollowUp] = useState(toDateInput(annotation?.followUpAt));
  const [running, setRunning] = useState(false);
  const lastSavedNote = useRef(annotation?.note || '');
  const noteRef = useRef(note);
  const saveRef = useRef(onSaveAnnotation);
  noteRef.current = note;
  saveRef.current = onSaveAnnotation;

  const flushNote = async () => {
    const trimmed = noteRef.current.trim();
    if (lastSavedNote.current === trimmed) return true;
    await saveRef.current({ note: trimmed });
    lastSavedNote.current = trimmed;
    return true;
  };
  const saveFollowUp = (v) => {
    setFollowUp(v);
    // Anchor at local noon so the stored timestamp never drifts to the day before.
    saveRef.current({ followUpAt: v ? new Date(v + 'T12:00').getTime() : null });
  };

  useEffect(() => () => {
    const trimmed = noteRef.current.trim();
    if (lastSavedNote.current !== trimmed) void saveRef.current({ note: trimmed });
  }, []);

  if (!lead) return null;

  const close = async () => {
    await flushNote();
    onClose();
  };

  const run = async (fn) => {
    if (!fn || running || busy) return;
    setRunning(true);
    try {
      const ok = await fn();
      if (ok === false) {
        setRunning(false);
        return;
      }
      await flushNote();
      setRunning(false);
      onClose();
      return;
    } catch {
      setRunning(false);
      return;
    }
  };
  const pending = lead.canApprove && lead.status === 'pending';
  const actionBusy = running || busy;
  const statusLabel = {
    pending: 'Waiting on you',
    approved: 'Accepted',
    accepted: 'Accepted',
    resolved: 'Accepted',
    granted: 'Accepted',
    declined: 'Declined',
    expired: 'Expired',
  }[String(lead.status || '').toLowerCase()] || 'Declined';

  return (
    <Modal open onClose={close} title="Lead details" size="sm">
      <div className="space-y-5 pb-[var(--dz-safe-b)]">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-teal to-emerald-500 text-sm font-bold text-white ring-1 ring-white/10">{avatarFor(lead.name)}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-white">{lead.name}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400">
              <Icon name={lead.typeIcon} className="h-3.5 w-3.5 text-brand-teal" /> {lead.typeLabel}
            </p>
          </div>
          {lead.status ? <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-gray-200">{statusLabel}</span> : null}
        </div>

        <div className="space-y-2 rounded-xl bg-white/[0.03] p-3.5 text-sm">
          {lead.propLabel ? (
            <p className="flex items-center gap-2 text-gray-300"><Icon name="home" className="h-4 w-4 flex-shrink-0 text-gray-500" /> <span className="min-w-0 truncate">{lead.propLabel}</span></p>
          ) : null}
          {lead.detail ? (
            <p className="flex items-start gap-2 text-gray-400"><Icon name="info" className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" /> <span>{lead.detail}</span></p>
          ) : null}
          {lead.requestedAt ? (
            <p className="flex items-center gap-2 text-gray-500"><Icon name="clock" className="h-4 w-4 flex-shrink-0" /> Requested {timeAgo(lead.requestedAt)}</p>
          ) : null}
          {lead.contactMobile ? (
            <p className="flex items-center gap-2 text-gray-500"><Icon name="phone" className="h-4 w-4 flex-shrink-0" /> +91 {lead.contactMobile}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="lead-note" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-300">
            <Icon name="pencil" className="h-3.5 w-3.5 text-gray-500" /> Private note
          </label>
          <textarea
            id="lead-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => { void flushNote(); }}
            rows={2}
            placeholder="Add a private note about this lead…"
            className="field w-full resize-none rounded-xl px-3.5 py-2.5 text-sm"
          />
        </div>

        <div>
          <label htmlFor="lead-followup" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-gray-300">
            <Icon name="calendar-clock" className="h-3.5 w-3.5 text-gray-500" /> Follow-up date
          </label>
          <input
            id="lead-followup"
            type="date"
            value={followUp}
            onChange={(e) => saveFollowUp(e.target.value)}
            className="field w-full rounded-xl px-3.5 py-2.5 text-sm"
          />
        </div>

        <div className="space-y-2 border-t border-white/10 pt-4">
          {/* One-sided leads collapse to one full-width button instead of wiring Decline to undefined. */}
          {pending ? (
            <div className={lead.decline ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1 gap-2'}>
              <button disabled={actionBusy} onClick={() => { void run(lead.approve); }} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-brand-teal/20 text-sm font-semibold text-brand-teal transition hover:bg-brand-teal/30 disabled:opacity-50">
                <Icon name="check" className="h-4 w-4" /> {lead.approveLabel || 'Approve'}
              </button>
              {lead.decline ? (
                <button disabled={actionBusy} onClick={() => { void run(lead.decline); }} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-white/5 text-sm font-semibold text-gray-300 transition hover:bg-white/10 disabled:opacity-50">
                  <Icon name="x" className="h-4 w-4" /> {lead.declineLabel || 'Decline'}
                </button>
              ) : null}
            </div>
          ) : null}
          {lead.primaryAction ? (
            <Link to={lead.primaryAction.to} onClick={() => { void close(); }} className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl bg-brand-teal/20 text-sm font-semibold text-brand-teal transition hover:bg-brand-teal/30">
              <Icon name={lead.primaryAction.icon || 'arrow-right'} className="h-4 w-4" /> {lead.primaryAction.label}
            </Link>
          ) : null}
          {lead.contactMobile ? (
            <div className="grid grid-cols-2 gap-2">
              <CallBtn mobile={lead.contactMobile} name={lead.name} label="Call" />
              <WhatsAppBtn mobile={lead.contactMobile} name={lead.name} label="WhatsApp" />
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
