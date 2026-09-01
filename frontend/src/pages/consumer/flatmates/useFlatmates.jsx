import { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useScrollReveal } from '../../../lib/useScrollReveal.js';
import useAsyncList from '../../../hooks/useAsyncList.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { digits } from '../../../lib/contact.js';
import { getMyRequest, getFlatmateReviewStatusMap, recordAskLocally, getAskedInterests, rememberAsk } from '../../../lib/data/flatmates.js';
import * as flatmateService from '../../../services/flatmateService.js';
import * as propertyService from '../../../services/propertyService.js';
import * as rentService from '../../../services/rentService.js';
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

/* The opener sent with a seeker-post interest. Rooms have three (above) because the share intent
   changes what the host is being asked; a seeker post has one. */
const SEEKER_OPENER = "Hi! I'm interested in sharing a flat. Let's connect.";

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

/* "Has Ops approved this listing?", asked of a record already in hand rather than by id.

   `status` is only meaningful on the two status-complete reads — the owner's own listings and the
   moderation queue — and the owner-scoped read below is one of them. Public search cannot answer
   this at all: it is hard-floored to approved server-side and its rows deliberately carry no
   trust-critical `status` to test, so every row it returns would pass a predicate that never sees a
   rejected one.

   All three spellings are matched because the value is written by both the moderation decision
   (`approved`) and the older verification flows (`verified`, `live`); a group silently losing its
   owner badge is a worse outcome than a regex that is slightly generous about how approval is
   spelled. */
