import { useEffect, useState } from 'react';
import useAsyncList from '../../../hooks/useAsyncList.js';
import { useGroupApplications } from '../../../lib/groupApplications.js';
import { listEnquiries } from '../../../lib/mockApi.js';
import { listProperties } from '../../../services/propertyService.js';
import { listVisits, myVisitRequests, rescheduleVisit, updateVisitStatus } from '../../../services/visitService.js';
import { myContactRequests, respondToContactRequest } from '../../../services/contactService.js';
import { listDocRequests, respondDocRequest } from '../../../services/documentService.js';
import { isHttpDomain } from '../../../services/config.js';
import { getPhotoReqs } from '../../../lib/photoRequests.js';
import { getFlatmateRequests, decideFlatmateRequest } from '../../../lib/data/flatmates.js';
import {
  ensureOwnerReview, addPropReviewReply, markPropReviewRead,
  getRecentProps,
} from '../../../lib/store.js';
import {
  countSharedDocs, notifyBuyerDocsGranted,
} from '../../../lib/data/documents.js';
import { loadMyListings } from '../../../lib/data/myListings.js';
import { countMatches, searchHref } from '../listings/alertCriteria.js';
import { useSavedSearches } from '../../../context/SavedSearchContext.jsx';

/**
 * A contact request, in the row vocabulary the Enquiries panel uses.
 *
 * The panel folds four unrelated sources — contact, photo, flatmate and document requests — into
 * one prioritised inbox, and they share a row shape (`buyerName`, `requestedAt`, `propId`) that is
 * the panel's own, not any one source's. The other three are still localStorage and already speak
 * it, so contact requests are translated here at the data boundary rather than teaching the panel
 * a fifth dialect.
 *
 * `buyerMobile` falls back to the *masked* requester number, so the mobile carried on an
 * unapproved row is one that is safe to render even if a future caller forgets the status check
 * that currently guards it.
 */
const toLeadRow = (r) => ({
  id: r.id,
  propId: r.propertyId || '',
  buyerName: r.requester?.name || 'A buyer',
  buyerMobile: r.contact?.mobile || r.requester?.mobile || '',
  status: r.status,
  requestedAt: r.createdAt ? Date.parse(r.createdAt) : 0,
});

/* Data layer for the consumer Dashboard: owns all remote/persisted state, the
   load + per-user request effects, and the mutation handlers. Extracted verbatim
   from the Dashboard container so the container is a thin orchestrator; behaviour
   (state shape, effect timing, optimistic updates, toasts) is unchanged. */
