import { useEffect, useState } from 'react';
import { useGroupApplications } from '../../../lib/groupApplications.js';
import { listEnquiries, listProperties, listVisits, updateVisit } from '../../../lib/mockApi.js';
import { getContactReqs, setContactStatus } from '../../../lib/contact.js';
import { getPhotoReqs } from '../../../lib/photoRequests.js';
import { getFlatmateRequests, decideFlatmateRequest } from '../../../lib/data/flatmates.js';
import {
  ensureOwnerReview, addPropReviewReply, markPropReviewRead,
  getRecentProps, getSavedSearches,
} from '../../../lib/store.js';
import {
  getDocRequests, respondDocRequest, countSharedDocs, notifyBuyerDocsGranted,
} from '../../../lib/data/documents.js';
import { loadMyListings } from '../../../lib/data/myListings.js';
import { countMatches, searchHref } from '../listings/alertCriteria.js';

/* Data layer for the consumer Dashboard: owns all remote/persisted state, the
   load + per-user request effects, and the mutation handlers. Extracted verbatim
   from the Dashboard container so the container is a thin orchestrator; behaviour
   (state shape, effect timing, optimistic updates, toasts) is unchanged. */
export function useDashboardData({ user, toast }) {
  const [listings, setListings] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [visits, setVisits] = useState([]);
  const [recent, setRecent] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [alertMatches, setAlertMatches] = useState([]);
  const [contactReqs, setContactReqs] = useState([]);
  const [photoReqs, setPhotoReqs] = useState([]);
  const [flatmateReqs, setFlatmateReqs] = useState([]);
  const [docReqs, setDocReqs] = useState([]);
  const [reviewProp, setReviewProp] = useState(null);
  const [reviewInput, setReviewInput] = useState('');
  const [reviewTick, setReviewTick] = useState(0);
  const { apps, setStatus } = useGroupApplications();

  useEffect(() => {
    if (user?.mobile) {
      setContactReqs(getContactReqs(user.mobile));
      setPhotoReqs(getPhotoReqs(user.mobile));
      setFlatmateReqs(getFlatmateRequests(user.mobile));
      setDocReqs(getDocRequests(user.mobile));
    }
  }, [user]);

  const decideContact = (reqId, decision) => {
    setContactStatus(user.mobile, reqId, decision);
    setContactReqs(getContactReqs(user.mobile));
    toast(decision === 'approved' ? 'Your number is now shared with this buyer.' : 'Request declined — your number stays private.', decision === 'approved' ? 'success' : 'info');
  };

  // Buyer document requests are stored one record per document; the Requests panel
  // groups them per buyer, so Grant/Decline "all" arrives here as a list of ids to
  // resolve together, then we re-read the shared state so every surface stays in sync.
  const decideDocReqs = (reqIds, decision) => {
    (reqIds || []).forEach((id) => respondDocRequest(user.mobile, id, decision));
    setDocReqs(getDocRequests(user.mobile));
    if (decision === 'granted') {
      const shared = countSharedDocs(user.mobile, reqIds);
      if (shared > 0) {
        notifyBuyerDocsGranted(user.mobile, reqIds);
        toast(`Access granted — ${shared} document${shared === 1 ? '' : 's'} now visible to this buyer.`, 'success');
      } else {
        // Owner approved a category they haven't actually uploaded a file for yet.
        toast('Access approved, but you haven’t uploaded these documents yet. Upload them in the Document Vault so the buyer can view them.', 'info');
      }
    } else {
      toast('Request declined — your documents stay private.', 'info');
    }
  };

  const decideFlatmateReq = (reqId, decision) => {
    decideFlatmateRequest(user.mobile, reqId, decision);
    setFlatmateReqs(getFlatmateRequests(user.mobile));
    toast(decision === 'accepted' ? 'Request accepted — connect in Messages.' : 'Request declined.', decision === 'accepted' ? 'success' : 'info');
  };

  // Visit actions (confirm / cancel / mark-visited / reschedule) update the shared
  // `visits` state optimistically so the Scheduled Visits calendar, the leads badge,
  // and the Action Center all move together — then persist to the visits collection.
  const mutateVisit = (id, patch) => {
    setVisits((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
    updateVisit(id, patch);
  };

  const openReview = (propId) => {
    markPropReviewRead(propId);
    setReviewProp(propId);
    setReviewInput('');
    setReviewTick((t) => t + 1);
  };
  const sendReview = () => {
    if (!reviewInput.trim()) return;
    addPropReviewReply(reviewProp, reviewInput);
    setReviewInput('');
    setReviewTick((t) => t + 1);
  };

  useEffect(() => {
    let alive = true;
    Promise.all([
      loadMyListings(user),
      listProperties({ includeAllStatuses: true }, 'newest'),
      listEnquiries(),
      listVisits(),
    ]).then(([shownListings, props, enq, vis]) => {
      if (!alive) return;
      // Combined owner view: property listings + flatmate/room posts (rooms-aware).
      setListings(shownListings);
      shownListings.forEach((l) => { if (!l.flatmate) ensureOwnerReview({ id: l.id, title: l.title, loc: l.locality, price: l.price, deal: l.deal }); });
      setReviewTick((t) => t + 1);
      setEnquiries(enq.slice(0, 8));
      // Enrich each visit with the listing's owner mobile so the WhatsApp handoff
      // in the Visits tab can reach the owner (seeker view) — the visit record only
      // carries the visitor's number. Falls back gracefully when unknown.
      const ownerByListing = new Map(props.map((p) => [p.id, p.ownerMobile]));
      setVisits(vis.slice(0, 8).map((v) => ({ ...v, ownerMobile: v.ownerMobile || ownerByListing.get(v.listingId) || '' })));
      // Recently Viewed = the user's REAL view history (per-user MRU), resolved
      // against the live catalog. `recommended` is a neutral discovery fallback
      // used only when the user hasn't viewed anything yet — never mislabeled as
      // "recently viewed".
      const approved = props.filter((p) => p.status === 'approved');
      const byId = new Map(approved.map((p) => [p.id, p]));
      const realRecent = getRecentProps().map((id) => byId.get(id)).filter(Boolean).slice(0, 6);
      setRecent(realRecent);
      setRecommended(approved.slice(0, 6));
      // Retention loop: for each active saved search, count how many LIVE approved
      // listings match its criteria right now. Only surface searches with real
      // matches; each links to the actual filtered results. Nothing is fabricated.
      const matches = getSavedSearches()
        .filter((s) => s.alerts !== false)
        .map((s) => ({ id: s.id, label: s.label || 'your saved search', count: countMatches(s, approved), href: searchHref(s) }))
        .filter((m) => m.count > 0)
        .slice(0, 3);
      setAlertMatches(matches);
    });
    return () => {
      alive = false;
    };
  }, []);

  return {
    listings, enquiries, visits, recent, recommended, alertMatches,
    contactReqs, photoReqs, flatmateReqs, docReqs,
    reviewProp, setReviewProp, reviewInput, setReviewInput, reviewTick,
    apps, setStatus,
    decideContact, decideDocReqs, decideFlatmateReq, mutateVisit, openReview, sendReview,
  };
}
