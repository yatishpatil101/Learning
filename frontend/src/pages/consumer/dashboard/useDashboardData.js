import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useAsyncList from '../../../hooks/useAsyncList.js';
import { MAX_PAGE_SIZE } from '../../../services/apiLimits.js';
import { listPropertiesByIds, searchListings } from '../../../services/propertyService.js';
import { listVisits, myVisitRequests, rescheduleVisit, updateVisitStatus } from '../../../services/visitService.js';
import { myContactRequests, respondToContactRequest } from '../../../services/contactService.js';
import { listDocRequests, respondDocRequest } from '../../../services/documentService.js';
import { decideGroupApplication, listMyGroupApplications, myRequests, decideRequest } from '../../../services/flatmateService.js';
import { myPhotoRequests, decidePhotoRequest } from '../../../services/photoRequestService.js';
import {
  listMyPropertyReviews, getPropertyReview, markPropertyReviewRead, addPropertyReviewMessage,
} from '../../../services/propertyReviewService.js';
import { getRecentProps } from '../../../lib/localPrefs.js';
import { loadMyListings } from '../../../lib/data/myListings.js';
import { searchHref } from '../listings/alertCriteria.js';
import { useSavedSearches } from '../../../context/SavedSearchContext.jsx';
/* A contact request, in the row vocabulary the Enquiries panel uses. */

const toLeadRow = (r) => ({
  id: r.id,
  propId: r.propertySlug || r.propertyId || '',
  buyerName: r.requester?.name || 'A buyer',
  buyerMobile: r.contact?.mobile || r.requester?.mobile || '',
  verified: !!r.requester?.verified,
  status: r.status,
  requestedAt: r.createdAt ? Date.parse(r.createdAt) : 0,
});
/* A photo request, in the same row vocabulary. */

const toPhotoRow = (r) => ({
  id: r.id,
  propId: r.propertySlug || r.propertyId || '',
  propLabel: r.propertyTitle || '',
  buyerName: r.requester?.name || 'A buyer',
  buyerMobile: r.requester?.mobile || '',
  status: r.status || 'pending',
  requestedAt: r.createdAt ? Date.parse(r.createdAt) : 0,
});

// Deduped by id: a user visiting their own listing legitimately appears in both reads.
const mergeVisits = (mine, onMine) => [...new Map([...mine, ...onMine.map((v) => ({ ...v, hostedByMe: true }))].map((v) => [v.id, v])).values()]
  .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  .map((v) => ({ ...v, listing: v.listing || '', ownerMobile: v.ownerMobile || '' }));

// Six cards for the overview feed — recently viewed if any still resolve, else (seekers only) the newest homes.
async function loadFeed(withRecommended) {
  try {
    const recent = await listPropertiesByIds(getRecentProps().slice(0, 6));
    if (recent.length || !withRecommended) return { recent, recommended: [] };
    const { items } = await searchListings({ sort: 'createdAt,desc' }, { size: 6 });
    return { recent: [], recommended: items };
  } catch {
    return { recent: [], recommended: [] };
  }
}
/* Data layer for the consumer Dashboard: owns all remote/persisted state, the load + per-user request effects, and
   the mutation handlers. `ownsProperty` is undefined until /me/dashboard answers, null when unknown. */

