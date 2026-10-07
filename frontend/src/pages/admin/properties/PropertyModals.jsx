import { Link } from 'react-router';
import { Archive, ExternalLink, Flag, MapPin, Save, XCircle } from 'lucide-react';
import { classNames } from '../../../lib/format.js';
import { fmtINR } from '../../../lib/format.js';
import Modal from '../../../components/ui/Modal.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import Select from '../../../components/ui/Select.jsx';
import InternalNote from '../../../components/ui/InternalNote.jsx';
import { EDIT_DEAL_OPTS, EDIT_STATUS_OPTS, dealLabel, perSqftLabel, liveHref, detailKvs, fmtAgo, statusLabel } from './constants.js';
import { REVIEW_REASONS, ownerMessagePreview } from './reviewReasons.js';

export function PropertyEditModal({ edit, setEdit, onClose, onSubmit, saving, canSetStatus }) {
  if (!edit) return null;
  const rejected = edit._ref?.status === 'rejected';
  return (
    <Modal
      open={!!edit}
      onClose={onClose}
      title="Edit listing"
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className="dz-btn dz-btn-ghost">Cancel</button>
          <button type="button" onClick={onSubmit} disabled={saving} className="dz-btn dz-btn-primary disabled:opacity-40"><Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save changes'}</button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-gray-300">Title <span className="text-rose-400">*</span></span>
          <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className="dz-input" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-gray-300">Price ({'\u20B9'}) <span className="text-rose-400">*</span></span>
            <input type="number" min="0" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} className="dz-input" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-gray-300">Built-up area (sq.ft)</span>
            <input type="number" min="0" value={edit.area} onChange={(e) => setEdit({ ...edit, area: e.target.value })} className="dz-input" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-gray-300">Configuration (BHK)</span>
            {/* Numeric like Price and Area; free text published values the listing form never offers. */}
            <input type="number" min="0" step="1" value={edit.bhk} onChange={(e) => setEdit({ ...edit, bhk: e.target.value })} className="dz-input" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-gray-300">Property type</span>
            <input value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })} className="dz-input" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-gray-300">Locality <span className="text-rose-400">*</span></span>
            <input value={edit.locality} onChange={(e) => setEdit({ ...edit, locality: e.target.value })} className="dz-input" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-gray-300">Deal</span>
            <Select value={edit.deal} onChange={(v) => setEdit({ ...edit, deal: v })} options={EDIT_DEAL_OPTS} ariaLabel="Deal" />
          </label>
        </div>
        {canSetStatus ? (
          <label className="block text-sm">
            <span className="mb-1 block text-gray-300">Status</span>
            {rejected ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-300">
                {statusLabel(edit.status)} — use Request reopen in the review panel to reverse a final rejection.
              </div>
            ) : (
              <Select value={edit.status} onChange={(v) => setEdit({ ...edit, status: v })} options={EDIT_STATUS_OPTS} ariaLabel="Status" />
            )}
          </label>
        ) : null}
      </div>
    </Modal>
  );
}
export function PropertyFlagModal({ flagFor, setFlagFor, flagReason, setFlagReason, internalNote, setInternalNote, onSubmit }) {
  return (
    <Modal
      open={!!flagFor}
      onClose={() => setFlagFor(null)}
      title="Flag listing"
      footer={
        <>
          <button onClick={() => setFlagFor(null)} className="dz-btn dz-btn-ghost">Cancel</button>
          <button onClick={onSubmit} className="dz-btn dz-btn-danger"><Flag className="h-4 w-4" /> Flag listing</button>
        </>
      }
    >
      <p className="mb-3 text-sm text-gray-400">Flagging hides the listing and moves it to the Flagged tab for follow-up.</p>
      <label className="block text-sm">
        <span className="mb-1 block text-gray-300">Reason for flagging (visible to the team)</span>
        <textarea value={flagReason} onChange={(e) => setFlagReason(e.target.value)} rows={3} placeholder={'e.g. Suspected duplicate \u00B7 price looks off \u00B7 photos mismatch'} className="dz-input resize-none" />
      </label>
      {flagFor && <InternalNote entityType="listing" entityId={flagFor.id} value={internalNote} onChange={setInternalNote} showHistory />}
    </Modal>
  );
}

