import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Check, CheckCircle, ExternalLink, FileCheck2, FileText,
  HelpCircle, Info, MapPin, MessagesSquare,
  Send, X, XCircle, History, ArrowRight, AlertTriangle, TrendingDown,
} from 'lucide-react';
import {
  startPropertyReview, markPropertyReviewRead,
  setPropertyReviewChecklistItem, addPropertyReviewMessage, decidePropertyReview,
} from '../../../services/propertyReviewService.js';
import { setListingStatus } from '../../../services/propertyService.js';
import { chaseOwner, listOutreachTemplates, listOwnerOutreach } from '../../../services/outreachService.js';
import { interpolateOutreachTemplate } from '../../../lib/outreachTemplate.js';
import { fmtINR, classNames } from '../../../lib/format.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useAdminFlags } from '../../../context/AdminFlagsContext.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import InternalNote, { saveNoteIfAny } from '../../../components/ui/InternalNote.jsx';
import { listNotes } from '../../../services/noteService.js';
import { dealLabel, perSqftLabel, liveHref, fmtAgo, detailKvs } from './constants.js';
import { iconBtn } from './review-modal/styles.js';
import WhatsappTemplates from './review-modal/WhatsappTemplates.jsx';
import CommunicationLog from './review-modal/CommunicationLog.jsx';
import OwnershipEvidencePanel from './review-modal/OwnershipEvidencePanel.jsx';
import { SubmittedPhotos, SubmittedDescription, SubmittedLocation } from './review-modal/SubmittedContent.jsx';

// Verification routes require UUIDs; the display id may be a public slug.
const pid = (listing) => listing?.uuid || listing?.id;

