import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useScrollReveal } from '../../../lib/useScrollReveal.js';
import useAsyncList from '../../../hooks/useAsyncList.js';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { usePostChooser } from '../../../context/PostChooserContext.jsx';
import { digits } from '../../../lib/contact.js';
import { useSignInGate } from '../../../lib/useSignInGate.js';
import { recordAskLocally, rememberAsk } from '../../../lib/data/flatmates.js';
import { toRentalCards } from '../../../lib/data/tenancy.js';
import * as flatmateService from '../../../services/flatmateService.js';
import * as propertyService from '../../../services/propertyService.js';
import * as rentService from '../../../services/rentService.js';
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

/* The provider merges the seed and drops moderated rows, so a flagged post disappears from the
   public board — but not from the owner's dashboard, which labels it instead. */
const MY_PAGE = 200;
const interestKey = ({ kind, targetId }) => (kind === 'room' || kind === 'group' ? `${kind}-${targetId}` : targetId);

/* The shortlist speaks two dialects: cards key their bookmark `r:|g:|s:`, while the server names
   the table (`room|group|post`) because a flatmate save has no single id space. */
const SAVE_KIND_BY_PREFIX = { r: 'room', g: 'group', s: 'post' };
const SAVE_PREFIX_BY_KIND = { room: 'r', group: 'g', post: 's' };
const savedKey = (kind, id) => `${SAVE_PREFIX_BY_KIND[kind] || 's'}:${id}`;
/** `'r:abc'` → `{ kind: 'room', id: 'abc' }`; `null` for anything that does not parse. */
const parseSavedKey = (key) => {
  const kind = SAVE_KIND_BY_PREFIX[String(key).slice(0, 1)];
  const id = String(key).slice(2);
  return kind && id ? { kind, id } : null;
};

/* Only meaningful on a status-complete read: public search is floored to approved and carries no
   `status`. Three spellings, because moderation and the older verification flows both write it. */
const isApproved = (listing) => /approved|verified|live/i.test(String(listing?.status || ''));

