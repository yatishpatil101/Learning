import { useState } from 'react';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import { avatarFor, timeAgo } from '../../../lib/format.js';
import { StatusBadge, CallBtn, WhatsAppBtn } from './components.jsx';

/* Lead detail sheet — progressive disclosure for a single request. Reuses the
   shared Modal (focus trap, Escape, scroll lock) like ListingActionSheet, so it
   stays one design language. The compact list row is the glance; this sheet is
   the depth: full context, a private note, a follow-up date, and every action
   (Approve/Decline, Call, WhatsApp, or the type's primary next step) in one
   thumb-friendly place.

   `lead` is the normalized descriptor built in EnquiriesPanel; `annotation` is the
   saved { note, followUpAt }; `onSaveAnnotation(patch)` persists edits. */

const toDateInput = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function LeadSheet({ lead, annotation, onClose, onSaveAnnotation }) {
  const [note, setNote] = useState(annotation?.note || '');
  const [followUp, setFollowUp] = useState(toDateInput(annotation?.followUpAt));
  if (!lead) return null;

  const saveNote = () => {
    const trimmed = note.trim();
    if ((annotation?.note || '') !== trimmed) onSaveAnnotation({ note: trimmed });
  };
  const saveFollowUp = (v) => {
    setFollowUp(v);
    // Anchor at local noon so the stored timestamp never drifts to the day before.
    onSaveAnnotation({ followUpAt: v ? new Date(v + 'T12:00').getTime() : null });
  };

  const run = (fn) => { fn?.(); onClose(); };
  const pending = lead.canApprove && lead.status === 'pending';

  return (
    <Modal open onClose={onClose} title="Lead details" size="sm">
      <div className="space-y-5">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-teal to-emerald-500 text-sm font-bold text-white ring-1 ring-white/10">{avatarFor(lead.name)}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-white">{lead.name}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400">
              <Icon name={lead.typeIcon} className="h-3.5 w-3.5 text-brand-teal" /> {lead.typeLabel}
            </p>
          </div>
          {lead.status ? <StatusBadge status={lead.status} /> : null}
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
            onBlur={saveNote}
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
          {pending ? (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => run(lead.approve)} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-brand-teal/20 text-sm font-semibold text-brand-teal transition hover:bg-brand-teal/30">
                <Icon name="check" className="h-4 w-4" /> {lead.approveLabel || 'Approve'}
              </button>
              <button onClick={() => run(lead.decline)} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-white/5 text-sm font-semibold text-gray-300 transition hover:bg-white/10">
                <Icon name="x" className="h-4 w-4" /> {lead.declineLabel || 'Decline'}
              </button>
            </div>
          ) : null}
          {lead.primaryAction ? (
            <Link to={lead.primaryAction.to} onClick={onClose} className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl bg-brand-teal/20 text-sm font-semibold text-brand-teal transition hover:bg-brand-teal/30">
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
