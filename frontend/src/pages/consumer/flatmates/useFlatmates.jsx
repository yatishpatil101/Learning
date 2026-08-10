import { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useScrollReveal } from '../../../lib/useScrollReveal.js';
import useAsyncList from '../../../hooks/useAsyncList.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { getListings, isListingApproved, getTenancies } from '../../../lib/store.js';
import { digits } from '../../../lib/contact.js';
import { getMyRequest, hasInterest as hasInterestDB, addInterest as addInterestDB, getFlatmateReviewStatusMap, addFlatmateRequest, pushNotification, pushPendingRequest } from '../../../lib/data/flatmates.js';
import * as flatmateService from '../../../services/flatmateService.js';
import { reconcileSplitVerification } from '../../../lib/data/flatSplit.js';
import { FLATMATE_IMG } from './helpers.js';
import { normalizeTab } from './model.js';
import { useFlatmateDiscovery, emptyFilters } from './useFlatmateDiscovery.jsx';
import { useFlatmateSupply } from './useFlatmateSupply.jsx';

export { emptyFilters };
// Map view stays fast and legible when the user focuses on a handful of areas
// first (mirrors the Listings map gate). Picking one area is enough to unlock it.
export const MAP_MAX_AREAS = 5;

/* Opening message per share intent, so the owner learns how many people are
   coming in the first line rather than three messages later. */
const SHARE_OPENER = {
  solo: "Hi! I'm interested in the room you listed. Is it still available?",
  bring: "Hi! I'm interested in this room and I'd be taking it with someone I know — so two of us in total. Is it still available?",
  match: "Hi! I'm interested in this room and I'd like to split it with another flatmate. Is it still available, and are you open to two people sharing it?",
};

/* The three public collections.

   These used to be assembled in the view from a store getter plus a hard-coded seed, each filtered
   through `isPubliclyVisible` here because the getters could not do it (tech-debt D97d). Both jobs
   now sit behind the seam: the provider merges the seed and drops moderated rows, exactly as the
   server's nine SQL query sites do, so a flagged post disappears from the board in either mode and
   the page no longer has to remember to filter.

   The rule is deliberately *not* applied on the owner's own dashboard, which still labels a post
   that was taken down rather than hiding it — losing a post silently is worse than seeing why. */
const PAGE = 200; // one page: the board sorts and filters the whole set client-side below

/* The three feeds, hoisted so the initial read and `refresh` below call the same thing — the
   duplicate the old code avoided by doing both in one function, which is also why neither had a
   failure state. */
const loadPosts = () => flatmateService.listPosts({}, 0, PAGE).then((r) => r.items);
const loadRooms = () => flatmateService.listRooms({}, 0, PAGE).then((r) => r.items);
const loadGroups = () => flatmateService.listGroups({}, 0, PAGE).then((r) => r.items);

