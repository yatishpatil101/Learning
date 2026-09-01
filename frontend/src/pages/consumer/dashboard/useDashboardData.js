import { useCallback, useEffect, useState } from 'react';
import useAsyncList from '../../../hooks/useAsyncList.js';
import { MAX_PAGE_SIZE } from '../../../services/apiLimits.js';
import { listProperties } from '../../../services/propertyService.js';
import { listVisits, myVisitRequests, rescheduleVisit, updateVisitStatus } from '../../../services/visitService.js';
import { myContactRequests, respondToContactRequest } from '../../../services/contactService.js';
import { listDocRequests, respondDocRequest } from '../../../services/documentService.js';
import { decideGroupApplication, listMyGroupApplications } from '../../../services/flatmateService.js';
import { isHttpDomain } from '../../../services/config.js';
import { myPhotoRequests, resolvePhotoRequest } from '../../../services/photoRequestService.js';
import { getFlatmateRequests, decideFlatmateRequest } from '../../../lib/data/flatmates.js';
import {
  listMyPropertyReviews, getPropertyReview, markPropertyReviewRead, addPropertyReviewMessage,
} from '../../../services/propertyReviewService.js';
import { getRecentProps } from '../../../lib/localPrefs.js';
import {
  countSharedDocs, notifyBuyerDocsGranted,
} from '../../../lib/data/documents.js';
import { loadMyListings } from '../../../lib/data/myListings.js';
import { searchHref } from '../listings/alertCriteria.js';
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
  verified: !!r.requester?.verified,
  status: r.status,
  requestedAt: r.createdAt ? Date.parse(r.createdAt) : 0,
});

/**
 * A photo request, in the same row vocabulary.
 *
 * `propId` prefers the **slug** over the UUID, mirroring `propertyMapper`'s `id: p.slug || p.id`.
 * Everything downstream feeds this straight into a route (`/list-property?edit=<propId>`), and the
 * two identifiers are not interchangeable there: the server emits both precisely so this choice is
 * made once, out loud, instead of a UUID silently producing a link that 404s.
 *
 * `buyerMobile` is the masked number and there is no unmasked variant to fall back to — unlike a
 * contact request, this row has no approval that could ever reveal one.
 */
const toPhotoRow = (r) => ({
  id: r.id,
  propId: r.propertySlug || r.propertyId || '',
  propLabel: r.propertyTitle || '',
  buyerName: r.requester?.name || 'A buyer',
  buyerMobile: r.requester?.mobile || '',
  status: r.status || 'pending',
  requestedAt: r.createdAt ? Date.parse(r.createdAt) : 0,
});

/* Data layer for the consumer Dashboard: owns all remote/persisted state, the
   load + per-user request effects, and the mutation handlers. Extracted verbatim
   from the Dashboard container so the container is a thin orchestrator; behaviour
   (state shape, effect timing, optimistic updates, toasts) is unchanged. */
