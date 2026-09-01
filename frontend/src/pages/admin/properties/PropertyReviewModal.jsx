import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Check, CheckCircle, ExternalLink, FileCheck2, FileText,
  Info, MapPin, MessagesSquare,
  Send, X, XCircle, History, ArrowRight, AlertTriangle, TrendingDown,
} from 'lucide-react';
import {
  startPropertyReview, getPropertyReview, markPropertyReviewRead,
  setPropertyReviewChecklistItem, addPropertyReviewMessage, decidePropertyReview,
} from '../../../services/propertyReviewService.js';
import { setPipelineStage, getOwnerCommsLog, getWhatsappTemplates, sendWhatsappTemplate, logAudit } from '../../../lib/mockApi.js';
import { clearFlag, setListingStatus } from '../../../services/propertyService.js';
import { fmtINR, classNames } from '../../../lib/format.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAdminFlags } from '../../../context/AdminFlagsContext.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import InternalNote, { submitNote } from '../../../components/ui/InternalNote.jsx';
import { dealLabel, perSqftLabel, liveHref, fmtAgo, detailKvs } from './constants.js';
import { iconBtn } from './review-modal/styles.js';
import WhatsappTemplates from './review-modal/WhatsappTemplates.jsx';
import CommunicationLog from './review-modal/CommunicationLog.jsx';

/**
 * These routes bind `{id}` as a UUID. `propertyMapper` sets a listing's `id` to `slug || id` and
 * keeps the real key on `uuid`, so the obvious `review.id` is the wrong argument for exactly the
 * listings that have a slug — i.e. the live ones. The failure reads as "no case file", not as a bad
 * id, which is why it is worth a named helper rather than an inline `||` at six call sites.
 */
const pid = (listing) => listing?.uuid || listing?.id;