// Orchestrator: owns page context, the shared data collections (requests/rooms/
// groups/saved/interests), tab/view nav state, shared derivations and the demand-
// side interactions. Discovery (read-side filtering) and supply (posting/verify)
// are composed as sub-hooks and their returns are spread into the public shape.
export function useFlatmates() {
  const rootRef = useScrollReveal([]);
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const urlTab = params.get('view');
  // normalizeTab also resolves the legacy ?view=flatmates|rooms|groups values, so
  // older deep links and saved alerts land somewhere sensible instead of silently
  // falling back to the default tab.
  const [tab, setTab] = useState(() => normalizeTab(urlTab));
  // The single posting entry point. Rather than making the user pick between
  // "post a request", "list a room" and "create a group" before seeing any form,
  // one CTA asks whether they have a place and routes from the answer.
  const [postChooserOpen, setPostChooserOpen] = useState(false);
  const [viewMode, setViewMode] = useState('list');
  /* A room split from a not-yet-approved flat carries no owner badge. Ops approval lands on the
     LISTING, which only the owner's session can read, so the badge is promoted here on the owner's
     next visit rather than looked up live. Declared ABOVE the feeds on purpose: effects fire in
     hook order, so this still lands before the first read, exactly as when the two shared one
     effect. */
  useEffect(() => { reconcileSplitVerification(); }, []);
  /* The three public collections, each with its own lifecycle (D166).

     They are still fetched together on mount — switching tabs is the most common interaction on
     this page and paying a round trip for it would make the board feel slower than the
     localStorage version it replaces — but a failure used to be a `console.warn` and an empty
     array, so "no rooms in Kothrud" and "we never asked" rendered identically. Separate hooks keep
     one dead feed from blanking the other two, which is what the old `allSettled` was for. */
  const [requests, requestsStatus, setRequests, retryRequests, requestsError] = useAsyncList(loadPosts, []);
  const [rooms, roomsStatus, setRooms, retryRooms, roomsError] = useAsyncList(loadRooms, []);
  const [groups, groupsStatus, setGroups, retryGroups, groupsError] = useAsyncList(loadGroups, []);
  const feedError = requestsError || roomsError || groupsError;
  const feedFailed = requestsStatus === 'error' || roomsStatus === 'error' || groupsStatus === 'error';
  const retryFeeds = useCallback(() => { retryRequests(); retryRooms(); retryGroups(); }, [retryRequests, retryRooms, retryGroups]);
  const [saved, setSaved] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem('puneNestFlatmateSaved') || '{}');
      return Object.fromEntries(Object.keys(s).map((k) => [k, true]));
    } catch { return {}; }
  });
  const [interests, setInterests] = useState({});
  const [reportTarget, setReportTarget] = useState(null);

  // Single source of truth for reloading the shared collections after a mutation — supply-side
  // handlers `await` this and then toast, so it stays a real promise rather than becoming the
  // hooks' `retry` (which resolves instantly and would let the toast beat the data).
  //
  // `allSettled` so one failing feed leaves the other two rendered: a 500 on groups should not
  // blank out the rooms the user was reading. A failed refresh deliberately leaves the previous
  // list standing rather than emptying it — the mutation that triggered it reports its own
  // outcome, and the initial-load hooks above own the "we could not read this at all" case.
  const refresh = useCallback(async () => {
    const [p, r, g] = await Promise.allSettled([loadPosts(), loadRooms(), loadGroups()]);
    if (p.status === 'fulfilled') setRequests(p.value); else console.warn('[flatmates] posts failed', p.reason);
    if (r.status === 'fulfilled') setRooms(r.value); else console.warn('[flatmates] rooms failed', r.reason);
    if (g.status === 'fulfilled') setGroups(g.value); else console.warn('[flatmates] groups failed', g.reason);
  }, [setRequests, setRooms, setGroups]);

  const myPost = useMemo(() => (user ? getMyRequest(user.mobile, user.name) : null), [user, requests]);
  // Whether the signed-in user created a given group. Matches tolerantly by the
  // last 10 mobile digits, falling back to name — the same rule getMyRequest uses
  // for flatmate posts. Only user-created groups carry ownerMobile/ownerName; seed
  // groups return false, so owner controls never show on them.
  const ownsGroup = (g) => {
    if (!user || !g) return false;
    const owner = digits(g.ownerMobile).slice(-10);
    // A real user-created post carries the owner's mobile — require an exact match
    // and never fall through to the (weaker) name check, so a name collision can't
    // grant owner controls over someone else's post.
    if (owner) { const mine = digits(user.mobile).slice(-10); return !!mine && mine === owner; }
    const nm = (user.name || '').trim().toLowerCase();
    return !!nm && !!g.ownerName && g.ownerName.trim().toLowerCase() === nm;
  };
  const ownsRoom = (r) => {
    if (!user || !r) return false;
    const owner = digits(r.ownerMobile).slice(-10);
    if (owner) { const mine = digits(user.mobile).slice(-10); return !!mine && mine === owner; }
    const nm = (user.name || '').trim().toLowerCase();
    return !!nm && !!r.owner && r.owner.trim().toLowerCase() === nm;
  };
  // Moderation status per group/room so cards can show Pending Ops review /
  // Ops-verified / Review failed. Recomputed as groups change — a new tenant post
  // enqueues a review, and an Ops decision (read on reload) flips the status.
  const reviewMap = useMemo(() => getFlatmateReviewStatusMap(), [groups, rooms]);

  const supply = useFlatmateSupply({ refresh, setRooms, user, toast, t, nav: navigate, interests, setInterests, ownsGroup, ownsRoom, myPost });
  const { groupOpen, isVerified, setVerifyOpen, openPostModal, listRoom, createGroup } = supply;

  // The signed-in user's own Ops-verified property listings — offered as an
  // "attach a verified property" option when they create a group as the owner.
  // Recomputed when the modal opens so a listing approved mid-session is picked up.
  const myApprovedListings = useMemo(() => (user ? getListings().filter((l) => isListingApproved(l.id)) : []), [user, groupOpen]);
  // The signed-in user's active PuneNest tenancies (flats they rented through us).
  // A sitting tenant seeking a replacement can post from one of these in a tap —
  // we already hold the flat's rent, locality and the owner's number for consent.
  // Recomputed when the modal opens so a tenancy finalised mid-session is picked up.
  const myTenancies = useMemo(() => (user ? getTenancies().filter((t) => t.status !== 'ended') : []), [user, groupOpen]);

  const discovery = useFlatmateDiscovery({ tab, setTab, viewMode, requests, rooms, groups, t, toast, myPost, reviewMap, openPostModal, onPost: () => setPostChooserOpen(true) });
  const { setF, seekerList, roomList, groupList } = discovery;

  const onSave = (k, data) => {
    const next = !saved[k];
    setSaved((m) => {
      const n = { ...m };
      if (next) n[k] = true; else delete n[k];
      return n;
    });
    // Persist OUTSIDE the updater — React 19 StrictMode double-invokes updaters and
    // concurrent re-basing can invoke them again, so a write in there is not safe.
    try {
      const s = JSON.parse(localStorage.getItem('puneNestFlatmateSaved') || '{}');
      if (next) s[k] = data || { title: k, kind: 'flatmate' }; else delete s[k];
      localStorage.setItem('puneNestFlatmateSaved', JSON.stringify(s));
    } catch (e) { console.warn('[flatmates] saved-posts write failed', e); }
  };
  const onInterest = (r) => {
    if (!user) { navigate('/signin?reason=contact&next=' + encodeURIComponent(window.location.pathname)); return; }
    if (hasInterestDB(r.id)) { toast(t('flatmates.alreadyInterested', { name: r.name })); return; }
    if (r.verifiedContactOnly && !isVerified) { toast(t('flatmates.acceptsVerifiedOnlyToast', { name: r.name }), 'error'); setVerifyOpen(true); return; }
    addInterestDB(r.id);
    setInterests((m) => ({ ...m, [r.id]: true }));

    // Record a host-facing request so the flatmate seeker (post owner) sees it
    // in Dashboard → Requests → Flatmate.
    addFlatmateRequest(r.mobile, { kind: 'flatmate', action: 'request', targetId: r.id, targetTitle: 'Flatmate with ' + r.name, locality: (r.localities || [])[0] || '', requesterName: user.name || 'Someone', requesterMobile: user.mobile || '' });

    // Push notification (mirrors HTML flatmates.html behavior)
    pushNotification({ type: 'share', title: 'Flatmate interest from ' + (user.name || 'Someone'), desc: (user.name || 'A seeker') + ' is interested in sharing with ' + r.name + '.', time: 'Just now', link: '/messages', unread: true });

    // Push pending chat request so Messages page picks it up
    pushPendingRequest({ propertyId: r.id, property: { title: 'Flatmate: ' + r.name, price: r.budget ? '₹' + r.budget + '/mo' : '', loc: (r.localities || [])[0] || 'Pune', img: FLATMATE_IMG }, party: { name: r.name, avatar: (r.name || 'U').slice(0, 2).toUpperCase() }, firstMessage: "Hi! I'm interested in sharing a flat. Let's connect." });

    toast(t('flatmates.interestSentToast', { name: r.name }));
  };

  // Rooms use a distinct interest key ("room-<id>") and a different payload than
  // flatmate seekers, so they get their own handler instead of overloading onInterest.
  // `share` carries how the seeker intends to take the room ('solo' | 'bring' |
  // 'match') — the owner needs to know whether one person or two are moving in,
  // and 'match' means we still owe them a room-sharer.
  const onRoomInterest = (room, share = 'solo') => {
    if (!user) { navigate('/signin?reason=contact&next=' + encodeURIComponent(window.location.pathname)); return; }
    const key = 'room-' + room.id;
    if (interests[key] || hasInterestDB(key)) { toast(t('flatmates.alreadyMessagedOwner', { society: room.society })); return; }
    addInterestDB(key);
    setInterests((m) => ({ ...m, [key]: true }));

    addFlatmateRequest(room.ownerMobile, { kind: 'room', action: 'request', share, targetId: key, targetTitle: 'Room in ' + room.society, locality: (room.localities || [])[0] || '', requesterName: user.name || 'Someone', requesterMobile: user.mobile || '' });

    pushNotification({ type: 'share', title: 'Room enquiry sent', desc: (user.name || 'A seeker') + ' messaged the owner about a room in ' + room.society + '.', time: 'Just now', link: '/messages', unread: true });

    pushPendingRequest({ propertyId: key, property: { title: 'Room in ' + room.society, price: room.budget ? '₹' + room.budget + '/mo' : '', loc: (room.localities || [])[0] || 'Pune', img: room.img }, party: { name: room.society, avatar: (room.society || 'RM').slice(0, 2).toUpperCase() }, firstMessage: SHARE_OPENER[share] || SHARE_OPENER.solo });

    toast(t('flatmates.messageSentOwner', { society: room.society }));
  };

  // Reporting a post opens the shared platform ReportModal. Cards pass a target
  // descriptor ({ id, title, ownerName, ownerMobile, kind }); rooms map to the
  // admin "listings" queue, flatmates & groups to the "users" queue.
  const onReport = (target) => setReportTarget(target);

  // Whether the current user has already reached out — mirrors Results.jsx so the
  // map popup's action state matches the list card exactly. Reads the record's own
  // `kind` tag, because a map cluster now mixes rooms, groups and seekers.
  const interestedFor = (item) => {
    if (!item) return false;
    if (item.kind === 'room') return !!interests['room-' + item.id] || hasInterestDB('room-' + item.id);
    if (item.kind === 'group') return !!interests['group-' + item.id] || hasInterestDB('group-' + item.id);
    return !!interests[item.id] || hasInterestDB(item.id);
  };

  // No dedicated detail route exists for flatmates posts — every post lives on the
  // list. "Go to posting" therefore switches to the list, narrows to the locality so
  // the card is guaranteed present, then scrolls to and briefly highlights it.
  const [pendingScroll, setPendingScroll] = useState(null);
  const goToPosting = (kind, id, locality) => {
    setViewMode('list');
    if (locality) setF({ locality });
    setPendingScroll({ kind, id, at: Date.now() });
  };
  useEffect(() => {
    if (!pendingScroll || viewMode !== 'list') return;
    let flash;
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-sf-id="${pendingScroll.kind}:${pendingScroll.id}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('sf-flash');
        flash = setTimeout(() => el.classList.remove('sf-flash'), 1700);
      }
      setPendingScroll(null);
    }, 90);
    return () => { clearTimeout(t); clearTimeout(flash); };
  }, [pendingScroll, viewMode, seekerList, roomList, groupList]);

  return {
    rootRef,
    t,
    user,
    toast,
    tab,
    setTab,
    postChooserOpen,
    openPostChooser: () => setPostChooserOpen(true),
    closePostChooser: () => setPostChooserOpen(false),
    viewMode,
    setViewMode,
    myPost,
    myApprovedListings,
    myTenancies,
    ownsGroup,
    ownsRoom,
    reviewMap,
    onSave,
    onInterest,
    onRoomInterest,
    onReport,
    interestedFor,
    goToPosting,
    saved,
    interests,
    reportTarget,
    setReportTarget,
    feedFailed,
    feedError,
    retryFeeds,
    ...discovery,
    ...supply,
    emptyFilters,
    MAP_MAX_AREAS,
  };
}