export function PropertyArchiveModal({ archiveFor, setArchiveFor, archiveReason, setArchiveReason, internalNote, setInternalNote, onSubmit }) {
  return (
    <Modal
      open={!!archiveFor}
      onClose={() => setArchiveFor(null)}
      title="Archive listing"
      footer={
        <>
          <button onClick={() => setArchiveFor(null)} className="dz-btn dz-btn-ghost">Cancel</button>
          <button onClick={onSubmit} className="dz-btn dz-btn-danger"><Archive className="h-4 w-4" /> Archive</button>
        </>
      }
    >
      <p className="mb-3 text-sm text-gray-400">Archiving hides the listing from all public views but preserves it in the system. It can be restored later.</p>
      <label className="block text-sm">
        <span className="mb-1 block text-gray-300">Reason for archiving (optional)</span>
        <textarea value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} rows={3} placeholder={'e.g. Owner requested removal \u00B7 Listing expired \u00B7 Duplicate entry'} className="dz-input resize-none" />
      </label>
      {archiveFor && <InternalNote entityType="listing" entityId={archiveFor.id} value={internalNote} onChange={setInternalNote} showHistory />}
    </Modal>
  );
}

export function PropertyViewModal({ view, setView }) {
  return (
    <Modal
      open={!!view}
      onClose={() => setView(null)}
      title="Listing details"
      size="lg"
      footer={
        view ? (
          <>
            <Link to={liveHref(view)} target="_blank" rel="noopener noreferrer" className="dz-btn dz-btn-ghost mr-auto">
              <ExternalLink className="h-4 w-4" /> Open public page
            </Link>
            <button onClick={() => setView(null)} className="dz-btn dz-btn-primary">Close</button>
          </>
        ) : null
      }
    >
      {view ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="min-w-0">
              <div className="text-lg font-extrabold text-white">{view.title}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge status={view.status}>{statusLabel(view.status)}</Badge>
                <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-gray-300">{dealLabel(view.deal)}</span>
                {view.featured ? <span className="rounded-full border border-teal-400/30 bg-teal-500/15 px-2.5 py-0.5 text-xs text-teal-300">{'\u2605'} Featured</span> : null}
                {view.real ? <span className="rounded-full border border-teal-400/30 bg-teal-500/15 px-2.5 py-0.5 text-xs text-teal-300">Live user post</span> : null}
              </div>
              <div className="mt-2 flex items-center gap-1 text-sm text-gray-300">
                <MapPin className="h-3.5 w-3.5" /> {view.locality} {'\u00B7'} {view.bhk || '\u2014'} {'\u00B7'} {view.type}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-extrabold text-teal-300">{fmtINR(view.price)}</div>
              <div className="mt-1 text-xs text-gray-400">{perSqftLabel(view)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 sm:grid-cols-3">
            {detailKvs(view).map(([k, v, full]) => (
              <div key={k} className={classNames('bg-ink-2 p-3', full && 'col-span-2 sm:col-span-3')}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{k}</div>
                <div className="mt-0.5 break-words text-sm font-semibold text-gray-100">{v}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function ReasonPicker({ decision = 'reject', reasonCode, setReasonCode, note, setNote }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {REVIEW_REASONS.map((reason) => (
          <button key={reason.code} type="button" onClick={() => setReasonCode(reason.code)}
            className={classNames('rounded-full border px-3 py-1.5 text-xs font-semibold transition', reasonCode === reason.code
              ? 'border-brand-teal bg-brand-teal text-ink'
              : 'border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/20')}>
            {reason.label}
          </button>
        ))}
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-gray-300">Note {reasonCode === 'other' ? <span className="text-rose-300">*</span> : <span className="text-gray-500">(optional)</span>}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={'One clear fix for the owner…'} className="dz-input resize-none" />
      </label>
      {reasonCode ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-500">Owner message preview</div>
          <div className="whitespace-pre-wrap text-sm text-gray-300">{ownerMessagePreview(decision, reasonCode, note)}</div>
        </div>
      ) : null}
    </div>
  );
}

export function PropertyRecheckRejectModal({ target, setTarget, reasonCode, setReasonCode, note, setNote, onSubmit }) {
  return (
    <Modal
      open={!!target}
      onClose={() => setTarget(null)}
      title="Re-check failed — take listing down"
      footer={
        <>
          <button onClick={() => setTarget(null)} className="dz-btn dz-btn-ghost">Cancel</button>
          <button onClick={onSubmit} className="dz-btn dz-btn-danger"><XCircle className="h-4 w-4" /> Reject listing</button>
        </>
      }
    >
      {target ? (
        <>
          <p className="mb-3 text-sm text-gray-400">
            <span className="text-gray-200">{target.title}</span> has stayed live and searchable since the
            owner edited <span className="text-gray-200">{target.recheckReason || 'these fields'}</span>
            {target.recheckRequestedAt ? <> ({fmtAgo(target.recheckRequestedAt)})</> : null}. Rejecting removes it
            from search now and sends the reason below to the owner.
          </p>
          <ReasonPicker reasonCode={reasonCode} setReasonCode={setReasonCode} note={note} setNote={setNote} />
        </>
      ) : null}
    </Modal>
  );
}
