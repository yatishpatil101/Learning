import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  CheckCircle, ExternalLink, FileCheck2, HelpCircle, MapPin,
  Send, XCircle, History, ArrowRight, AlertTriangle, TrendingDown, User,
} from 'lucide-react';
import {
  startPropertyReview, markPropertyReviewRead,
  setPropertyReviewChecklistItem, addPropertyReviewMessage, decidePropertyReview,
  requestPropertyReviewOverride, approvePropertyReviewOverride,
} from '../../../services/propertyReviewService.js';
import { setListingStatus } from '../../../services/propertyService.js';
import { chaseOwner, listOutreachTemplates, listOwnerOutreach } from '../../../services/outreachService.js';
import { interpolateOutreachTemplate } from '../../../lib/outreachTemplate.js';
import { fmtINR, classNames } from '../../../lib/format.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useAdminFlags } from '../../../context/AdminFlagsContext.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import LoadError from '../../../components/LoadError.jsx';
import Badge from '../../../components/ui/Badge.jsx';
import QualityScoreBadge from '../../../components/ui/QualityScoreBadge.jsx';
import InternalNote, { saveNoteIfAny } from '../../../components/ui/InternalNote.jsx';
import { listNotes } from '../../../services/noteService.js';
import { dealLabel, perSqftLabel, liveHref, fmtAgo, detailKvs, statusLabel } from './constants.js';
import {
  REVIEW_REASONS, ownerMessagePreview, reasonTemplateHints, signalLabel, signalsForChecklistItem,
} from './reviewReasons.js';
import WhatsappTemplates from './review-modal/WhatsappTemplates.jsx';
import CommunicationLog from './review-modal/CommunicationLog.jsx';
import OwnershipEvidencePanel from './review-modal/OwnershipEvidencePanel.jsx';
import BadgeRequestBanner from './review-modal/BadgeRequestBanner.jsx';
import { OWNERSHIP_REVIEW_ITEM, seeksOwnershipBadge } from '../../../lib/recheckFields.js';
import { SubmittedPhotos, SubmittedDescription, SubmittedLocation } from './review-modal/SubmittedContent.jsx';

// Verification routes require UUIDs; the display id may be a public slug.
const pid = (listing) => listing?.uuid || listing?.id;

// The server names the edited fields but keeps no before/after; the mock store's `reReview` carries both.
const editedFields = (listing) => (listing.recheckPending
  ? String(listing.recheckReason || '').split(/,\s*/).filter((f) => f && f !== OWNERSHIP_REVIEW_ITEM)
  : []);
const ownerEdited = (listing) => Boolean(listing.reReview) || editedFields(listing).length > 0;

const openingSection = (listing) => {
  if (ownerEdited(listing)) return 'changes';
  return seeksOwnershipBadge(listing) && listing.status === 'approved' ? 'badge' : 'overview';
};

