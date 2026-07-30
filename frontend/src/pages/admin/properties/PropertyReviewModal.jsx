import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Check, CheckCircle, ExternalLink, Eye, FileCheck2, FileText,
  Info, MapPin, MessagesSquare, Pencil,
  Send, X, XCircle, History, ArrowRight, AlertTriangle, TrendingDown,
} from 'lucide-react';
import {
  ensureReview, getReview, markReviewRead, setDocStatus,
  addReviewMessage, decideReview,
} from '../../../lib/data/properties-admin.js';
import { setListingStatus } from '../../../services/propertyService.js';
import { setPipelineStage, getOwnerCommsLog, getWhatsappTemplates, sendWhatsappTemplate } from '../../../lib/mockApi.js';
import { updateListingFields } from '../../../services/propertyService.js';
import { submitNote } from '../../../components/ui/InternalNote.jsx';
import { logAudit } from '../../../lib/mockApi.js';
import { fmtINR, classNames } from '../../../lib/format.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAdminFlags } from '../../../context/AdminFlagsContext.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import InternalNote from '../../../components/ui/InternalNote.jsx';
import { dealLabel, perSqftLabel, liveHref, fmtAgo, detailKvs } from './constants.js';
import { iconBtn } from './review-modal/styles.js';
import DocPill from './review-modal/DocPill.jsx';
import WhatsappTemplates from './review-modal/WhatsappTemplates.jsx';
import CommunicationLog from './review-modal/CommunicationLog.jsx';
import DocViewerModal from './review-modal/DocViewerModal.jsx';

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

  // Doc viewer state
  const [dv, setDv] = useState(null);
  const [dvNote, setDvNote] = useState('');

  const openReview = (l) => {
    ensureReview(l);
    markReviewRead(l.id, 'admin');
    setThread(getReview(l.id));
    if (optionEnabled('properties.commsLog')) setCommsLog(getOwnerCommsLog(l.id));
    else setCommsLog([]);
    setCommsOpen(false);
    setRejectMode(false);
    setRejectReason('');
    setMsg('');
    setInternalNote('');
    setWaOpen(false);
    setWaPreview(null);
    if (!l.pipelineStage || l.pipelineStage === 'listed' || l.pipelineStage === 'docs_submitted') {
      setPipelineStage(l.id, 'under_review');
    }
  };

  // Initialize when review prop changes
  useEffect(() => {
    if (review) openReview(review);
    return () => setThread(null);
  }, [review]);

  const refreshThread = (id) => setThread(getReview(id));

  const reviewSetDoc = (docId, status) => {
    setDocStatus(review.id, docId, status);
    refreshThread(review.id);
  };
  const reviewSend = () => {
    const v = msg.trim();
    if (!v) return;
    addReviewMessage(review.id, 'admin', v);
    setMsg('');
    refreshThread(review.id);
    toast('Message sent to owner');
  };
  const reviewApprove = () => {
    const t = getReview(review.id);
    const pending = (t?.docs || []).filter((d) => d.status !== 'verified');
    if (pending.length && !window.confirm(`${pending.length} document(s) are not marked verified yet. Approve and publish anyway?`)) return;
    decideReview(review.id, 'approved');
    setListingStatus(review.id, 'approved');
    setPipelineStage(review.id, 'live');
    updateListingFields(review.id, { flagReason: '' });
    submitNote('listing', review.id, internalNote, 'Approved');
    logAudit('Listing', `Approved & published "${review.title}"`);
    handleClose();
    toast('Approved & published \u2014 owner notified', 'success');
    onRefresh();
  };
  const reviewReject = () => {
    if (!rejectMode) { setRejectMode(true); return; }
    const reason = rejectReason.trim();
    if (!reason) { toast('Add a clear reason before rejecting', 'error'); return; }
    decideReview(review.id, 'rejected', reason);
    setListingStatus(review.id, 'rejected');
    submitNote('listing', review.id, internalNote, 'Rejected');
    logAudit('Listing', `Rejected "${review.title}" \u2014 reason: ${reason}`);
    handleClose();
    toast('Property rejected \u2014 owner notified', 'error');
    onRefresh();
  };

  const handleClose = () => { setReview(null); setThread(null); setDv(null); };

  /* P0 — sign off on owner edits made to a live listing. The listing was never
     pulled down; this just clears the re-review flag after a quick diff check. */
  const approveEdits = () => {
    updateListingFields(review.id, { reReview: null, materialEditFlag: false });
    addReviewMessage(review.id, 'admin', 'Your recent edits have been reviewed and approved. Thanks for keeping your listing accurate.');
    logAudit('Listing', `Approved owner edits on "${review.title}"`);
    toast('Owner edits approved \u2014 re-review cleared', 'success');
    setReview({ ...review, reReview: null, materialEditFlag: false });
    onRefresh();
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

  // Doc viewer
  const dvDoc = useMemo(() => {
    if (!dv || !thread) return null;
    return (thread.docs || []).find((d) => d.id === dv.docId) || null;
  }, [dv, thread]);
  const openDocViewer = (docId) => {
    const t = getReview(review.id);
    const doc = (t?.docs || []).find((d) => d.id === docId);
    setDv({ listingId: review.id, docId });
    setDvNote(doc?.note || '');
  };
  const dvSetStatus = (status) => {
    setDocStatus(dv.listingId, dv.docId, status);
    refreshThread(dv.listingId);
    toast('Document marked ' + status);
  };
  const dvSaveNote = () => {
    const d = (getReview(dv.listingId)?.docs || []).find((x) => x.id === dv.docId);
    setDocStatus(dv.listingId, dv.docId, d?.status || 'pending', dvNote.trim());
    refreshThread(dv.listingId);
    toast('Note saved');
  };

  if (!review || !thread) return null;

  return (
    <>
      <Modal
        open={!!review}
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
            <button onClick={reviewReject} className="pn-btn pn-btn-danger">
              <XCircle className="h-4 w-4" /> {rejectMode ? 'Confirm rejection' : 'Reject\u2026'}
            </button>
            <button onClick={reviewApprove} className="pn-btn pn-btn-success">
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
              <FileCheck2 className="h-4 w-4 text-brand-teal" /> Documents
              <span className="ml-auto text-xs font-semibold text-gray-400">
                {thread.docs.filter((d) => d.status === 'verified').length} / {thread.docs.length} verified
              </span>
            </div>
            <div className="space-y-1">
              {thread.docs.map((d) => (
                <div key={d.id} className="flex flex-col gap-2 border-t border-white/10 py-2.5 first:border-t-0 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <FileText className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-gray-100">{d.name}</span>
                        <span className="flex-shrink-0 sm:hidden"><DocPill status={d.status} /></span>
                      </div>
                      {d.note ? <div className="text-xs text-gray-400">{d.note}</div> : null}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1.5 pl-[26px] sm:pl-0">
                    <span className="hidden sm:inline-flex"><DocPill status={d.status} /></span>
                    <button onClick={() => openDocViewer(d.id)} title="View document" className={iconBtn}><Eye className="h-4 w-4" /></button>
                    <button onClick={() => reviewSetDoc(d.id, 'verified')} title="Mark verified" className={classNames(iconBtn, 'border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/15')}><Check className="h-4 w-4" /></button>
                    <button onClick={() => reviewSetDoc(d.id, 'rejected')} title="Mark rejected" className={classNames(iconBtn, 'border-rose-400/30 text-rose-300 hover:bg-rose-500/15')}><X className="h-4 w-4" /></button>
                    <button onClick={() => openDocViewer(d.id)} title="View & add note" aria-label="View document and add note" className={iconBtn}><Pencil className="h-4 w-4" /></button>
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
                  const me = m.from === 'admin';
                  return (
                    <div key={m.id} className={classNames('flex', me && 'justify-end')}>
                      <div className={classNames('max-w-[80%] whitespace-pre-wrap rounded-xl border px-3 py-2 text-sm', me ? 'border-teal-400/30 bg-teal-500/15 text-teal-50' : 'border-white/10 bg-white/5 text-gray-100')}>
                        {m.text}
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

      {/* Document viewer overlay */}
      <DocViewerModal
        dv={dv}
        dvDoc={dvDoc}
        review={review}
        dvNote={dvNote}
        setDvNote={setDvNote}
        setDv={setDv}
        dvSetStatus={dvSetStatus}
        dvSaveNote={dvSaveNote}
      />
    </>
  );
}