export default function PropertyReviewModal({ review, setReview, onRefresh }) {
  const { toast } = useToast();
  const { optionEnabled } = useAdminFlags();
  const [thread, setThread] = useState(null);
  const [commsLog, setCommsLog] = useState([]);
  const [commsOpen, setCommsOpen] = useState(false);
  const [waTemplates] = useState(() => getWhatsappTemplates());
  const [waOpen, setWaOpen] = useState(false);
  const [waPreview, setWaPreview] = useState(null);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [msg, setMsg] = useState('');
  const [internalNote, setInternalNote] = useState('');
  /* Every write below is a round trip now, so the decision buttons need a guard as well as a
     `disabled` attribute: the flag only takes effect on the next render, and a double-click lands
     inside that gap. Approving twice would be harmless; rejecting twice posts the reason to the
     owner's thread twice. */
  const [busy, setBusy] = useState(false);

  /*
   * Load the case file when the modal opens.
   *
   * `cancelled` rather than a `mountedRef`: under StrictMode the effect mounts, tears down and
   * re-mounts, and a ref that is only cleared in cleanup stays cleared — every `setThread` after an
   * await would then be silently dropped and the modal would render its null branch forever. A
   * per-run local is also the correct scope for the other race here, which is the operator opening
   * a second listing before the first one's fetch lands.
   *
   * `startPropertyReview` rather than get-then-create: it is idempotent server-side, so one call
   * replaces the mock's `ensureReview` + `getReview` pair and cannot race a second operator opening
   * the same listing. The read-receipt's 204 carries no body, so the case file used for render is
   * the one from before it — nothing here draws the read flag, and the parent list is refreshed by
   * `onRefresh` on close.
   */
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
        setThread(null);
      }
    })();
    setCommsLog(optionEnabled('properties.commsLog') ? getOwnerCommsLog(listing.id) : []);
    setCommsOpen(false);
    setRejectMode(false);
    setRejectReason('');
    setMsg('');
    setInternalNote('');
    setWaOpen(false);
    setWaPreview(null);
    setBusy(false);
    if (!listing.pipelineStage || listing.pipelineStage === 'listed' || listing.pipelineStage === 'docs_submitted') {
      setPipelineStage(listing.id, 'under_review');
    }
    return () => {
      cancelled = true;
      setThread(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review]);

  /**
   * Tick or untick one checklist line.
   *
   * Addressed by its text, which is the only key the wire has: the rows are seeded server-side from
   * a fixed per-deal list and the column is not updatable. The mock's `d_index2`-style ids were
   * local inventions and are gone.
   *
   * The response is the whole case file, so there is no follow-up read — and the two-state tick is
   * the whole control now. `rejected` had no column behind it and no reader: what an approval
   * actually consults is whether every line is ticked, and a rejected document and an un-inspected
   * one both fail that test. The reason a document was refused belongs in the owner's thread, where
   * they can read it, not in a pill only the desk can see.
   */
  const setChecklistItem = async (item, pass) => {
    try {
      setThread(await setPropertyReviewChecklistItem(pid(review), item, pass));
    } catch (err) {
      toast(err?.message || 'Could not update the checklist', 'error');
    }
  };

  const reviewSend = async () => {
    const v = msg.trim();
    if (!v) return;
    try {
      const caseFile = await addPropertyReviewMessage(pid(review), v);
      setMsg('');
      setThread(caseFile);
      toast('Message sent to owner');
    } catch (err) {
      toast(err?.message || 'Could not send the message', 'error');
    }
  };

  /*
   * Approve, or reject with a reason.
   *
   * One call each. The desk used to pair `decideReview` with `setListingStatus`, because the mock's
   * case file and the mock's listing were two unrelated records; the server writes the case file,
   * `properties.status` and the owner-facing thread message in one transaction. Adding the second
   * call back would write the same field twice, and the second write is the one that can silently
   * disagree when it fails.
   *
   * The approval guard counts unticked lines rather than trusting the case status — a case is
   * `pending` until it is decided regardless of how much of the checklist has been worked through.
   */
  const reviewApprove = async () => {
    if (busy) return;
    const unchecked = (thread?.checklist || []).filter((c) => !c.pass);
    if (unchecked.length && !window.confirm(`${unchecked.length} checklist item(s) are not ticked yet. Approve and publish anyway?`)) return;
    setBusy(true);
    try {
      await decidePropertyReview(pid(review), 'approve');
      setPipelineStage(review.id, 'live');
      // clearFlag, not updateListingFields({ flagReason: '' }). The latter is the owner's own PATCH
      // route, so from an admin screen it 404s on somebody else's listing -- and its mapper
      // whitelists a fixed key set that does not include flagReason, so the body serialised to {}
      // and the failure was invisible. Neither half was awaited, so the rejection escaped the try
      // while the toast below still said "approved".
      await clearFlag(review.id);
      submitNote('listing', review.id, internalNote, 'Approved');
      logAudit('Listing', `Approved & published "${review.title}"`);
      handleClose();
      toast('Approved & published \u2014 owner notified', 'success');
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
      submitNote('listing', review.id, internalNote, 'Rejected');
      logAudit('Listing', `Rejected "${review.title}" \u2014 reason: ${reason}`);
      handleClose();
      toast('Property rejected \u2014 owner notified', 'error');
      onRefresh();
    } catch (err) {
      toast(err?.message || 'Could not reject this listing', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => { setReview(null); setThread(null); };

  /* P0 -- sign off on owner edits made to a live listing. The listing was never pulled down; this is
     the moderator saying "looked, still fine", which is exactly what a stays-live re-check asks for.

     Re-approving an already-approved listing is how that is expressed: PropertyModerationService
     .setStatus clears the re-check and notifies the owner in one transaction. It used to be two
     browser writes instead -- updateListingFields({ reReview, materialEditFlag }) against the owner's
     own PATCH route with keys the mapper drops, and a hand-composed "your edits were approved"
     message posted straight into the thread. The first was a silent no-op; the second put owner-
     facing copy back in the browser, which is the thing D218 moved to the server, and could post
     twice on a double-click. */
  const approveEdits = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setListingStatus(review.id, 'approved', 'Owner edits reviewed');
      logAudit('Listing', `Approved owner edits on "${review.title}"`);
      setThread(await getPropertyReview(pid(review)));
      toast('Owner edits approved \u2014 re-review cleared', 'success');
      onRefresh();
    } catch (err) {
      toast(err?.message || 'Could not clear the re-review', 'error');
    } finally {
      setBusy(false);
    }
  };

  const interpolateWaTemplate = (body, listing) => {
    const vars = {
      owner_name: listing.owner || 'Owner',
      title: listing.title || '',
      locality: listing.locality || '',
      price: String(listing.price || ''),
      listing_id: listing.id,
      owner_mobile: listing.ownerMobile || '',
      staff_name: 'You',
      claim_link: `punenest.com/claim/${listing.id}`,
      market_rate: '9,500',
    };
    return body.replace(/\{(\w+)\}/g, (_, k) => vars[k] || `{${k}}`);
  };

  const handleSendWaTemplate = async (listingId, templateId) => {
    const phone = (review.ownerMobile || '').replace(/\D/g, '');
    const message = interpolateWaTemplate(waPreview.body, review);
    window.open(`https://wa.me/91${phone}?text=${encodeURIComponent(message)}`, '_blank');
    await sendWhatsappTemplate(listingId, templateId);
    toast('WhatsApp template sent', 'success');
    setWaOpen(false);
    setWaPreview(null);
    if (optionEnabled('properties.commsLog')) setCommsLog(getOwnerCommsLog(listingId));
    onRefresh();
  };

  /*
   * The document viewer is gone with the mock.
   *
   * It rendered a placeholder that said so in as many words — "Simulated preview for the prototype.
   * In production the owner's uploaded file renders here" — over a record that has never held a
   * file: there is no upload surface, no storage, and no column. What the case file actually holds
   * is a reviewer's checklist, and one of its six buy-side lines is "Listing photos match the
   * property", which is not a document at all. Its per-document note went with it; the thread is
   * where a note the owner has to act on belongs, and `InternalNote` is where a private one does.
   */

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
              <Link to={liveHref(review)} target="_blank" rel="noopener noreferrer" className="pn-btn pn-btn-ghost mr-auto">
                <ExternalLink className="h-4 w-4" /> Open live listing
              </Link>
            ) : (
              <span className="mr-auto text-xs text-gray-500 italic">Not yet published</span>
            )}
            <button onClick={handleClose} className="pn-btn pn-btn-ghost">Close</button>
            <button onClick={reviewReject} disabled={busy} className="pn-btn pn-btn-danger">
              <XCircle className="h-4 w-4" /> {rejectMode ? 'Confirm rejection' : 'Reject\u2026'}
            </button>
            <button onClick={reviewApprove} disabled={busy} className="pn-btn pn-btn-success">
              <CheckCircle className="h-4 w-4" /> Approve &amp; publish
            </button>
          </>
        }
      >
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {/* Hero */}
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

          {/* Details */}
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

          {/* Owner-edit re-review diff (P0) — only when a live listing was edited */}
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
                {review.reReview.fields.map((f) => (
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
              <button onClick={approveEdits} className="pn-btn pn-btn-success mt-3">
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
                    {/* One toggle, not a verified/rejected pair. The two buttons wrote three states
                        into a boolean column; what an approval reads is "is every line ticked", so
                        `rejected` and "not looked at yet" were always the same answer. */}
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

          {/* Messaging */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-200">
              <MessagesSquare className="h-4 w-4 text-brand-teal" /> Communicate with the owner
            </div>
            <div className="flex max-h-60 flex-col gap-2 overflow-y-auto rounded-xl border border-white/10 bg-ink p-2">
              {thread.messages.length ? (
                thread.messages.map((m) => {
                  /* An internal message is one the owner cannot see -- the server filters it out of
                     their copy entirely -- so it must not be laid out as part of a conversation the
                     heading above says the owner is party to. Left as an ordinary ops bubble
                     labelled "You (PuneNest)", a moderator reads the duplicate-probe finding and
                     reasonably concludes the owner has already been told. That misreading is the
                     same disclosure the filter exists to prevent, one step later. */
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
                        <div className="mt-1 text-[11px] text-gray-400">{me ? 'You (PuneNest)' : review.owner} {'\u00B7'} {fmtAgo(m.at)}</div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-3 text-center text-sm text-gray-400">No messages yet. Ask the owner for any clarification before deciding.</div>
              )}
            </div>
            <div className="mt-2.5 flex items-stretch gap-2">
              <textarea value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') reviewSend(); }} rows={2} placeholder={'Ask for a clarification or share a note for the owner\u2026'} className="pn-input flex-1 resize-none" />
              <button onClick={reviewSend} title="Send" className="pn-btn pn-btn-primary"><Send className="h-4 w-4" /></button>
            </div>
          </div>

          {/* WhatsApp Templates */}
          {review.ownerMobile && (
            <WhatsappTemplates
              review={review}
              waOpen={waOpen}
              setWaOpen={setWaOpen}
              waTemplates={waTemplates}
              waPreview={waPreview}
              setWaPreview={setWaPreview}
              interpolateWaTemplate={interpolateWaTemplate}
              handleSendWaTemplate={handleSendWaTemplate}
            />
          )}

          {/* Communication Log */}
          {optionEnabled('properties.commsLog') && (
            <CommunicationLog
              commsOpen={commsOpen}
              setCommsOpen={setCommsOpen}
              commsLog={commsLog}
            />
          )}

          {/* Reject reason */}
          {rejectMode ? (
            <div className="rounded-2xl border border-rose-400/30 bg-white/[0.03] p-4">
              <label className="mb-1 block text-sm text-gray-300">Reason for rejection (sent to the owner)</label>
              <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} placeholder={'Be specific: which document or detail is missing/invalid and what the owner should fix\u2026'} className="pn-input resize-none" />
            </div>
          ) : null}

          <InternalNote entityType="listing" entityId={review.id} value={internalNote} onChange={setInternalNote} showHistory />
        </div>
      </Modal>
    </>
  );
}