export function useDashboardData({ user, toast, ownsProperty }) {
  const [listings, setListings] = useState([]);
  // Every owner inbox is scoped to the caller's property listings, so a known non-owner skips them and their
  // refreshes until one appears (e.g. published in another tab).
  const ownerReads = !!user?.mobile && (ownsProperty !== false || listings.some((l) => !l.flatmate));
  const { searches } = useSavedSearches();
  const [visits, setVisits] = useState([]);
  const [recent, setRecent] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [alertMatches, setAlertMatches] = useState([]);
  const [reviewProp, setReviewProp] = useState(null);
  const [reviewInput, setReviewInput] = useState('');
  const [reviewRows, setReviewRows] = useState([]);
  const [reviewThread, setReviewThread] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const busyRef = useRef(new Set());
  const isBusy = useCallback((id) => busyRef.current.has(id), []);
  const setBusy = useCallback((ids, value) => {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!list.length) return;
    const next = new Set(busyRef.current);
    list.forEach((id) => {
      if (value) next.add(id);
      else next.delete(id);
    });
    busyRef.current = next;
    setBusyIds(next);
  }, []);
  const runBusy = useCallback(async (ids, fn) => {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (list.some((id) => busyRef.current.has(id))) return false;
    setBusy(list, true);
    try {
      const ok = await fn();
      return ok !== false;
    } finally {
      setBusy(list, false);
    }
  }, [setBusy]);

  const [flatmateReqs, flatmateReqsStatus, setFlatmateReqs, retryFlatmateReqs, flatmateReqsError, refreshFlatmateReqs] = useAsyncList(
    () => myRequests(),
    [user],
    !!user?.mobile,
  );

  // The document request inbox is a seam read, owner-scoped by the session, so like the contact inbox below it takes
  // its own effect rather than the synchronous localStorage read the panels above use.
  const [docReqs, docReqsStatus, setDocReqs, retryDocReqs, docReqsError, refreshDocReqs] = useAsyncList(
    () => listDocRequests(user.mobile),
    [user],
    ownerReads,
  );

  // The contact inbox is a network read and is owner-scoped by the session, so unlike the localStorage panels above
  // it takes no mobile argument. Same reasoning as the document inbox.
  const [contactReqs, contactReqsStatus, setContactReqs, retryContactReqs, contactReqsError, refreshContactReqs] = useAsyncList(
    () => myContactRequests().then((res) => res.items.map(toLeadRow)),
    [user],
    ownerReads,
  );

  // Flatmate group applications on the caller's own listings. Owner-scoped by the session, like the contact inbox,
  // and read through the same seam the ops moderation board uses.
  const [apps, appsStatus, setApps, retryApps, appsError, refreshApps] = useAsyncList(
    () => listMyGroupApplications({ size: MAX_PAGE_SIZE }).then((res) => res.items),
    [user],
    ownerReads,
  );
  // Accept/decline is irreversible and the server refuses a second answer, so the row is re-read rather than patched
  // in place.

  const decideApp = async (appId, status) => {
    return runBusy(`app:${appId}`, async () => {
      try {
        const decided = await decideGroupApplication(appId, status);
        setApps((rows) => rows.map((a) => (a.id === appId ? decided : a)));
        toast(status === 'accepted'
          ? 'Group application accepted'
          : 'Group application declined', status === 'accepted' ? 'success' : 'info');
      } catch (e) {
        toast(e?.message || 'That did not go through. Please try again.', 'error');
        await refreshApps();
        return false;
      }
      return true;
    });
  };

  const decideContact = async (reqId, decision) => {
    return runBusy(`contact:${reqId}`, async () => {
      const answered = contactReqs.find((r) => r.id === reqId);
      try {
        await respondToContactRequest(reqId, decision);
      } catch (e) {
        toast(e?.message || 'That did not go through. Please try again.', 'error');
        await refreshContactReqs();
        return false;
      }
      if (String(answered?.status || '').toLowerCase() === 'pending') {
        // The My Listings lead chip reads the count off the row, so it moves with the answer.
        setListings((rows) => rows.map((l) => (!l.flatmate && [l.id, l.uuid].map(String).includes(String(answered.propId))
          ? { ...l, pendingLeads: Math.max(0, (l.pendingLeads || 0) - 1) } : l)));
      }
      toast(decision === 'approved' ? 'Accepted — you can chat now and see their number.' : 'Request declined.', decision === 'approved' ? 'success' : 'info');
      try {
        const res = await myContactRequests();
        setContactReqs(res.items.map(toLeadRow));
      } catch {
        await refreshContactReqs();
      }
      return true;
    });
  };

  const [photoReqs, photoReqsStatus, setPhotoReqs, retryPhotoReqs, photoReqsError, refreshPhotoReqs] = useAsyncList(
    () => myPhotoRequests().then((res) => res.items.map(toPhotoRow)),
    [user],
    ownerReads,
  );
  /* Answer a photo request, either way. */
  /* The owner's half of the maker-checker pair: the buyer makes the request, the owner marks it satisfied. */

  const decidePhotoReq = async (reqId, decision) => {
    return runBusy(`photo:${reqId}`, async () => {
      try {
        await decidePhotoRequest(reqId, decision);
      } catch (e) {
        toast(e?.message || 'That did not go through. Please try again.', 'error');
        await refreshPhotoReqs();
        return false;
      }
      toast(
        decision === 'resolved'
          ? 'Marked done — the buyer has been told your new photos are up.'
          : "Declined — the buyer has been told there are no more photos coming.",
        decision === 'resolved' ? 'success' : 'info',
      );
      try {
        const res = await myPhotoRequests();
        setPhotoReqs(res.items.map(toPhotoRow));
      } catch {
        await refreshPhotoReqs();
      }
      return true;
    });
  };
  // Buyer document requests are stored one record per document; the Requests panel groups them per buyer, so
  // Grant/Decline "all" arrives here as a list of ids to resolve together.

  const decideDocReqs = async (reqIds, decision) => {
    const ids = reqIds || [];
    // Re-read the inbox through the seam so every surface reflects the server's truth. Shared so the failure path can
    // refresh too: a partial-loop failure may have already resolved some ids.
    const busyKeys = ids.map((id) => `doc:${id}`);
    return runBusy(busyKeys, async () => {
    const refresh = async () => {
      try {
        setDocReqs((await listDocRequests(user.mobile)) || []);
        // The mutation went through; leave the list as-is if the re-read fails rather than blanking it.
      } catch {
      }
    };
    let serverSharedCount = 0;
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop -- a few ids per buyer; sequential keeps the store consistent
        const updated = await respondDocRequest(user.mobile, id, decision);
        serverSharedCount += updated?.sharedDocumentCount || 0;
      }
    } catch {
      await refresh();
      toast('Could not update every request. Some may have gone through — please review and retry.', 'error');
      return false;
    }
    await refresh();
    if (decision !== 'granted') {
      toast('Request declined — your documents stay private.', 'info');
      return true;
    }
    // The server counts the actual private-vault rows after each grant. A granted category with no
    // uploaded file is an honest zero, not a successful share.
    const shared = serverSharedCount;
    if (shared > 0) {
      toast(`Access granted — ${shared} document${shared === 1 ? '' : 's'} now visible to this buyer.`, 'success');
    } else {
      // Owner approved a category they haven't actually uploaded a file for yet.
      toast('Access approved, but you haven’t uploaded these documents yet. Upload them in the Document Vault so the buyer can view them.', 'info');
    }
    return true;
    });
  };

  const decideFlatmateReq = async (reqId, decision) => {
    return runBusy(`flatmate:${reqId}`, async () => {
      try {
        await decideRequest(reqId, decision);
      } catch (e) {
        toast(e?.message || 'That did not go through. Please try again.', 'error');
        await refreshFlatmateReqs();
        return false;
      }
      toast(decision === 'accepted' ? 'Request accepted — connect in Messages.' : 'Request declined.', decision === 'accepted' ? 'success' : 'info');
      try {
        setFlatmateReqs(await myRequests());
      } catch {
        await refreshFlatmateReqs();
      }
      return true;
    });
  };

  const mutateVisit = (id, patch) => {
    if (busyRef.current.has(`visit:${id}`)) return false;
    setBusy(`visit:${id}`, true);
    const snapshot = visits;
    setVisits((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
    const write = patch.when !== undefined
      ? rescheduleVisit(id, patch.when)
      : updateVisitStatus(id, patch.status);
      // Roll back on failure: a confirmed visit that silently reverts on the next load is worse
      // than one that visibly refuses.
    return write
      .then(
        () => {
          Promise.all([listVisits(), myVisitRequests()])
            .then(([mine, onMine]) => setVisits(mergeVisits(mine, onMine)))
            .catch(() => {});
          return true;
        },
        () => {
          setVisits(snapshot);
          toast('Could not update that visit. Please try again.', 'error');
          return false;
        },
      )
      .finally(() => setBusy(`visit:${id}`, false));
  };
  /* Open the owner's side of a verification thread. */

  const openReview = async (pid) => {
    setReviewProp(pid);
    setReviewInput('');
    setReviewThread(null);
    try {
      await markPropertyReviewRead(pid);
      setReviewThread(await getPropertyReview(pid));
      refreshReviews();
    } catch (err) {
      toast(`Could not open that verification thread: ${err.message}`, 'error');
      setReviewProp(null);
    }
  };
  const sendReview = async () => {
    const body = reviewInput.trim();
    // Cleared before the await, deliberately: the owner has stopped composing, and leaving the text
    // in the box for the duration of the round trip invites a second Enter and a duplicate message.
    if (!body || !reviewProp) return;
    setReviewInput('');
    try {
      setReviewThread(await addPropertyReviewMessage(reviewProp, body));
      refreshReviews();
    } catch (err) {
      // Put it back — a reply that vanished without being sent is worse than one that refuses.
      setReviewInput(body);
      toast(`Could not send that reply: ${err.message}`, 'error');
    }
  };

  const [bundle, dataStatus, , retryData, dataError, refreshData] = useAsyncList(
    // Both sides of the visit relationship: one person may be both a seeker and an owner.
    () => Promise.all([loadMyListings(user), listVisits(), myVisitRequests()]),
    [user?.mobile],
  );
  /* Derivation, split from the fetch so the loader stays a pure read and every `set*` below runs off one settled
     result. */

  useEffect(() => {
    if (bundle.length < 3) return;
    const [shownListings, mine, onMine] = bundle;
    setListings(shownListings);
    setVisits(mergeVisits(mine, onMine));
  }, [bundle]);

  // Once per visit, not on every refresh: the recommended rail is only for a known non-owner.
  useEffect(() => {
    if (ownsProperty === undefined) return undefined;
    let live = true;
    loadFeed(ownsProperty !== true).then((feed) => {
      if (!live) return;
      setRecent(feed.recent);
      setRecommended(feed.recommended);
    });
    return () => { live = false; };
  }, [ownsProperty]);

  useEffect(() => {
    setAlertMatches(searches
      .filter((s) => s.alerts !== false)
      .map((s) => ({
        id: s.id,
        label: s.label || 'your saved search',
        count: s.matchCount ?? 0,
        newCount: s.newCount ?? s.unreadCount,
        href: searchHref(s),
      }))
      .filter((m) => m.count > 0 || m.newCount > 0)
      .slice(0, 3));
  }, [searches]);

  const lastVisibleRefresh = useRef(0);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastVisibleRefresh.current < 30000) return;
      lastVisibleRefresh.current = now;
      refreshData();
      refreshFlatmateReqs();
      if (!ownerReads) return;
      refreshContactReqs();
      refreshPhotoReqs();
      refreshDocReqs();
      refreshApps();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [ownerReads, refreshApps, refreshContactReqs, refreshData, refreshDocReqs, refreshFlatmateReqs, refreshPhotoReqs]);

  const refreshReviews = useCallback(async () => {
    try {
      setReviewRows((await listMyPropertyReviews({ size: MAX_PAGE_SIZE })).items);
    } catch {
      setReviewRows([]);
    }
  }, []);

  useEffect(() => {
    if (ownerReads) refreshReviews();
    else setReviewRows([]);
  }, [ownerReads, refreshReviews]);

  // Keyed by both UUID and slug: the server answers with the UUID, the cards hold the slug.
  const reviewsByProp = useMemo(() => {
    const slugOf = new Map(listings.map((l) => [l.uuid || l.id, l.id]));
    const next = new Map();
    reviewRows.forEach((row) => {
      next.set(row.propertyId, row);
      const slug = slugOf.get(row.propertyId);
      if (slug) next.set(slug, row);
    });
    return next;
  }, [reviewRows, listings]);

  return {
    listings, visits, recent, recommended, alertMatches,
    contactReqs, photoReqs, flatmateReqs, docReqs,
    reviewProp, setReviewProp, reviewInput, setReviewInput, reviewsByProp, reviewThread,
    apps, decideApp,
    decideContact, decideDocReqs, decideFlatmateReq, decidePhotoReq, mutateVisit, openReview, sendReview,
    busyIds, isBusy, refreshData, setListings,
    // Load state, so the page can say "we couldn't load this" instead of rendering a plausible
    // dashboard for a user whose data never arrived.
    dataStatus, dataError, retryData,
    docReqsStatus, docReqsError, retryDocReqs,
    contactReqsStatus, contactReqsError, retryContactReqs,
    photoReqsStatus, photoReqsError, retryPhotoReqs,
    flatmateReqsStatus, flatmateReqsError, retryFlatmateReqs,
    appsStatus, appsError, retryApps,
  };
}