export default function PropertyReviewModal({ review, setReview, onRefresh }) {
  const { toast } = useToast();
  const { optionEnabled } = useAdminFlags();
  const { user } = useAuth();
  const [thread, setThread] = useState(null);
  const [threadError, setThreadError] = useState(null);
  const [threadReload, setThreadReload] = useState(0);
  // Derive timeline labels at render because templates and ledger rows load independently.
  const [outreach, setOutreach] = useState([]);
  const [notes, setNotes] = useState([]);
  const [commsOpen, setCommsOpen] = useState(false);
  const [waTemplates, setWaTemplates] = useState([]);
  const [waOpen, setWaOpen] = useState(false);
  const [waPreview, setWaPreview] = useState(null);
  const [decisionMode, setDecisionMode] = useState(null);
  const [reasonCode, setReasonCode] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [secondApprovalNeeded, setSecondApprovalNeeded] = useState(false);
  const [msg, setMsg] = useState('');
  const [internalNote, setInternalNote] = useState('');
  // Decisions stay disabled while their server write is pending.
  const [busy, setBusy] = useState(false);
  // The live answer from the badge panel, which outruns the `review` snapshot after a grant or decline.
  const [badgeCase, setBadgeCase] = useState(null);
  const [section, setSection] = useState('overview');
  const [sectionFor, setSectionFor] = useState(null);
  const reviewKey = review ? pid(review) : null;
  if (sectionFor !== reviewKey) {
    setSectionFor(reviewKey);
    if (review) setSection(openingSection(review));
  }

  /* Read once per render rather than inside the effect, so it can be a dependency: flags resolve async, and
     one turning true after the modal opened left the timeline mounted empty with no second fetch. */
  const commsLogOn = optionEnabled('properties.commsLog');
  const qualityScoreOn = optionEnabled('properties.qualityScore');

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
        setThreadError(null);
        setThread(caseFile);
      } catch (err) {
        if (cancelled) return;
        toast(err?.message || 'Could not open the verification case file', 'error');
        setThread(null);
        setThreadError(err);
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
    setDecisionMode(null);
    setReasonCode('');
    setReasonNote('');
    setOverrideReason('');
    setSecondApprovalNeeded(false);
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
  }, [reviewKey, commsLogOn, threadReload]);

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

  useEffect(() => {
    if (!waOpen || waPreview || !reasonCode || !waTemplates.length) return;
    const hints = reasonTemplateHints(reasonCode);
    const exactId = `reason_${reasonCode}`;
    const match = waTemplates.find((tpl) => tpl.id === exactId) || waTemplates.find((tpl) => {
      const haystack = `${tpl.id} ${tpl.name} ${tpl.category}`.toLowerCase();
      return hints.some((hint) => haystack.includes(hint.toLowerCase()));
    });
    if (match) setWaPreview(match);
  }, [waOpen, waPreview, reasonCode, waTemplates]);

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

  const checklistComplete = Boolean(thread?.checklist?.length) && thread.checklist.every((line) => line.pass);

  const reloadCase = async () => {
    const caseFile = await startPropertyReview(pid(review));
    setThread(caseFile);
    await onRefresh?.();
    return caseFile;
  };

  const handleDecisionError = async (err, fallback) => {
    if (err?.code === 'stale_decision') {
      toast('Someone else already decided this — refreshed', 'error');
      try { await reloadCase(); } catch { onRefresh?.(); }
      return;
    }
    if (err?.code === 'second_approver_required' || err?.code === 'override_request_pending') {
      setSecondApprovalNeeded(true);
      try { await reloadCase(); } catch { onRefresh?.(); }
      toast(err?.code === 'override_request_pending'
        ? 'Second approval is already pending — refreshed'
        : 'This listing needs second approval before it can go live', 'error');
      return;
    }
    if (err?.code === 'override_request_decided' || err?.code === 'override_not_required') {
      try { await reloadCase(); } catch { onRefresh?.(); }
      toast(err?.code === 'override_request_decided'
        ? 'This second approval was already decided — refreshed'
        : 'Second approval is no longer required — refreshed', 'error');
      return;
    }
    toast(err?.message || fallback, 'error');
  };

  const reviewSend = async (clarificationRequested = false) => {
    const v = msg.trim();
    if (!v) return;
    try {
      const caseFile = await addPropertyReviewMessage(pid(review), v, clarificationRequested);
      setMsg('');
      setThread(caseFile);
      toast(clarificationRequested
        ? 'Needs info sent \u2014 returned to the owner'
        : 'Message sent to owner');
      if (clarificationRequested) {
        setReview((current) => current ? { ...current, status: 'needs_info' } : current);
        onRefresh();
      }
    } catch (err) {
      toast(err?.message || 'Could not send the message', 'error');
    }
  };

  // A decision atomically updates the case, listing status and owner message, so do not pair it with a
  // separate status write. The server refuses an approval while any checklist line is still open.
  const reviewApprove = async () => {
    if (busy) return;
    if (!checklistComplete) {
      toast('Tick every check before approving', 'error');
      return;
    }
    setBusy(true);
    try {
      await decidePropertyReview(pid(review), 'approve', { expectedStatus: review.status });
      const noted = await saveNoteIfAny('listing', review.id, internalNote, 'Approved');
      handleClose();
      toast(noted.error
        ? 'Approved & published \u2014 but the internal note could not be saved'
        : 'Approved & published \u2014 owner notified', noted.error ? 'error' : 'success');
      onRefresh();
    } catch (err) {
      await handleDecisionError(err, 'Could not approve this listing');
    } finally {
      setBusy(false);
    }
  };

  const submitDecision = async () => {
    if (busy) return;
    if (!decisionMode) return;
    if (!reasonCode) { toast('Choose a reason code', 'error'); return; }
    if (reasonCode === 'other' && !reasonNote.trim()) { toast('Add a note for Other', 'error'); return; }
    setBusy(true);
    try {
      await decidePropertyReview(pid(review), decisionMode, {
        reasonCode,
        note: reasonNote.trim() || undefined,
        expectedStatus: review.status,
      });
      const noted = await saveNoteIfAny('listing', review.id, internalNote,
        decisionMode === 'reject' ? 'Rejected' : 'Needs info');
      handleClose();
      const label = decisionMode === 'reject' ? 'Property not approved' : 'Needs info sent';
      toast(noted.error ? `${label} — but the internal note could not be saved` : `${label} — owner notified`,
        decisionMode === 'reject' || noted.error ? 'error' : 'success');
      onRefresh();
    } catch (err) {
      await handleDecisionError(err, `Could not ${decisionMode === 'reject' ? 'reject' : 'request info for'} this listing`);
    } finally {
      setBusy(false);
    }
  };

  const requestOverride = async () => {
    if (busy || !overrideReason.trim()) return;
    setBusy(true);
    try {
      setThread(await requestPropertyReviewOverride(pid(review), overrideReason.trim()));
      setOverrideReason('');
      toast(thread?.status === 'rejected' ? 'Reopen requested' : 'Second approval requested', 'success');
      onRefresh();
    } catch (err) {
      await handleDecisionError(err, thread?.status === 'rejected' ? 'Could not request reopen' : 'Could not request second approval');
    } finally {
      setBusy(false);
    }
  };

  const approveOverride = async () => {
    const requestId = thread?.overrideRequest?.id;
    if (busy || !requestId) return;
    setBusy(true);
    try {
      setThread(await approvePropertyReviewOverride(pid(review), requestId));
      toast(thread?.status === 'rejected' ? 'Reopen approved' : 'Second approval recorded', 'success');
      onRefresh();
    } catch (err) {
      await handleDecisionError(err, thread?.status === 'rejected' ? 'Could not approve reopen' : 'Could not approve as second reviewer');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => { setReview(null); setThread(null); setThreadError(null); };

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

  if (!review) return null;
  if (!thread) {
    return threadError ? (
      <Modal open onClose={handleClose} title="Verify property" size="lg">
        <LoadError
          message="Could not open the verification case file."
          error={threadError}
          onRetry={() => setThreadReload((n) => n + 1)}
          className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"
        />
      </Modal>
    ) : null;
  }
  const noPhotos = !review.image && !(Array.isArray(review.gallery) && review.gallery.filter(Boolean).length);
  const caseRejected = thread.status === 'rejected';
  const liveBadgeCase = badgeCase?.id === pid(review) ? badgeCase : null;
  const badgeRequestedAt = liveBadgeCase ? liveBadgeCase.requestedAt : review.ownershipRequestedAt;
  const seeksBadge = liveBadgeCase ? Boolean(liveBadgeCase.requestedAt && !liveBadgeCase.verified) : seeksOwnershipBadge(review);
  const trackBadgeCase = (verification) => setBadgeCase({ id: pid(review), requestedAt: verification.requestedAt, verified: verification.verified });
  const overrideCopy = caseRejected ? {
    requestHeading: 'Request reopen',
    requestPlaceholder: 'Why should this final reject be reopened?',
    pending: 'Awaiting second reviewer to reopen',
    approve: 'Approve reopen as second reviewer',
    label: 'Reopen requested:',
  } : {
    requestHeading: 'Request second approval',
    requestPlaceholder: 'Why should this hard signal be overridden?',
    pending: 'Awaiting second approver',
    approve: 'Approve as second reviewer',
    label: 'Second approval requested:',
  };

  const sections = [
    ['overview', 'Overview'],
    ['details', 'Details'],
    ownerEdited(review) ? ['changes', 'Changes'] : null,
    ['badge', 'Verified badge'],
    ['messages', thread.messages.length ? `Messages (${thread.messages.length})` : 'Messages'],
  ].filter(Boolean);
  const activeSection = sections.some(([key]) => key === section) ? section : 'overview';

  return (
    <Modal
      open
      onClose={handleClose}
      title="Verify property"
      size="xl"
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
        </>
      }
    >
      <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6 lg:space-y-0">
        <div className="min-w-0 space-y-4 lg:flex lg:max-h-[calc(100dvh-15rem)] lg:flex-col">
          <div data-testid="review-summary" className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-extrabold text-white">{review.title}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge status={review.status}>{statusLabel(review.status)}</Badge>
                <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-gray-300">{dealLabel(review.deal)}</span>
                {review.featured ? <span className="rounded-full border border-teal-400/30 bg-teal-500/15 px-2.5 py-0.5 text-xs text-teal-300">{'\u2605'} Featured</span> : null}
                {ownerEdited(review) ? <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/15 px-2.5 py-0.5 text-xs text-amber-300"><History className="h-3 w-3" /> Owner edited</span> : null}
                {review.priceReduced ? <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-300"><TrendingDown className="h-3 w-3" /> Price reduced</span> : null}
                {qualityScoreOn ? <QualityScoreBadge listing={review} /> : null}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-300">
                <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {review.locality} {'\u00B7'} {review.bhk || '\u2014'} {'\u00B7'} {review.type}</span>
                {review.owner ? (
                  <span className="inline-flex items-center gap-1">
                    <User className="h-3.5 w-3.5" /> {review.owner}
                    {review.ownerMobile ? <a href={`tel:${review.ownerMobile}`} className="ml-1 text-brand-teal hover:underline">{review.ownerMobile}</a> : null}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-extrabold text-teal-300">{fmtINR(review.price)}</div>
              <div className="mt-0.5 text-xs text-gray-400">{perSqftLabel(review)}</div>
            </div>
          </div>

          {seeksBadge ? <BadgeRequestBanner propertyId={pid(review)} requestedAt={badgeRequestedAt} onDeclined={() => { handleClose(); onRefresh(); }} /> : null}
          {noPhotos ? (
            <div className="flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-300" />
              <span>This listing has no photos — reject or request photos.</span>
            </div>
          ) : null}

          <div role="tablist" aria-label="Listing sections" className="flex gap-1 overflow-x-auto border-b border-white/10 no-scrollbar">
            {sections.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`review-tab-${key}`}
                aria-controls="review-panel"
                aria-selected={activeSection === key}
                data-testid={`review-section-${key}`}
                onClick={() => setSection(key)}
                className={classNames('relative -mb-px inline-flex min-h-[40px] flex-shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-semibold transition-colors', activeSection === key
                  ? 'border-brand-teal text-white'
                  : 'border-transparent text-gray-400 hover:text-gray-200')}
              >
                {label}
                {key === 'badge' && seeksBadge ? <><span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden="true" /><span className="sr-only">(owner requested)</span></> : null}
              </button>
            ))}
          </div>

          <div id="review-panel" role="tabpanel" aria-labelledby={`review-tab-${activeSection}`} className="space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
            {activeSection === 'overview' ? (
              <>
                <SubmittedPhotos listing={review} />
                <SubmittedDescription listing={review} />
              </>
            ) : null}

            {activeSection === 'details' ? (
              <>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10 sm:grid-cols-3">
                  {detailKvs(review).map(([k, v, full]) => (
                    <div key={k} className={classNames('bg-ink-2 p-3', full && 'col-span-2 sm:col-span-3')}>
                      <div className="text-[11px] text-gray-500">{k}</div>
                      <div className="mt-0.5 break-words text-sm font-semibold text-gray-100">{v === '' || v == null ? <span className="font-normal text-gray-500">{'\u2014'}</span> : v}</div>
                    </div>
                  ))}
                </div>
                <SubmittedLocation listing={review} />
              </>
            ) : null}

            {activeSection === 'changes' ? (
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
                  {review.reReview?.identityChanged ? ' The owner changed a core identity field (type/locality).' : ''}
                </p>
                {review.reReview ? null : (
                  <div className="flex flex-wrap gap-1.5" data-testid="changed-fields">
                    {editedFields(review).map((f) => (
                      <span key={f} className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-100">{f}</span>
                    ))}
                  </div>
                )}
                <div className="space-y-1.5">
                  {(review.reReview?.fields || []).map((f) => (
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
            ) : null}

            {/* Kept mounted so a half-filled evidence form survives a look at another section. */}
            <div hidden={activeSection !== 'badge'}>
              <OwnershipEvidencePanel propertyId={pid(review)} listing={review} onRefresh={onRefresh} onVerification={trackBadgeCase} />
            </div>

            {activeSection === 'messages' ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-xl border border-white/10 focus-within:border-brand-teal/60">
                  <div className="flex max-h-72 min-h-[96px] flex-col gap-2 overflow-y-auto bg-black/20 p-3">
                    {thread.messages.length ? (
                      thread.messages.map((m) => {
                        /* An internal message must not be laid out as part of a conversation the owner is party to:
                           read as an ordinary bubble, a moderator assumes the owner was told. */
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
                            <div className={classNames('max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm', me ? 'rounded-br-sm bg-teal-500/20 text-teal-50' : 'rounded-bl-sm bg-white/[0.07] text-gray-100')}>
                              {m.body}
                              <div className="mt-1 text-[11px] text-gray-400">{me ? 'You (Draazy)' : review.owner} {'\u00B7'} {fmtAgo(m.at)}</div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="m-auto text-center text-sm text-gray-500">No messages yet. Ask the owner anything before deciding.</p>
                    )}
                  </div>
                  <div className="border-t border-white/10 bg-white/[0.02] px-3 py-2.5">
                    <textarea
                      value={msg}
                      onChange={(e) => setMsg(e.target.value)}
                      onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') reviewSend(false); }}
                      rows={2}
                      aria-label="Message to the owner"
                      placeholder={'Share a note, or ask for a clarification to hand the listing back for correction\u2026'}
                      className="block w-full resize-none bg-transparent text-sm leading-relaxed text-white outline-none placeholder:text-gray-500"
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                      <span className="mr-auto hidden text-[11px] text-gray-500 sm:inline">Ctrl + Enter to send</span>
                      {/* The server refuses a hand-back once the listing is published, so the button only lives while it
                          still waits on us. A staff-posted listing is refused too, but its track is not in this read. */}
                      <button
                        type="button"
                        onClick={() => reviewSend(true)}
                        disabled={!(review.status === 'pending' || thread.status === 'in_review')}
                        title={review.status === 'pending' || thread.status === 'in_review'
                          ? 'Hands the listing back to the owner to correct'
                          : 'Only a listing still awaiting review can be handed back'}
                        className="dz-btn dz-btn-ghost dz-btn-sm"
                      >
                        <HelpCircle className="h-3.5 w-3.5" /> Ask for clarification
                      </button>
                      <button type="button" onClick={() => reviewSend(false)} className="dz-btn dz-btn-primary dz-btn-sm">
                        <Send className="h-3.5 w-3.5" /> Send
                      </button>
                    </div>
                  </div>
                </div>

                {review.ownerMobile || commsLogOn ? (
                  <div className="divide-y divide-white/10 rounded-xl border border-white/10">
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
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <aside aria-label="Decision" className="space-y-4 lg:max-h-[calc(100dvh-15rem)] lg:overflow-y-auto lg:pr-1">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-200">
              <FileCheck2 className="h-4 w-4 text-brand-teal" /> <span id="review-checklist-title">Verification checklist</span>
              <span className="ml-auto text-xs font-semibold text-gray-400">
                {thread.checklist.filter((c) => c.pass).length} / {thread.checklist.length} checked
              </span>
            </div>
            <div className="space-y-2" role="group" aria-labelledby="review-checklist-title">
              {thread.checklist.map((c) => (
                <label key={c.item} className={classNames('flex min-h-[44px] cursor-pointer flex-wrap items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors', c.pass
                  ? 'border-emerald-400/30 bg-emerald-500/10'
                  : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]')}>
                  <input
                    type="checkbox"
                    checked={c.pass}
                    onChange={(e) => setChecklistItem(c.item, e.target.checked)}
                    className="h-5 w-5 flex-shrink-0 cursor-pointer accent-emerald-500"
                  />
                  <span className={classNames('text-sm font-semibold', c.pass ? 'text-emerald-100' : 'text-gray-100')}>{c.item}</span>
                  {signalsForChecklistItem(thread.signals || review.signals, c.item).map((item) => (
                    <span key={`${c.item}:${item.code}`} className={classNames('rounded-full border px-2 py-0.5 text-[11px] font-semibold', item.severity === 'hard'
                      ? 'border-rose-400/40 bg-rose-500/15 text-rose-200'
                      : 'border-white/10 bg-white/5 text-gray-300')} title={item.detail || signalLabel(item.code)}>
                      {signalLabel(item.code)}
                    </span>
                  ))}
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-200">
              <CheckCircle className="h-4 w-4 text-brand-teal" /> Decision
            </div>
            {caseRejected ? (
              <p className="text-sm text-gray-300">This listing was not approved. Reopening it needs a second reviewer.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button onClick={reviewApprove} disabled={busy || !checklistComplete} title={checklistComplete ? 'Approve this listing' : 'Tick every check'} className="dz-btn dz-btn-success min-h-[44px] disabled:opacity-50">
                  <CheckCircle className="h-4 w-4" /> Approve
                </button>
                <button onClick={() => { setDecisionMode('needs_info'); setReasonCode(''); setReasonNote(''); }} disabled={busy} className="dz-btn dz-btn-ghost min-h-[44px]">
                  <HelpCircle className="h-4 w-4" /> Needs info
                </button>
                <button onClick={() => { setDecisionMode('reject'); setReasonCode(''); setReasonNote(''); }} disabled={busy} className="dz-btn dz-btn-danger min-h-[44px]">
                  <XCircle className="h-4 w-4" /> Reject
                </button>
                {!checklistComplete ? <span className="self-center text-xs font-semibold text-amber-300">Tick every check</span> : null}
              </div>
            )}
            {decisionMode && !caseRejected ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-ink/60 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-gray-400">Reason</span>
                  {decisionMode === 'reject' ? <span className="text-xs font-semibold text-rose-300">Final — the owner can't resubmit</span> : null}
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Reason">
                  {REVIEW_REASONS.map((reason) => (
                    <button key={reason.code} type="button" aria-pressed={reasonCode === reason.code} onClick={() => setReasonCode(reason.code)}
                      className={classNames('rounded-full border px-3 py-1.5 text-xs font-semibold transition', reasonCode === reason.code
                        ? 'border-brand-teal bg-brand-teal text-ink'
                        : 'border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/20')}>
                      {reason.label}
                    </button>
                  ))}
                </div>
                <label className="mt-3 block text-sm">
                  <span className="mb-1 block text-gray-300">Note {reasonCode === 'other' ? <span className="text-rose-300">*</span> : <span className="text-gray-500">(optional)</span>}</span>
                  <textarea value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} rows={2} className="dz-input resize-none" placeholder="One clear fix for the owner…" />
                </label>
                {reasonCode ? (
                  <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-500">Owner message preview</div>
                    <div className="whitespace-pre-wrap text-sm text-gray-300">{ownerMessagePreview(decisionMode, reasonCode, reasonNote)}</div>
                  </div>
                ) : null}
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={() => setDecisionMode(null)} className="dz-btn dz-btn-ghost">Cancel</button>
                  <button type="button" onClick={submitDecision} disabled={busy || !reasonCode || (reasonCode === 'other' && !reasonNote.trim())} className={classNames('dz-btn', decisionMode === 'reject' ? 'dz-btn-danger' : 'dz-btn-primary')}>
                    {decisionMode === 'reject' ? 'Reject final' : 'Send needs info'}
                  </button>
                </div>
              </div>
            ) : null}
            {(caseRejected || secondApprovalNeeded || thread.overrideRequest) ? (
              <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                {thread.overrideRequest?.requestedBy && String(thread.overrideRequest.requestedBy) === String(user?.id) ? (
                  <p className="font-semibold">{overrideCopy.pending}</p>
                ) : thread.overrideRequest ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{overrideCopy.label}</span>
                    <span>{thread.overrideRequest.reason}</span>
                    <button type="button" onClick={approveOverride} disabled={busy} className="dz-btn dz-btn-primary dz-btn-sm">{overrideCopy.approve}</button>
                  </div>
                ) : (
                  <>
                    <label className="block">
                      <span className="mb-1 block font-semibold">{overrideCopy.requestHeading}</span>
                      <textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={2} className="dz-input resize-none" placeholder={overrideCopy.requestPlaceholder} />
                    </label>
                    <button type="button" onClick={requestOverride} disabled={busy || !overrideReason.trim()} className="dz-btn dz-btn-primary mt-2">{overrideCopy.requestHeading}</button>
                  </>
                )}
              </div>
            ) : null}
          </div>

          <InternalNote entityType="listing" entityId={review.id} value={internalNote} onChange={setInternalNote} showHistory />
        </aside>
      </div>
    </Modal>
  );
}