export function useDashboardData({ user, toast }) {
  const { searches } = useSavedSearches();
  const [listings, setListings] = useState([]);
  const [visits, setVisits] = useState([]);
  const [recent, setRecent] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [alertMatches, setAlertMatches] = useState([]);
  const [flatmateReqs, setFlatmateReqs] = useState([]);
  const [reviewProp, setReviewProp] = useState(null);
  const [reviewInput, setReviewInput] = useState('');
  /* One read for every listing card's verification chip and unread badge, keyed by property id.

     This used to be `ensureOwnerReview` called per listing on every load — which is to say the
     dashboard *created* a case file for each of the owner's listings just to have something to read
     back. That is not a read the server offers or should: submitting for verification is the
     owner's act. `/me/property-reviews` answers the same question in one request without asserting
     anything, and a listing with no case file is simply absent from the map. */
  const [reviewsByProp, setReviewsByProp] = useState(() => new Map());
  const [reviewThread, setReviewThread] = useState(null);

  useEffect(() => {
    if (user?.mobile) {
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

  // Flatmate group applications on the caller's own listings. Owner-scoped by the session, like the
  // contact inbox, and read through the same seam the ops moderation board uses — before this it
  // was a localStorage store with a hardcoded seed, so an owner in http mode was shown two fictional
  // groups and never the real one that had applied.
  const [apps, appsStatus, setApps, retryApps, appsError] = useAsyncList(
    () => listMyGroupApplications({ size: 50 }).then((res) => res.items),
    [user],
    !!user?.mobile,
  );

  // Accept/decline is irreversible and the server refuses a second answer, so the row is re-read
  // rather than patched in place: what comes back is what the server actually recorded. The toast
  // lives here rather than at the two call sites because it must not fire until the write lands —
  // it used to be raised optimistically next to a synchronous localStorage write, which is a
  // promise this cannot keep now that a decision can be refused.
  const decideApp = async (appId, status) => {
    try {
      const decided = await decideGroupApplication(appId, status);
      setApps((rows) => rows.map((a) => (a.id === appId ? decided : a)));
      toast(status === 'accepted'
        ? 'Group application accepted'
        : 'Group application declined', status === 'accepted' ? 'success' : 'info');
    } catch (e) {
      toast(e?.message || 'That did not go through. Please try again.', 'error');
    }
  };

  const decideContact = async (reqId, decision) => {
    await respondToContactRequest(reqId, decision);
    const res = await myContactRequests();
    setContactReqs(res.items.map(toLeadRow));
    toast(decision === 'approved' ? 'Your number is now shared with this buyer.' : 'Request declined — your number stays private.', decision === 'approved' ? 'success' : 'info');
  };

  /* The photo-request inbox — buyers asking for more pictures of listings this caller owns.
     Owner-scoped by the session, so like the contact and document inboxes it takes no argument.

     This was a synchronous localStorage read, and it could never have worked: the buyer's browser
     wrote `puneNestPhotoReq:<ownerMobile>` into *its own* storage, and the owner read that key from
     *theirs*. Two origins, one key name — so no real owner has ever seen a photo request, and the
     e2e spec that covered it passed only because a single browser context played both parts. That
     is the whole reason this domain moved server-side.

     `useAsyncList` rather than a `.catch(() => [])`: "nobody has asked about your listings" is a
     claim we cannot make from a request that failed (D166). */
  const [photoReqs, photoReqsStatus, setPhotoReqs, retryPhotoReqs, photoReqsError] = useAsyncList(
    () => myPhotoRequests().then((res) => res.items.map(toPhotoRow)),
    [user],
    !!user?.mobile,
  );

  /* The owner's half of the maker-checker pair: the buyer makes the request, the owner marks it
     satisfied. The server is the one that enforces they are different people — a requester
     resolving their own row gets a 404 — so this handler carries no authorisation logic of its own;
     it would only be a second, weaker copy of a rule that already holds.

     Re-read rather than patched in place, matching `decideContact`: what comes back is what the
     server actually recorded. The toast waits for the write for the same reason — raised
     optimistically it would promise a buyer had been answered when the request may have failed. */
  const resolvePhotoReq = async (reqId) => {
    try {
      await resolvePhotoRequest(reqId);
      const res = await myPhotoRequests();
      setPhotoReqs(res.items.map(toPhotoRow));
      toast('Marked done — this buyer is no longer waiting on you.', 'success');
    } catch (e) {
      toast(e?.message || 'That did not go through. Please try again.', 'error');
    }
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
    let serverSharedCount = 0;
    try {
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop -- a handful of ids per buyer; sequential keeps the store consistent
        const updated = await respondDocRequest(user.mobile, id, decision);
        serverSharedCount += updated?.sharedDocumentCount || 0;
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
    // HTTP counts the actual private-vault rows after each grant; the mock counts its local share
    // ledger. A granted category with no uploaded file is an honest zero, not a successful share.
    const isHttp = isHttpDomain('document');
    const shared = isHttp ? serverSharedCount : countSharedDocs(user.mobile, ids);
    if (shared > 0) {
      if (!isHttp) notifyBuyerDocsGranted(user.mobile, ids);
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
  //
  // The optimistic patch carries only the fields the caller named, but a status change can move
  // fields the caller does not know about: confirming a visit is what earns the owner the
  // visitor's real mobile, which arrives masked until then. Merging `{status}` alone left the row
  // reading "Confirmed" beside a still-masked number, so `VisitsTab`'s `isFullMobile` guard
  // suppressed the WhatsApp handoff until the owner happened to reload — the reveal shipped, and
  // the one screen that acts on it could not see it. So the write is followed by a re-read of the
  // server's answer, which the derivation effect below folds back over the optimistic row.
  //
  // `refreshData`, not `retryData`: refresh keeps the current list on screen while it re-reads and
  // swallows its own failure, so a confirm never flashes the dashboard back to skeletons, and a
  // refresh that fails leaves a row that is stale rather than a page that is an error. Chained off
  // `.then` so the PATCH has been acknowledged before the read that is meant to observe it.
  const mutateVisit = (id, patch) => {
    const snapshot = visits;
    setVisits((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
    const write = patch.when !== undefined
      ? rescheduleVisit(id, patch.when)
      : updateVisitStatus(id, patch.status);
    write
      .then(() => refreshData())
      // Roll back on failure: a confirmed visit that silently reverts on the next load is worse
      // than one that visibly refuses.
      .catch(() => {
        setVisits(snapshot);
        toast('Could not update that visit. Please try again.', 'error');
      });
  };

  /* Open the owner's side of a verification thread.

     Marking read first, then re-reading, rather than clearing the badge locally: the unread count
     on the card comes from the server, so a local clear would be undone by the next queue read and
     the badge would flicker back. Ordering matters too — the fetched thread has to be the one taken
     *after* the write, or the modal opens showing messages the server already considers seen.

     `pid` is a property id, either form; the card passes what it was given. */
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
    if (!body || !reviewProp) return;
    // Cleared before the await, deliberately: the owner has stopped composing, and leaving the text
    // in the box for the duration of the round trip invites a second Enter and a duplicate message.
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

  /* The dashboard's core read: everything the tabs, the stats row and the owner/tenant decision are
     derived from. It had no `.catch` at all, so a failure was an unhandled rejection and the page
     simply stayed as it was born — no listings, no visits, no enquiries. That is worse than an
     empty state, because `isOwner` is computed from `listings`: a landlord whose read failed was
     shown the *tenant* dashboard, with a rent wallet where their property ledger should be. The
     load now has a status the page can render and a retry (D166).

     Kept on `[searches]` rather than `[user]` \u2014 the saved-search context reloads per session, so
     this still re-runs on sign-in, and widening the deps here would change refetch behaviour that
     is not what D166 is about. */
  const [bundle, dataStatus, , retryData, dataError, refreshData] = useAsyncList(
    () => Promise.all([
      loadMyListings(user),
      listProperties({ includeAllStatuses: true }, 'newest'),
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
    if (bundle.length < 4) return;
    const [shownListings, props, mine, onMine] = bundle;
    // Combined owner view: property listings + flatmate/room posts (rooms-aware).
    setListings(shownListings);
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
    // Retention loop: for each active saved search, how many LIVE approved listings match its
    // criteria right now. The count is carried on the record by the seam (D227) — it used to be
    // computed here against `approved`, which is one page of the catalogue, so the strip read
    // "2 match" to a user with fifty. Only searches with real matches surface; each links to the
    // actual filtered results. Nothing is fabricated.
    const matches = searches
      .filter((s) => s.alerts !== false)
      .map((s) => ({ id: s.id, label: s.label || 'your saved search', count: s.matchCount ?? 0, href: searchHref(s) }))
      .filter((m) => m.count > 0)
      .slice(0, 3);
    setAlertMatches(matches);
    // Saved searches arrive asynchronously now, so the match counts have to be recomputed once the
    // list lands — on the first pass it is empty and the retention strip would never appear.
  }, [bundle, searches]);

  /* The verification queue, keyed both ways.

     Keyed by `propertyId` *and* by `slug`, because the card holds a listing whose `id` is the slug
     where one exists (see `propertyMapper`) while the queue speaks UUIDs — so a single-keyed map
     would silently miss exactly the listings that have a slug, which is most of them. Indexing both
     is cheaper and more honest than making every caller remember which id it is holding.

     A failure leaves the map empty rather than raising: the chip and badge are decoration on a page
     whose real content is the listings, and a dashboard that refuses to render because a badge
     could not be counted is a worse failure than a missing badge. */
  const refreshReviews = useCallback(async () => {
    try {
      const { items } = await listMyPropertyReviews({ size: MAX_PAGE_SIZE });
      const bySlug = new Map(listings.map((l) => [l.uuid || l.id, l.id]));
      const next = new Map();
      items.forEach((row) => {
        next.set(row.propertyId, row);
        const slug = bySlug.get(row.propertyId);
        if (slug) next.set(slug, row);
      });
      setReviewsByProp(next);
    } catch {
      setReviewsByProp(new Map());
    }
  }, [listings]);

  useEffect(() => { refreshReviews(); }, [refreshReviews]);

  return {
    listings, visits, recent, recommended, alertMatches,
    contactReqs, photoReqs, flatmateReqs, docReqs,
    reviewProp, setReviewProp, reviewInput, setReviewInput, reviewsByProp, reviewThread,
    apps, decideApp,
    decideContact, decideDocReqs, decideFlatmateReq, resolvePhotoReq, mutateVisit, openReview, sendReview,
    // Load state, so the page can say "we couldn't load this" instead of rendering a plausible
    // dashboard for a user whose data never arrived.
    dataStatus, dataError, retryData,
    docReqsStatus, docReqsError, retryDocReqs,
    contactReqsStatus, contactReqsError, retryContactReqs,
    photoReqsStatus, photoReqsError, retryPhotoReqs,
    appsStatus, appsError, retryApps,
  };
}