export function useDashboardData({ user, toast }) {
  const { searches } = useSavedSearches();
  const [listings, setListings] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [visits, setVisits] = useState([]);
  const [recent, setRecent] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [alertMatches, setAlertMatches] = useState([]);
  const [photoReqs, setPhotoReqs] = useState([]);
  const [flatmateReqs, setFlatmateReqs] = useState([]);
  const [reviewProp, setReviewProp] = useState(null);
  const [reviewInput, setReviewInput] = useState('');
  const [reviewTick, setReviewTick] = useState(0);
  const { apps, setStatus } = useGroupApplications();

  useEffect(() => {
    if (user?.mobile) {
      setPhotoReqs(getPhotoReqs(user.mobile));
      setFlatmateReqs(getFlatmateRequests(user.mobile));
    }
  }, [user]);

  // The document request inbox is a seam read (mock or live, per `document` domain), owner-scoped by
  // the session, so like the contact inbox below it takes its own effect rather than the synchronous
  // localStorage read the panels above use. Reading it here through the same service `DocumentsTab`
  // uses is what keeps the Documents tab, this sidebar badge and the Action Center on one source of
  // truth — before this, the tab read the seam while the badge read localStorage, so in http mode a
  // real request showed in one place and not the other, and a grant issued here never reached the
  // server.
  //
  // It used to `.catch` to an empty inbox, which told an owner nobody had asked for their documents
  // when in fact we had failed to look (D166). `useAsyncList` keeps the failure separable from the
  // genuinely-empty case; `enabled` covers the signed-out state, which really is empty.
  const [docReqs, docReqsStatus, setDocReqs, retryDocReqs, docReqsError] = useAsyncList(
    () => listDocRequests(user.mobile),
    [user],
    !!user?.mobile,
  );

  // The contact inbox is a network read and is owner-scoped by the session, so unlike the
  // localStorage panels above it takes no mobile argument. Same reasoning as the document inbox:
  // "no one has asked for your number" is a claim we cannot make from a failed request.
  const [contactReqs, contactReqsStatus, setContactReqs, retryContactReqs, contactReqsError] = useAsyncList(
    () => myContactRequests().then((res) => res.items.map(toLeadRow)),
    [user],
    !!user?.mobile,
  );

  const decideContact = async (reqId, decision) => {
    await respondToContactRequest(reqId, decision);
    const res = await myContactRequests();
    setContactReqs(res.items.map(toLeadRow));
    toast(decision === 'approved' ? 'Your number is now shared with this buyer.' : 'Request declined — your number stays private.', decision === 'approved' ? 'success' : 'info');
  };

  // Buyer document requests are stored one record per document; the Requests panel
  // groups them per buyer, so Grant/Decline "all" arrives here as a list of ids to
  // resolve together. Each id is responded through the seam (so the grant reaches the
  // server in http mode), then we re-read the inbox through the same service so every
  // surface stays in sync.
  const decideDocReqs = async (reqIds, decision) => {
    const ids = reqIds || [];
    // Re-read the inbox through the seam so every surface reflects the server's truth. Shared so the
    // failure path can refresh too: a partial-loop failure may have already resolved some ids, and
    // leaving those rendering as pending would misreport the state the user is told to retry from.
    const refresh = async () => {
      try {
        setDocReqs((await listDocRequests(user.mobile)) || []);
      } catch {
        // The mutation went through; leave the list as-is if the re-read fails rather than blanking it.
      }
    };
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop -- a handful of ids per buyer; sequential keeps the store consistent
        await respondDocRequest(user.mobile, id, decision);
      }
    } catch {
      await refresh();
      toast('Could not update every request. Some may have gone through — please review and retry.', 'error');
      return;
    }
    await refresh();
    if (decision !== 'granted') {
      toast('Request declined — your documents stay private.', 'info');
      return;
    }
    // Shared-doc accounting is a mock-only affordance (a localStorage share ledger). In http mode the
    // server mints the share and notifies the buyer on grant, so there is nothing to count here.
    if (isHttpDomain('document')) {
      toast('Access granted — the buyer can now view these documents.', 'success');
      return;
    }
    const shared = countSharedDocs(user.mobile, ids);
    if (shared > 0) {
      notifyBuyerDocsGranted(user.mobile, ids);
      toast(`Access granted — ${shared} document${shared === 1 ? '' : 's'} now visible to this buyer.`, 'success');
    } else {
      // Owner approved a category they haven't actually uploaded a file for yet.
      toast('Access approved, but you haven’t uploaded these documents yet. Upload them in the Document Vault so the buyer can view them.', 'info');
    }
  };

  const decideFlatmateReq = (reqId, decision) => {
    decideFlatmateRequest(user.mobile, reqId, decision);
    setFlatmateReqs(getFlatmateRequests(user.mobile));
    toast(decision === 'accepted' ? 'Request accepted — connect in Messages.' : 'Request declined.', decision === 'accepted' ? 'success' : 'info');
  };

  // Visit actions (confirm / cancel / mark-visited / reschedule) update the shared
  // `visits` state optimistically so the Scheduled Visits calendar, the leads badge,
  // and the Action Center all move together — then persist through the seam.
  //
  // A status change and a slot change are different operations on the server (one has an endpoint,
  // the other does not — D87), so the single `patch` the dashboard passes is routed by shape
  // rather than collapsed into one call.
  const mutateVisit = (id, patch) => {
    const snapshot = visits;
    setVisits((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
    const write = patch.when !== undefined
      ? rescheduleVisit(id, patch.when)
      : updateVisitStatus(id, patch.status);
    // Roll back on failure: a confirmed visit that silently reverts on the next load is worse
    // than one that visibly refuses.
    write.catch(() => {
      setVisits(snapshot);
      toast('Could not update that visit. Please try again.', 'error');
    });
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

  /* The dashboard's core read: everything the tabs, the stats row and the owner/tenant decision are
     derived from. It had no `.catch` at all, so a failure was an unhandled rejection and the page
     simply stayed as it was born — no listings, no visits, no enquiries. That is worse than an
     empty state, because `isOwner` is computed from `listings`: a landlord whose read failed was
     shown the *tenant* dashboard, with a rent wallet where their property ledger should be. The
     load now has a status the page can render and a retry (D166).

     Kept on `[searches]` rather than `[user]` \u2014 the saved-search context reloads per session, so
     this still re-runs on sign-in, and widening the deps here would change refetch behaviour that
     is not what D166 is about. */
  const [bundle, dataStatus, , retryData, dataError] = useAsyncList(
    () => Promise.all([
      loadMyListings(user),
      listProperties({ includeAllStatuses: true }, 'newest'),
      listEnquiries(),
      // Both sides of the visit relationship. The dashboard serves one person who may be both a
      // seeker and an owner, and the two server endpoints are deliberately separate — the previous
      // single read was the *unscoped* global collection, which on real data would have shown this
      // user strangers' visits.
      listVisits(),
      myVisitRequests(),
    ]),
    [searches],
  );

  /* Derivation, split from the fetch so the loader stays a pure read and every `set*` below runs
     off one settled result. Guarded on the tuple's length because `useAsyncList` starts (and
     re-starts) from `[]`, and a partially-destructured bundle would blank the page mid-retry. */
  useEffect(() => {
    if (bundle.length < 5) return;
    const [shownListings, props, enq, mine, onMine] = bundle;
    // Combined owner view: property listings + flatmate/room posts (rooms-aware).
    setListings(shownListings);
    shownListings.forEach((l) => { if (!l.flatmate) ensureOwnerReview({ id: l.id, title: l.title, loc: l.locality, price: l.price, deal: l.deal }); });
    setReviewTick((t) => t + 1);
    setEnquiries(enq.slice(0, 8));
    // Enrich each visit from the catalogue we already hold: the owner mobile for the Visits tab's
    // WhatsApp handoff (the visit record only carries the visitor's number), and the listing
    // title, which the wire does not carry — resolving it in the provider would be one property
    // fetch per visit.
    const byId = new Map(props.map((p) => [p.id, p]));
    // Deduped by id: a user visiting their own listing legitimately appears in both reads.
    const merged = [...new Map([...mine, ...onMine].map((v) => [v.id, v])).values()]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    setVisits(merged.slice(0, 8).map((v) => {
      const p = byId.get(v.listingId);
      return {
        ...v,
        listing: v.listing || p?.title || '',
        ownerMobile: v.ownerMobile || p?.ownerMobile || '',
      };
    }));
    // Recently Viewed = the user's REAL view history (per-user MRU), resolved
    // against the live catalog. `recommended` is a neutral discovery fallback
    // used only when the user hasn't viewed anything yet — never mislabeled as
    // "recently viewed".
    const approved = props.filter((p) => p.status === 'approved');
    const approvedById = new Map(approved.map((p) => [p.id, p]));
    const realRecent = getRecentProps().map((id) => approvedById.get(id)).filter(Boolean).slice(0, 6);
    setRecent(realRecent);
    setRecommended(approved.slice(0, 6));
    // Retention loop: for each active saved search, count how many LIVE approved
    // listings match its criteria right now. Only surface searches with real
    // matches; each links to the actual filtered results. Nothing is fabricated.
    const matches = searches
      .filter((s) => s.alerts !== false)
      .map((s) => ({ id: s.id, label: s.label || 'your saved search', count: countMatches(s, approved), href: searchHref(s) }))
      .filter((m) => m.count > 0)
      .slice(0, 3);
    setAlertMatches(matches);
    // Saved searches arrive asynchronously now, so the match counts have to be recomputed once the
    // list lands — on the first pass it is empty and the retention strip would never appear.
  }, [bundle, searches]);

  return {
    listings, enquiries, visits, recent, recommended, alertMatches,
    contactReqs, photoReqs, flatmateReqs, docReqs,
    reviewProp, setReviewProp, reviewInput, setReviewInput, reviewTick,
    apps, setStatus,
    decideContact, decideDocReqs, decideFlatmateReq, mutateVisit, openReview, sendReview,
    // Load state, so the page can say "we couldn't load this" instead of rendering a plausible
    // dashboard for a user whose data never arrived.
    dataStatus, dataError, retryData,
    docReqsStatus, docReqsError, retryDocReqs,
    contactReqsStatus, contactReqsError, retryContactReqs,
  };
}