export default function PropertyReviewModal({ review, setReview, onRefresh }) {
  const { toast } = useToast();
  const { optionEnabled } = useAdminFlags();
  const { user } = useAuth();
  const [thread, setThread] = useState(null);
    // Derive timeline labels at render because templates and ledger rows load independently.
  const [outreach, setOutreach] = useState([]);
  const [notes, setNotes] = useState([]);
  const [commsOpen, setCommsOpen] = useState(false);
  const [waTemplates, setWaTemplates] = useState([]);
  const [waOpen, setWaOpen] = useState(false);
  const [waPreview, setWaPreview] = useState(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [msg, setMsg] = useState('');
  const [internalNote, setInternalNote] = useState('');
    // Decisions stay disabled while their server write is pending.
  const [busy, setBusy] = useState(false);

  /* Read once per render rather than inside the effect, so it can be a dependency: flags resolve async, and
     one turning true after the modal opened left the timeline mounted empty with no second fetch. */
  const commsLogOn = optionEnabled('properties.commsLog');

    // Per-run cancellation prevents StrictMode and listing-switch races. Idempotent open avoids
    // a get-then-create race; the read receipt is bodyless, so render the opened case file.
  useEffect(() => {
    if (!review) return undefined;
    let cancelled = false;
    const listing = review;
    (async () => {
      try {
        const caseFile = await startPropertyReview(pid(listing));
        await markPropertyReviewRead(pid(listing));
        if (cancelled) return;
        setThread(caseFile);
      } catch (err) {
        if (cancelled) return;
        toast(err?.message || 'Could not open the verification case file', 'error');
        /* Close rather than sit on a dialog that renders nothing: the parent hands back the same listing
           object, so leaving `review` set means React bails out and the row cannot be reopened. */
        setThread(null);
        setReview(null);
      }
    })();
    setOutreach([]);
    setNotes([]);
    if (commsLogOn) {
      // A collapsed timeline's fetch must not block the checklist or decision buttons.
      (async () => {
        try {
          const rows = await listOwnerOutreach(pid(listing));
          if (!cancelled) setOutreach(rows);
        } catch {
          if (!cancelled) setOutreach([]);
        }
      })();
      // Notes and chasers share a timeline but load independently so one failure cannot erase both.
      (async () => {
        try {
          const rows = await listNotes('listing', listing.id);
          if (!cancelled) setNotes(rows);
        } catch {
          if (!cancelled) setNotes([]);
        }
      })();
    }
    setCommsOpen(false);
    setRejectMode(false);
    setRejectReason('');
    setMsg('');
    setInternalNote('');
    setWaOpen(false);
    setWaPreview(null);
    setBusy(false);
    // Under review is derived from pending status; opening a case must not rewrite pipeline stages.
    return () => {
      cancelled = true;
      setThread(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review, commsLogOn]);

  // The shared template library is independent of the listing and renders its own empty state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const templates = await listOutreachTemplates('whatsapp');
        if (!cancelled) setWaTemplates(templates);
      } catch {
        if (!cancelled) setWaTemplates([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Only timestamped server records belong here; click-to-chat proves "written", not "sent".
  // Outreach actor UUIDs stay absent: resolving them requires an admin-only audit surface.
  const commsLog = useMemo(() => {
    const chasers = outreach.map((row) => ({
      id: row.id,
      type: 'outreach',
      action: `Chaser written \u2014 ${waTemplates.find((t) => t.id === row.templateId)?.name || row.templateId || 'WhatsApp'}`,
      detail: row.body,
      by: null,
      at: row.preparedAt,
    }));
    const written = notes.map((n) => ({
      id: n.id,
      type: 'note',
      action: n.action ? `Note \u2014 ${n.action}` : 'Note',
      detail: n.text,
      by: n.author || null,
      at: n.at,
    }));
    return [...chasers, ...written]
      .filter((entry) => entry.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [outreach, waTemplates, notes]);

  // Checklist text is the server key; refusal reasons belong in the owner's thread, not a third state.
  const setChecklistItem = async (item, pass) => {
    try {
      setThread(await setPropertyReviewChecklistItem(pid(review), item, pass));
    } catch (err) {
      toast(err?.message || 'Could not update the checklist', 'error');
    }
  };

  const reviewSend = async (clarificationRequested = false) => {
    const v = msg.trim();
    if (!v) return;
    try {
      const caseFile = await addPropertyReviewMessage(pid(review), v, clarificationRequested);
      setMsg('');
      setThread(caseFile);
      toast(clarificationRequested
        ? 'Clarification requested \u2014 returned to the owner'
        : 'Message sent to owner');
      if (clarificationRequested) onRefresh();
    } catch (err) {
      toast(err?.message || 'Could not send the message', 'error');
    }
  };

  // A decision atomically updates the case, listing status and owner message, so do not pair it with a
  // separate status write. The server refuses an approval while any checklist line is still open.
  const reviewApprove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await decidePropertyReview(pid(review), 'approve');
      const noted = await saveNoteIfAny('listing', review.id, internalNote, 'Approved');
      handleClose();
      toast(noted.error
        ? 'Approved & published \u2014 but the internal note could not be saved'
        : 'Approved & published \u2014 owner notified', noted.error ? 'error' : 'success');
      onRefresh();
    } catch (err) {
      toast(err?.message || 'Could not approve this listing', 'error');
    } finally {
      setBusy(false);
    }
  };

  const reviewReject = async () => {
    if (busy) return;
    if (!rejectMode) { setRejectMode(true); return; }
    const reason = rejectReason.trim();
    if (!reason) { toast('Add a clear reason before rejecting', 'error'); return; }
    setBusy(true);
    try {
      await decidePropertyReview(pid(review), 'reject', reason);
      const noted = await saveNoteIfAny('listing', review.id, internalNote, 'Rejected');
      handleClose();
      toast(noted.error
        ? 'Property rejected \u2014 but the internal note could not be saved'
        : 'Property rejected \u2014 owner notified', 'error');
      onRefresh();
    } catch (err) {
      toast(err?.message || 'Could not reject this listing', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => { setReview(null); setThread(null); };

  // Re-approval clears the re-check and notifies the owner atomically without taking the listing down.
  const approveEdits = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setListingStatus(review.id, 'approved', 'Owner edits reviewed');
      /* Close rather than refetch: the re-review panel renders from `review`, the parent's row, so refreshing
         only the case file left the modal announcing an edit it had cleared, over a button that now 409s. */
      handleClose();
      toast('Owner edits approved \u2014 re-review cleared', 'success');
      onRefresh();
    } catch (err) {
      toast(err?.message || 'Could not clear the re-review', 'error');
    } finally {
      setBusy(false);
    }
  };

  // Match the server's template vocabulary without inventing unavailable locality rates.
  // The server's prepared message is authoritative; this listing-based preview is only guidance.
  const previewVariables = (listing) => ({
    owner_name: listing.owner || 'there',
    owner_mobile: listing.ownerMobile || '',
    title: listing.title || '',
    locality: listing.locality || '',
    price: String(listing.price ?? ''),
    listing_id: pid(listing),
    staff_name: user?.name || 'Draazy',
    claim_link: `${window.location.origin}/signin`,
  });

  /* `window.open` runs first and synchronously so the tab stays inside the authorising gesture, then is
     navigated only once the server accepts — a refusal leaves an empty tab, not an unrecorded message. */
  const handleSendWaTemplate = async () => {
    if (busy || !waPreview) return;
    setBusy(true);
    const handoff = window.open('', '_blank');
    try {
      const prepared = await chaseOwner(pid(review), waPreview.id);
      if (handoff) handoff.location = prepared.handoffLink;
      toast('Chaser written \u2014 finish sending it in WhatsApp', 'success');
      setWaOpen(false);
      setWaPreview(null);
      // Re-read the server ledger rather than manufacturing a local history entry.
      if (commsLogOn) {
        try {
          setOutreach(await listOwnerOutreach(pid(review)));
        } catch {
          /* The chaser was written; a failed refresh of the panel below it is not worth a second
             toast contradicting the first. */
        }
      }
      onRefresh();
    } catch (err) {
      if (handoff) handoff.close();
      toast(err?.message || 'Could not write this chaser', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!review || !thread) return null;

  return (
    <>
      <Modal
        open
        onClose={handleClose}
        title="Verify property"
        size="lg"
        footer={
          <>
            {review.status === 'approved' ? (
              <Link to={liveHref(review)} target="_blank" rel="noopener noreferrer" className="dz-btn dz-btn-ghost mr-auto">
                <ExternalLink className="h-4 w-4" /> Open live listing
              </Link>
            ) : (
              <span className="mr-auto text-xs text-gray-500 italic">Not yet published</span>
            )}
            <button onClick={handleClose} className="dz-btn dz-btn-ghost">Close</button>
            <button onClick={reviewReject} disabled={busy} className="dz-btn dz-btn-danger">
              <XCircle className="h-4 w-4" /> {rejectMode ? 'Confirm rejection' : 'Reject\u2026'}
            </button>
            <button onClick={reviewApprove} disabled={busy} className="dz-btn dz-btn-success">
              <CheckCircle className="h-4 w-4" /> Approve &amp; publish
            </button>
          </>
        }
      >
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-white/10 bg-gradient-to-br from-teal-500/10 to-indigo-500/10 p-4">
            <div className="min-w-0">
              <div className="text-lg font-extrabold text-white">{review.title}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge status={review.status} />
                <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-gray-300">{dealLabel(review.deal)}</span>
                {review.featured ? <span className="rounded-full border border-teal-400/30 bg-teal-500/15 px-2.5 py-0.5 text-xs text-teal-300">{'\u2605'} Featured</span> : null}
                {review.real ? <span className="rounded-full border border-teal-400/30 bg-teal-500/15 px-2.5 py-0.5 text-xs text-teal-300">Live user post</span> : null}
                {review.reReview ? <span className="rounded-full border border-amber-400/30 bg-amber-500/15 px-2.5 py-0.5 text-xs text-amber-300 inline-flex items-center gap-1"><History className="h-3 w-3" /> Owner edited</span> : null}
                {review.priceReduced ? <span className="rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-300 inline-flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Price reduced</span> : null}
              </div>
              <div className="mt-2 flex items-center gap-1 text-sm text-gray-300">
                <MapPin className="h-3.5 w-3.5" /> {review.locality} {'\u00B7'} {review.bhk || '\u2014'} {'\u00B7'} {review.type}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-extrabold text-teal-300">{fmtINR(review.price)}</div>
              <div className="mt-1 text-xs text-gray-400">{perSqftLabel(review)}</div>
            </div>
          </div>

          <SubmittedPhotos listing={review} />

          <SubmittedDescription listing={review} />

          <SubmittedLocation listing={review} />

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-200">
              <Info className="h-4 w-4 text-brand-teal" /> Property details
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 sm:grid-cols-3">
              {detailKvs(review).map(([k, v, full]) => (
                <div key={k} className={classNames('bg-ink-2 p-3', full && 'col-span-2 sm:col-span-3')}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{k}</div>
                  <div className="mt-0.5 break-words text-sm font-semibold text-gray-100">{v}</div>
                </div>
              ))}
            </div>
          </div>

          <OwnershipEvidencePanel propertyId={pid(review)} listing={review} onRefresh={onRefresh} />

          {review.reReview && (
            <div className="rounded-2xl border border-amber-400/25 bg-amber-500/[0.05] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-200">
                <History className="h-4 w-4" /> Owner edited this live listing
                {review.materialEditFlag ? (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-rose-400/30 bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-300">
                    <AlertTriangle className="h-3 w-3" /> Needs a closer look
                  </span>
                ) : null}
              </div>
              <p className="mb-3 text-xs text-gray-400">
                The listing stayed live. Review the changes below and approve to clear the re-check.
                {review.reReview.identityChanged ? ' The owner changed a core identity field (type/locality).' : ''}
              </p>
              <div className="space-y-1.5">
                {(review.reReview.fields || []).map((f) => (
                  <div key={f.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="text-[11px] uppercase tracking-wide text-gray-500">{f.label}</div>
                      <div className="truncate text-gray-400 line-through">{f.from}</div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
                    <div className="min-w-0 text-right">
                      <div className="text-[11px] uppercase tracking-wide text-gray-500">Now</div>
                      <div className="truncate font-semibold text-gray-100">{f.to}</div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={approveEdits} disabled={busy} className="dz-btn dz-btn-success mt-3">
                <CheckCircle className="h-4 w-4" /> Approve edits
              </button>
            </div>
          )}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-200">
              <FileCheck2 className="h-4 w-4 text-brand-teal" /> Verification checklist
              <span className="ml-auto text-xs font-semibold text-gray-400">
                {thread.checklist.filter((c) => c.pass).length} / {thread.checklist.length} checked
              </span>
            </div>
            <div className="space-y-1">
              {thread.checklist.map((c) => (
                <div key={c.item} className="flex flex-col gap-2 border-t border-white/10 py-2.5 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    <span className="truncate text-sm font-semibold text-gray-100">{c.item}</span>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5 pl-[26px] sm:pl-0">
                    <button
                      onClick={() => setChecklistItem(c.item, !c.pass)}
                      aria-pressed={c.pass}
                      title={c.pass ? 'Checked \u2014 click to undo' : 'Mark as checked'}
                      className={classNames(iconBtn, c.pass
                        ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300'
                        : 'border-white/10 text-gray-400 hover:bg-white/5')}
                    >
                      {c.pass ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                      <span className="sr-only">{c.item}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-200">
              <MessagesSquare className="h-4 w-4 text-brand-teal" /> Communicate with the owner
            </div>
            <div className="flex max-h-60 flex-col gap-2 overflow-y-auto rounded-xl border border-white/10 bg-ink p-2">
              {thread.messages.length ? (
                thread.messages.map((m) => {
                  /* An internal message must not be laid out as part of a conversation the heading says the
                     owner is party to: read as an ordinary bubble, a moderator assumes the owner was told. */
                  if (m.internal) {
                    return (
                      <div key={m.id} className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-50">
                        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-300">
                          <AlertTriangle className="h-3.5 w-3.5" /> Staff only {'\u00B7'} not shown to the owner
                        </div>
                        <div className="whitespace-pre-wrap">{m.body}</div>
                        <div className="mt-1 text-[11px] text-amber-200/70">{fmtAgo(m.at)}</div>
                      </div>
                    );
                  }
                  const me = m.from === 'ops';
                  return (
                    <div key={m.id} className={classNames('flex', me && 'justify-end')}>
                      <div className={classNames('max-w-[80%] whitespace-pre-wrap rounded-xl border px-3 py-2 text-sm', me ? 'border-teal-400/30 bg-teal-500/15 text-teal-50' : 'border-white/10 bg-white/5 text-gray-100')}>
                        {m.body}
                        <div className="mt-1 text-[11px] text-gray-400">{me ? 'You (Draazy)' : review.owner} {'\u00B7'} {fmtAgo(m.at)}</div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-3 text-center text-sm text-gray-400">No messages yet. Ask the owner for any clarification before deciding.</div>
              )}
            </div>
            <div className="mt-2.5 flex items-stretch gap-2">
              <textarea value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') reviewSend(false); }} rows={2} placeholder={'Share a note, or ask for a clarification to hand the listing back for correction\u2026'} className="dz-input flex-1 resize-none" />
              <div className="flex flex-col gap-2">
                <button onClick={() => reviewSend(false)} title="Send" className="dz-btn dz-btn-primary"><Send className="h-4 w-4" /></button>
                {/* Handing a listing back only means something while it is still waiting on us: the
                    server refuses it for anything already published, so an always-live button spent
                    a reviewer's click to produce a 409. Plain Send stays available either way, since
                    writing to the owner of a live listing is perfectly ordinary. (A listing our own
                    staff posted is refused too, but the track is not in the read this modal gets —
                    that one is still left to the server's message.) */}
                <button
                  onClick={() => reviewSend(true)}
                  disabled={review.status !== 'pending'}
                  title={review.status === 'pending'
                    ? 'Request clarification \u2014 hands the listing back to the owner to correct'
                    : 'Only a listing still awaiting review can be handed back'}
                  className="dz-btn dz-btn-ghost"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {review.ownerMobile && (
            <WhatsappTemplates
              review={review}
              waOpen={waOpen}
              setWaOpen={setWaOpen}
              waTemplates={waTemplates}
              waPreview={waPreview}
              setWaPreview={setWaPreview}
              waPreviewText={waPreview ? interpolateOutreachTemplate(waPreview.body, previewVariables(review)) : ''}
              busy={busy}
              handleSendWaTemplate={handleSendWaTemplate}
            />
          )}

          {commsLogOn && (
            <CommunicationLog
              commsOpen={commsOpen}
              setCommsOpen={setCommsOpen}
              commsLog={commsLog}
            />
          )}

          {rejectMode ? (
            <div className="rounded-2xl border border-rose-400/30 bg-white/[0.03] p-4">
              <label className="mb-1 block text-sm text-gray-300">Reason for rejection (sent to the owner)</label>
              <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} placeholder={'Be specific: which document or detail is missing/invalid and what the owner should fix\u2026'} className="dz-input resize-none" />
            </div>
          ) : null}

          <InternalNote entityType="listing" entityId={review.id} value={internalNote} onChange={setInternalNote} showHistory />
        </div>
      </Modal>
    </>
  );
}