const isApproved = (listing) => /approved|verified|live/i.test(String(listing?.status || ''));

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
  /* Seeded from what THIS user has already asked from this browser, so the done-state survives a
     reload. It is memory of our own taps, never a substitute for the provider's answer (D181) — the
     handlers below read it for nothing, they only add to it once a call has come back.

     Re-seeded when the signed-in identity changes, because the cards gate their CTA on this map:
     left holding the previous user's asks, the next person to sign in on a shared browser would
     see someone else's activity and have no button to press. */
  const [interests, setInterests] = useState(() => getAskedInterests(user?.mobile));
  useEffect(() => { setInterests(getAskedInterests(user?.mobile)); }, [user?.mobile]);
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

  const supply = useFlatmateSupply({ refresh, setRooms, user, toast, t, nav: navigate, setInterests, ownsGroup, ownsRoom, myPost });
  const { groupOpen, isVerified, setVerifyOpen, openPostModal, listRoom, createGroup } = supply;

  /* The signed-in user's own Ops-verified property listings — offered as an "attach a verified
     property" option when they create a group as the owner. Re-read when the modal opens so a
     listing approved mid-session is picked up.

     `myListings` rather than a page of the public search, which is the read this looks like it
     wants: `/properties` takes no principal, so "mine" could only be expressed there as an owner id
     the browser supplies, and it is floored to approved, so it is also the one response an owner's
     own pending and rejected rows are guaranteed to be missing from. Approval is therefore narrowed
     here rather than asked for — the owner-scoped read is status-complete by design and has no
     status parameter to pass through the seam — which is sound only because these rows carry a real
     `status`; see `isApproved` above for why the same predicate over a public search result would
     be meaningless.

     Through `useAsyncList` for the reason the three feeds above are: every read takes a ticket and
     only the newest may write, so the re-read fired by opening the modal cannot be overwritten by a
     slower earlier one, and a failure surfaces as an error rather than as a confident empty list.
     It also keeps the previous answer on screen while the re-read is in flight, which matters more
     here than on the feeds — an empty list is what the picker renders as "you have not listed a
     property yet", so blanking it for the length of a round trip would tell the owner something
     untrue about themselves. Signed out, the loader is not called at all and the list is
     legitimately empty. */
  const [myApprovedListings, myApprovedListingsStatus, , retryMyApprovedListings, myApprovedListingsError] = useAsyncList(
    () => propertyService.myListings(user).then((list) => list.filter(isApproved)),
    [user?.mobile, groupOpen],
    !!user,
  );
  /* The signed-in user's active PuneNest tenancies (flats they rented through us). A sitting tenant
     seeking a replacement can post from one of these in a tap — we already hold the flat's rent,
     locality and the owner's number for consent. Re-read when the modal opens so a tenancy finalised
     mid-session is picked up.

     Scoped to the caller by their session rather than by an argument naming whose tenancies to read,
     which is what the seam offers and the only version of this that survives contact with a real
     API. Ended tenancies are dropped here because `myTenancies()` takes no arguments and so cannot
     be asked to omit them, not because the distinction is a rendering preference: a finished tenancy
     is still a real one and other surfaces need it. */
  const [myTenancies, myTenanciesStatus, , retryMyTenancies, myTenanciesError] = useAsyncList(
    () => rentService.myTenancies().then((list) => list.filter((tenancy) => tenancy.status !== 'ended')),
    [user?.mobile, groupOpen],
    !!user,
  );

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
  /* The two demand-side doors. Both go through the seam (D181).

     They used to short-circuit on a per-device localStorage flag and then write the host's inbox
     row, the notification and the chat thread themselves — so nothing ever reached the API, an
     interest expressed on one phone was invisible on the other, and the server's `already_interested`
     409 was correct and unreachable. The provider now owns the inbox row; this hook owns the button
     state and the toast.

     The optimistic flip is what stops a second tap racing the first: the card re-renders into its
     "Interest sent" state before the request settles, and the flip is rolled back on any failure
     except the benign duplicate — where it is *right*, because the host really does have the
     message. That duplicate is deliberately an informational toast: routing it to
     `common.somethingWentWrong` would turn a repeat tap into a red error for something that has
     already worked.

     `rememberAsk` runs only once the provider has answered, on both of those outcomes — the flip
     is optimistic, the persisted record is not. */
  const onInterest = async (r) => {
    if (!user) { navigate('/signin?reason=contact&next=' + encodeURIComponent(window.location.pathname)); return; }
    if (r.verifiedContactOnly && !isVerified) { toast(t('flatmates.acceptsVerifiedOnlyToast', { name: r.name }), 'error'); setVerifyOpen(true); return; }
    /* Built before the call so the accepted and the duplicate-409 paths write the SAME record
       (D183) — the device that gets the 409 is often not the one that made the original ask, and it
       has to end up holding the same bell entry and Messages thread. */
    const ask = {
      notification: { type: 'share', title: 'Flatmate interest from ' + (user.name || 'Someone'), desc: (user.name || 'A seeker') + ' is interested in sharing with ' + r.name + '.', time: 'Just now', link: '/messages', unread: true },
      request: { propertyId: r.id, property: { title: 'Flatmate: ' + r.name, price: r.budget ? '₹' + r.budget + '/mo' : '', loc: (r.localities || [])[0] || 'Pune', img: FLATMATE_IMG }, party: { name: r.name, avatar: (r.name || 'U').slice(0, 2).toUpperCase() }, firstMessage: SEEKER_OPENER },
    };
    setInterests((m) => ({ ...m, [r.id]: true }));
    try {
      await flatmateService.postInterest(r.id, { share: 'solo', message: SEEKER_OPENER });
    } catch (err) {
      if (err?.code === flatmateService.CONFLICT_ALREADY_INTERESTED) {
        rememberAsk(user.mobile, r.id);
        /* The done state is the server's truth and stays. `recordAskLocally` is what earns it: the
           thread and the notification are otherwise written on the success path only, into this
           browser's localStorage, so a seeker who first tapped on their phone used to land here on
           a finished card with an empty Messages page. Writing them here makes the two devices
           agree; the call is idempotent, so the phone that already holds the thread writes nothing.

           The wording still does not send anyone to Messages and still claims nothing beyond what
           the server knows — that stays true per device and must not be reopened until Messages
           reads a server-side inbox rather than localStorage (D183). */
        recordAskLocally(ask);
        toast(t('flatmates.interestAlreadyRecorded', { name: r.name }));
        return;
      }
      setInterests((m) => { const n = { ...m }; delete n[r.id]; return n; });
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    rememberAsk(user.mobile, r.id);

    // The bell notification and the Messages hand-off (mirrors HTML flatmates.html behavior).
    recordAskLocally(ask);

    toast(t('flatmates.interestSentToast', { name: r.name }));
  };

  // Rooms use a distinct interest key ("room-<id>") and a different payload than
  // flatmate seekers, so they get their own handler instead of overloading onInterest.
  // `share` carries how the seeker intends to take the room ('solo' | 'bring' |
  // 'match') — the owner needs to know whether one person or two are moving in,
  // and 'match' means we still owe them a room-sharer.
  const onRoomInterest = async (room, share = 'solo') => {
    if (!user) { navigate('/signin?reason=contact&next=' + encodeURIComponent(window.location.pathname)); return; }
    const key = 'room-' + room.id;
    const opener = SHARE_OPENER[share] || SHARE_OPENER.solo;
    // Same reason as `onInterest` above: one record, written by whichever path answers (D183).
    const ask = {
      notification: { type: 'share', title: 'Room enquiry sent', desc: (user.name || 'A seeker') + ' messaged the owner about a room in ' + room.society + '.', time: 'Just now', link: '/messages', unread: true },
      request: { propertyId: key, property: { title: 'Room in ' + room.society, price: room.budget ? '₹' + room.budget + '/mo' : '', loc: (room.localities || [])[0] || 'Pune', img: room.img }, party: { name: room.society, avatar: (room.society || 'RM').slice(0, 2).toUpperCase() }, firstMessage: opener },
    };
    setInterests((m) => ({ ...m, [key]: true }));
    try {
      await flatmateService.roomInterest(room.id, { share, message: opener });
    } catch (err) {
      if (err?.code === flatmateService.CONFLICT_ALREADY_INTERESTED) {
        rememberAsk(user.mobile, key);
        // Says only what the server knows, and leaves this device holding the same thread the
        // success path writes — for the reason spelled out on the seeker branch above.
        recordAskLocally(ask);
        toast(t('flatmates.enquiryAlreadyRecorded', { society: room.society }));
        return;
      }
      setInterests((m) => { const n = { ...m }; delete n[key]; return n; });
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    rememberAsk(user.mobile, key);

    recordAskLocally(ask);

    toast(t('flatmates.messageSentOwner', { society: room.society }));
  };

  // Reporting a post opens the shared platform ReportModal. Cards pass a target
  // descriptor ({ id, title, ownerName, ownerMobile, kind }); rooms map to the
  // admin "listings" queue, flatmates & groups to the "users" queue.
  const onReport = (target) => setReportTarget(target);

  // Whether the current user has already reached out — mirrors Results.jsx so the
  // map popup's action state matches the list card exactly. Reads the record's own
  // `kind` tag, because a map cluster now mixes rooms, groups and seekers.
  //
  // Device-scoped by design (D181): the seam has no "have I already asked" read, so this knows
  // only about asks made from this browser. On a second device the button comes back, and the
  // repeat tap is answered by the provider's benign 409 rather than pre-empted here.
  const interestedFor = (item) => {
    if (!item) return false;
    if (item.kind === 'room') return !!interests['room-' + item.id];
    if (item.kind === 'group') return !!interests['group-' + item.id];
    return !!interests[item.id];
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
    /* Each attach source reports its own lifecycle, because empty, still-loading and failed are
       three different statements to make to an owner about their own property and their own
       tenancy, and only the first of them is true when the array is empty. The picker that consumes
       these renders a bare empty array as settled fact, so the status is what lets it hold its
       tongue until it knows. */
    myApprovedListings,
    myApprovedListingsStatus,
    myApprovedListingsError,
    retryMyApprovedListings,
    myTenancies,
    myTenanciesStatus,
    myTenanciesError,
    retryMyTenancies,
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