// Orchestrator: page context, the shared collections, nav state and the demand-side interactions.
// Discovery and supply are composed as sub-hooks and spread into the public shape.
export function useFlatmates() {
  const rootRef = useScrollReveal([]);
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const sendToSignIn = useSignInGate();
  const [params] = useSearchParams();
  const urlTab = params.get('view');
  // `normalizeTab` also resolves legacy ?view=flatmates|rooms|groups, so old deep links and saved
  // alerts land somewhere sensible.
  const [tab, setTab] = useState(() => normalizeTab(urlTab));
  const { openPostChooser } = usePostChooser();
  const [viewMode, setViewMode] = useState('list');
  const [myPosts, myPostsStatus, setMyPosts] = useAsyncList(
    () => user ? flatmateService.myFlatmatePosts({ size: MY_PAGE }).then((page) => page.items) : Promise.resolve([]),
    [user?.mobile],
  );
  /* Owner-scoped supply identifies the caller without exposing host details in public feeds. */
  const [myGroups, , setMyGroups] = useAsyncList(
    () => user ? flatmateService.myFlatmateGroups({ size: MY_PAGE }).then((page) => page.items) : Promise.resolve([]),
    [user?.mobile],
  );
  const [myRooms, , setMyRooms] = useAsyncList(
    () => user ? flatmateService.myFlatmateRooms({ size: MY_PAGE }).then((page) => page.items) : Promise.resolve([]),
    [user?.mobile],
  );
  /* Supply handlers access discovery callbacks through this ref after discovery is initialized. */
  const searchRef = useRef({ refresh: () => {}, patchItems: () => {} });
  /* Expose room-only optimistic updates and merge their patches back into the mixed result page. */
  const setRooms = useCallback((updater) => {
    searchRef.current.patchItems((items) => {
      const patched = updater(items.filter((x) => x.kind === 'room'));
      const byId = new Map(patched.map((r) => [r.id, r]));
      return items.map((x) => (x.kind === 'room' && byId.has(x.id) ? byId.get(x.id) : x));
    });
  }, []);
  /* Server-backed and caller-scoped, so it is restored on identity change: a browser-local map
     made a room bookmarked on a phone invisible on a laptop. */
  const [saved, setSaved] = useState({});
  useEffect(() => {
    let alive = true;
    if (!user) { setSaved({}); return () => { alive = false; }; }
    flatmateService.listFlatmateSaveKeys()
      .then((rows) => {
        if (!alive) return;
        setSaved(Object.fromEntries(rows.map((row) => [savedKey(row.kind, row.id), true])));
      })
      .catch((error) => {
        if (alive) {
          setSaved({});
          console.warn('[flatmates] saves failed', error);
        }
      });
    return () => { alive = false; };
  }, [user?.mobile]);
  /* The sent-interest outbox is the CTA's source of truth, and it is the provider's answer rather
     than this browser's taps — a second device would otherwise offer a duplicate action. */
  const [interests, setInterests] = useState({});
  useEffect(() => {
    let alive = true;
    if (!user) { setInterests({}); return () => { alive = false; }; }
    flatmateService.myFlatmateInterests()
      .then((rows) => {
        if (!alive) return;
        setInterests(Object.fromEntries(rows.map((row) => [interestKey(row), true])));
      })
      .catch((error) => {
        if (alive) {
          setInterests({});
          console.warn('[flatmates] interests failed', error);
        }
      });
    return () => { alive = false; };
  }, [user?.mobile]);
  const [reportTarget, setReportTarget] = useState(null);

    /* Supply mutations await owner-scoped refreshes before reporting success.
      Discovery owns the board-search refresh lifecycle. */
  const refresh = useCallback(async () => {
    searchRef.current.refresh();
    const [mine, mineGroups, mineRooms] = await Promise.allSettled([
      flatmateService.myFlatmatePosts({ size: MY_PAGE }).then((page) => page.items),
      flatmateService.myFlatmateGroups({ size: MY_PAGE }).then((page) => page.items),
      flatmateService.myFlatmateRooms({ size: MY_PAGE }).then((page) => page.items),
    ]);
    if (mine.status === 'fulfilled') setMyPosts(mine.value); else console.warn('[flatmates] my posts failed', mine.reason);
    if (mineGroups.status === 'fulfilled') setMyGroups(mineGroups.value); else console.warn('[flatmates] my groups failed', mineGroups.reason);
    if (mineRooms.status === 'fulfilled') setMyRooms(mineRooms.value); else console.warn('[flatmates] my rooms failed', mineRooms.reason);
  }, [setMyPosts, setMyGroups, setMyRooms]);

  const myGroupIds = useMemo(() => new Set(myGroups.map((g) => g.id).filter(Boolean)), [myGroups]);
  const myRoomIds = useMemo(() => new Set(myRooms.map((r) => r.id).filter(Boolean)), [myRooms]);

  const myPost = myPosts[0] || null;
  // Matches tolerantly by the last 10 mobile digits, falling back to name. Only user-created
  // groups carry ownerMobile/ownerName, so seed groups never show owner controls.
  const ownsGroup = (g) => {
    if (!user || !g) return false;
    // The authoritative answer, and the only one a public feed row can support (see `myGroups`).
    if (g.id && myGroupIds.has(g.id)) return true;
    const owner = digits(g.ownerMobile).slice(-10);
    // Require an exact mobile match and never fall through to the weaker name check, so a name
    // collision cannot grant owner controls over someone else's post.
    if (owner) { const mine = digits(user.mobile).slice(-10); return !!mine && mine === owner; }
    const nm = (user.name || '').trim().toLowerCase();
    return !!nm && !!g.ownerName && g.ownerName.trim().toLowerCase() === nm;
  };
  const ownsRoom = (r) => {
    if (!user || !r) return false;
    if (r.id && myRoomIds.has(r.id)) return true;
    const owner = digits(r.ownerMobile).slice(-10);
    if (owner) { const mine = digits(user.mobile).slice(-10); return !!mine && mine === owner; }
    const nm = (user.name || '').trim().toLowerCase();
    return !!nm && !!r.owner && r.owner.trim().toLowerCase() === nm;
  };
  const supply = useFlatmateSupply({ refresh, setRooms, user, authLoading, toast, t, nav: navigate, setInterests, ownsGroup, ownsRoom, myPost, myPostsStatus });
  const { groupOpen, isVerified, setVerifyOpen, openPostModal } = supply;

  /* The owner's own Ops-verified listings, offered when they create a group as the owner. Why the
     owner-scoped read: `docs/system/frontend-data-seam.md` § Owner-scoped pickers. */
  const [myApprovedListings, myApprovedListingsStatus, , retryMyApprovedListings, myApprovedListingsError] = useAsyncList(
    () => propertyService.myListings(user).then((list) => list.filter(isApproved)),
    [user?.mobile, groupOpen],
    !!user,
  );
  /* The caller's active tenancies, so a sitting tenant can post a replacement in a tap. Why
     `toRentalCards`: `docs/system/frontend-data-seam.md` § Owner-scoped pickers. */
  const [myTenancies, myTenanciesStatus, , retryMyTenancies, myTenanciesError] = useAsyncList(
    () => rentService.myTenancies()
      .then((list) => list.filter((tenancy) => tenancy.status !== 'ended'))
      .then(toRentalCards),
    [user?.mobile, groupOpen],
    !!user,
  );

  const discovery = useFlatmateDiscovery({ tab, setTab, viewMode, t, toast, myPost, openPostModal, onPost: openPostChooser });
  const { setF, activeList } = discovery;
  searchRef.current = { refresh: discovery.refreshSearch, patchItems: discovery.patchItems };

  /* Maps review state for rendered cards; verified filtering remains server-side. */
  const reviewMap = useMemo(() => {
    const map = {};
    activeList.forEach((row) => {
      if (row?.id && row.reviewStatus) map[row.id] = row.reviewStatus;
    });
    return map;
  }, [activeList]);

  /* Optimistic, then reconciled: a bookmark that waits for a round trip feels broken. Signed out,
     the tap goes to sign-in — an anonymous list could never be merged into the real one. */
  const onSave = async (k) => {
    const key = parseSavedKey(k);
    if (!key) return;
    if (!user) { sendToSignIn('save'); return; }
    const next = !saved[k];
    const apply = (on) => setSaved((m) => {
      const n = { ...m };
      if (on) n[k] = true; else delete n[k];
      return n;
    });
    apply(next);
    try {
      if (next) await flatmateService.saveFlatmatePost(key.kind, key.id);
      else await flatmateService.unsaveFlatmatePost(key.kind, key.id);
    } catch (e) {
      // Put it back. A bookmark that stays filled over a save the server never recorded is the one
      // failure mode the user cannot see until the shortlist is empty.
      apply(!next);
      console.warn('[flatmates] save toggle failed', e);
      toast(t('flatmates.saveFailed'), 'error');
    }
  };
    /* The server owns interest records; this hook owns optimistic button state.
      Duplicate conflicts remain server-resolved rather than being suppressed client-side. */
  const onInterest = async (r) => {
    if (!user) { sendToSignIn('contact'); return; }
    if (r.verifiedContactOnly && !isVerified) { toast(t('flatmates.acceptsVerifiedOnlyToast', { name: r.name }), 'error'); setVerifyOpen(true); return; }
    const ask = {
      request: { propertyId: r.id, property: { title: 'Flatmate: ' + r.name, price: r.budget ? '₹' + r.budget + '/mo' : '', loc: (r.localities || [])[0] || 'Pune', img: FLATMATE_IMG }, party: { name: r.name, avatar: (r.name || 'U').slice(0, 2).toUpperCase() }, firstMessage: SEEKER_OPENER },
    };
    setInterests((m) => ({ ...m, [r.id]: true }));
    try {
      await flatmateService.postInterest(r.id, { share: 'solo', message: SEEKER_OPENER });
    } catch (err) {
      if (err?.code === flatmateService.CONFLICT_ALREADY_INTERESTED) {
        rememberAsk(user.mobile, r.id);
        recordAskLocally(ask);
        toast(t('flatmates.interestAlreadyRecorded', { name: r.name }));
        return;
      }
      setInterests((m) => { const n = { ...m }; delete n[r.id]; return n; });
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    rememberAsk(user.mobile, r.id);
    // The Messages hand-off (mirrors HTML flatmates.html behavior).
    recordAskLocally(ask);

    toast(t('flatmates.interestSentToast', { name: r.name }));
  };

  // Rooms use a distinct interest key and payload, so they get their own handler. `share` carries
  // how the seeker intends to take the room — the owner needs to know whether one person or two.
  const onRoomInterest = async (room, share = 'solo') => {
    if (!user) { sendToSignIn('contact'); return; }
    const key = 'room-' + room.id;
    const opener = SHARE_OPENER[share] || SHARE_OPENER.solo;
    // Room view models provide `photos`, so the chat preview uses its first photo as a fallback.
    const ask = {
      request: { propertyId: key, property: { title: 'Room in ' + room.society, price: room.budget ? '₹' + room.budget + '/mo' : '', loc: (room.localities || [])[0] || 'Pune', img: room.img || room.photos?.[0] || FLATMATE_IMG }, party: { name: room.society, avatar: (room.society || 'RM').slice(0, 2).toUpperCase() }, firstMessage: opener },
    };
    setInterests((m) => ({ ...m, [key]: true }));
    try {
      await flatmateService.roomInterest(room.id, { share, message: opener });
    } catch (err) {
      if (err?.code === flatmateService.CONFLICT_ALREADY_INTERESTED) {
        rememberAsk(user.mobile, key);
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

  // Cards pass a target descriptor; rooms map to the admin "listings" queue, flatmates and groups
  // to the "users" queue.
  const onReport = (target) => setReportTarget(target);

  // Interest state is device-scoped; repeat requests remain a server-resolved conflict.
  const interestedFor = (item) => {
    if (!item) return false;
    if (item.kind === 'room') return !!interests['room-' + item.id];
    if (item.kind === 'group') return !!interests['group-' + item.id];
    return !!interests[item.id];
  };

  // No detail route exists for flatmate posts — every post lives on the list, so "Go to posting"
  // switches to the list, narrows to the locality, then scrolls to and highlights the card.
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
  /* Rerun when rendered results change so an awaited card can be found. */
  }, [pendingScroll, viewMode, activeList]);

  return {
    rootRef,
    t,
    user,
    toast,
    tab,
    setTab,
    openPostChooser,
    viewMode,
    setViewMode,
    myPost,
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
    feedFailed: discovery.searchStatus === 'error',
    feedError: discovery.searchError,
    retryFeeds: discovery.retrySearch,
    ...discovery,
    ...supply,
    emptyFilters,
    MAP_MAX_AREAS,
  };
}
