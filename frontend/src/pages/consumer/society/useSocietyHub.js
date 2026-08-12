import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { useScrollReveal } from '../../../lib/useScrollReveal.js';
import { useSocietyCatalogue } from '../../../lib/useSocietyCatalogue.js';
import { fmtNum } from '../../../lib/format.js';
import { listProperties } from '../../../services/propertyService.js';
import { fnvHash } from '../../../lib/hash.js';
import { listingsInSociety } from '../../../data/societies.js';
import { commuteInfo, connectivityFor } from '../property/locationIntel.js';
import { createEntityReview, getEntityReviewSummary, listEntityReviews } from '../../../services/reviewService.js';
import { useOtpFlow } from '../../../components/auth/useOtpFlow.js';
import {
  digits,
  isSocietyFollowed, toggleFollowSociety,
  getSocietyQA, addSocietyQuestion, addSocietyAnswer,
  resolveSociety, requestSocietyClaim,
  residentStatus, requestResidentVerification,
  verifiedResidentForUnit, unitKeyOf,
  isSocietyAdmin, committeeResidentReqs, setResidentStatus,
  suggestSocietyDetails, getSocietySuggestion,
  getSocietyContributions,
  addSocietyContribution, toggleContributionHelpful, removeSocietyContribution,
  addContributionReply, removeContributionReply,
  getSocietyBoard, addBoardItem, removeBoardItem,
  getSocietyWhatsappJoin, hasSocietyWhatsapp, getSocietyWhatsappRaw, proposeSocietyWhatsapp,
  reportSocietyContent,
  getSocietyLocationFix, proposeSocietyLocation,
} from '../../../lib/store.js';
import { TAB_IDS, REVIEW_CATS, REVIEW_CAT_KEYS, NOW_YEAR, HERO, CONTRIB_META, BOARD_META, ymd, titleCase } from './constants.js';
import { genericSociety } from './helpers.jsx';

export function useSocietyHub() {
  const rootRef = useScrollReveal();
  const { slug: routeSlug } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { isIn, user } = useAuth();
  const { toast } = useToast();
  const { flagEnabled } = useAppFlags();
  const saasOn = flagEnabled('societySaaS');

  const [tick, setTick] = useState(0);
  const activeTab = useMemo(() => {
    const urlTab = params.get('tab');
    return TAB_IDS.includes(urlTab) ? urlTab : 'overview';
  }, [params]);
  const slug = (routeSlug || params.get('s') || 'skyline-heights-baner').toLowerCase();
  const fallbackName = params.get('name');
  const fallbackLoc = params.get('loc') || 'Pune';
  // 320 of the 348 slugs this route serves live in the bulk chunk (D129), and
  // `resolveSociety` answers null until it lands. Without this gate every one of
  // them renders `genericSociety` — a fabricated row — and never corrects itself.
  const catalogueReady = useSocietyCatalogue();
  const soc = useMemo(() => {
    const resolved = resolveSociety(slug);
    if (!resolved) return genericSociety(slug, fallbackName, fallbackLoc);
    // A "thin" community/demand-minted row carries only name + locality. We DON'T
    // backfill fabricated specs — the hub renders only fields we actually hold,
    // and shows an honest "add details" state for the rest.
    const thin = resolved.units == null && !resolved.builder;
    const community = resolved.tier === 'community';
    return { ...resolved, _thin: thin, _community: community };
  }, [slug, tick, fallbackName, fallbackLoc, catalogueReady]); // eslint-disable-line react-hooks/exhaustive-deps -- `tick` and `catalogueReady` are invalidation signals for the module-level society store, which the rule cannot see. See `lib/useSocietyCatalogue.js`.
  const locName = soc._locName || titleCase(soc.localitySlug);

  const [listings, setListings] = useState([]);
  const [reviews, setReviews] = useState([]);
  // `null` until the summary read settles; `summaryFailed` keeps "could not read" distinguishable
  // from "count is 0", which is the difference between an outage and an unreviewed society.
  const [summary, setSummary] = useState(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [qa, setQa] = useState([]);
  const [followed, setFollowed] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [pick, setPick] = useState(5);
  /**
   * Per-aspect sub-ratings, keyed by `REVIEW_CATS` id.
   *
   * Starts empty and only gains a key when the reviewer actually taps that row, so "did not rate
   * Connectivity" stays distinguishable from "rated it 1" all the way to the column. The property
   * modal does the same, and the server treats the map as optional and sparse.
   */
  const [cats, setCats] = useState({});
  const setCat = (k, v) => setCats((c) => ({ ...c, [k]: v }));
  const [revText, setRevText] = useState('');
  const [qText, setQText] = useState('');
  const [answerFor, setAnswerFor] = useState(null);
  const [aText, setAText] = useState('');
  const [claim, setClaim] = useState(false);
  const [cl, setCl] = useState({ name: '', mobile: '', role: '', regNo: '', cert: null });
  const [resStat, setResStat] = useState(null);
  const [resOpen, setResOpen] = useState(false);
  const [resStep, setResStep] = useState(1);
  const [res, setRes] = useState({ flat: '', wing: '', note: '', proofType: 'maintenance', doc: null });
  const [sugOpen, setSugOpen] = useState(false);
  const [sug, setSug] = useState({ builder: '', year: '', towers: '', units: '', amenities: [] });
  const [sugRec, setSugRec] = useState(null);
  const [contribs, setContribs] = useState([]);
  const [contribFilter, setContribFilter] = useState('all');
  const [contribOpen, setContribOpen] = useState(false);
  const [cKind, setCKind] = useState('tip');
  const [cForm, setCForm] = useState({ category: '', text: '', name: '', contact: '', note: '', caption: '', photo: null });
  const otp = useOtpFlow();
  // Threaded replies + reporting
  const [replyFor, setReplyFor] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [reportFor, setReportFor] = useState(null); // { targetType, targetId, parentId?, entityId?, snapshot }
  const [reportReason, setReportReason] = useState('');
  // Events & notices board
  const [board, setBoard] = useState([]);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [calDay, setCalDay] = useState(ymd(new Date()));
  const [boardOpen, setBoardOpen] = useState(false);
  const [bKind, setBKind] = useState('event');
  const [bForm, setBForm] = useState({ title: '', body: '', category: '', date: ymd(new Date()), time: '' });
  // WhatsApp group — invite is private (resident-only); waExists just flags it.
  const [wa, setWa] = useState(null);
  const [waExists, setWaExists] = useState(false);
  const [waRaw, setWaRaw] = useState(null);
  const [waOpen, setWaOpen] = useState(false);
  const [waUrl, setWaUrl] = useState('');
  // Location correction (resident-proposed → ops-approved)
  const [locFix, setLocFix] = useState(null);
  const [locOpen, setLocOpen] = useState(false);

  /**
   * Keyed on `soc.slug`, not `soc.id`.
   *
   * Every other call on this page — follow, Q&A, resident status, board, WhatsApp — already used the
   * slug; reviews were the one holdout. That mattered once the target became the server: `soc.id` is
   * a synthetic `S01` minted by `data/societies.js`, whereas the database keys societies by UUID and
   * accepts the slug as an alias. The slugs agree across both (`green-meadows-baner`), the ids never
   * could, so this was the difference between reviews resolving and silently returning nothing.
   */
  useEffect(() => {
    let alive = true;
    setSummary(null);
    setSummaryFailed(false);
    listEntityReviews('society', soc.slug)
      .then((res) => { if (alive) setReviews(res.items); })
      .catch(() => { if (alive) setReviews([]); });
    /**
     * A second, independent read — not derived from the list above.
     *
     * The list is a page (20 server-side); the summary is the whole corpus. Reading them separately
     * is also what keeps one failing without the other: a summary that 404s must not blank the
     * cards, and cards that fail to load must not be mistaken for a rating of zero. Hence a distinct
     * `summaryFailed` rather than falling back to a zero-shaped summary — an unreadable rating and a
     * society nobody has rated are different facts, and only one of them is the page's fault.
     */
    getEntityReviewSummary('society', soc.slug)
      .then((s) => { if (alive) setSummary(s); })
      .catch(() => { if (alive) setSummaryFailed(true); });
    return () => { alive = false; };
  }, [soc.slug]);

  useEffect(() => {
    setQa(getSocietyQA(soc.slug));
    setFollowed(isSocietyFollowed(soc.slug));
    setResStat(residentStatus(soc.slug));
    setSugRec(getSocietySuggestion(soc.slug));
    setContribs(getSocietyContributions(soc.slug));
    setContribFilter('all');
    setBoard(getSocietyBoard(soc.slug));
    setWa(getSocietyWhatsappJoin(soc.slug));
    setWaExists(hasSocietyWhatsapp(soc.slug));
    setWaRaw(getSocietyWhatsappRaw(soc.slug));
    setLocFix(getSocietyLocationFix(soc.slug));
    setReplyFor(null); setReportFor(null); setBoardOpen(false); setWaOpen(false); setLocOpen(false);
    let alive = true;
    listProperties({}).then((all) => { if (alive) setListings(soc._generic ? [] : listingsInSociety(all, soc.id)); });
    return () => { alive = false; };
  }, [soc]);

  useEffect(() => {
    if (!claim && !resOpen && !boardOpen && !waOpen && !reportFor) return;
    const onKey = (e) => { if (e.key === 'Escape') { closeClaim(); closeResident(); setBoardOpen(false); setWaOpen(false); setReportFor(null); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [claim, resOpen, boardOpen, waOpen, reportFor]);

  /**
   * The rating comes from `GET /reviews/society/{slug}/summary`, never from the list on screen.
   *
   * This used to reduce `reviews` in the browser. That is wrong for a reason that has nothing to do
   * with performance: `listEntityReviews` is **paged at 20 server-side**, so any society past twenty
   * reviews was showing the mean of its twenty most recent ones and calling it the society's rating.
   *
   * `Society.avgRating` / `reviewCount` — which an earlier note here named as the eventual authority
   * — is not it. `SocietyDetailResponse` does carry that pair, and it is a fine headline figure, but
   * it carries **no distribution and no per-aspect averages**, so it cannot feed the bars below. The
   * summary endpoint is the authority for all four numbers, and taking the average from one source
   * and the breakdown from another is how a page ends up disagreeing with itself.
   *
   * Three states, not two. `avg` is `null` rather than 0 when nobody has reviewed — no rating is not
   * a rating of zero — and `failed` is kept separate from `count === 0` so the tab can say the
   * rating is unavailable instead of quietly claiming the society is unreviewed.
   */
  const rating = useMemo(() => ({
    avg: summary ? summary.avg : null,
    count: summary ? summary.count : 0,
    loading: !summary && !summaryFailed,
    failed: summaryFailed,
  }), [summary, summaryFailed]);
  /**
   * Per-aspect means from the summary's `catAvg` — resident answers, and nothing else.
   *
   * These used to be blended 50/50 with `baselineBars`, a deterministic per-society estimate seeded
   * off occupancy and build year. Every curated society therefore drew five confident bars whether
   * or not a resident had ever rated one, and where a resident *had*, the number shown was half
   * theirs: a lone 2.0 against a 4.1 baseline displayed as 3.1 while the label next to it read
   * "(1)". D197 deleted the baseline. A bar now exists only where somebody put a number behind it.
   *
   * `catAvg` is sparse — an aspect nobody rated is absent, not 0 — and each present aspect is
   * averaged over the reviews that answered *it*, so the `Number.isFinite` guard is the whole
   * presence test, and a partly-rated society draws a partial grid rather than a padded one. Each
   * cell carries its own label, so three bars read as three aspects rather than as a total.
   *
   * These ids (`Safety`, `Maintenance`, …) are the server's vocabulary for a society target —
   * `ReviewCategories.SOCIETY_KEYS`. Before that split the server only knew the *property* aspects
   * and filtered every key here straight back out of the aggregate, which is precisely why the
   * baseline went unnoticed for so long: it was the only thing these bars had ever shown. The fix
   * had to be a second vocabulary rather than a mapping — reading `condition` as "Maintenance"
   * would put a number under a label it does not mean.
   */
  const bars = useMemo(() => {
    const catAvg = summary?.catAvg || {};
    return REVIEW_CATS.filter((k) => Number.isFinite(catAvg[k])).map((k) => ({ id: k, labelKey: REVIEW_CAT_KEYS[k], value: catAvg[k] }));
  }, [summary]);
  /**
   * The headline number is the residents' average and nothing else.
   *
   * `null` rather than `0` when nobody has rated it. Not a defence — `Stars` does
   * `Math.round(Number(value) || 0)`, so `null` and `0` draw the same empty strip, and the guard
   * that actually keeps either off the page is the `rating.count` branch at each call site. It is a
   * *signal*: `0` is a number a future caller would happily print beside those stars, and "0/5" on
   * an unreviewed society is the same false claim the baseline was making, just quieter. `null`
   * makes the missing case unmistakable to anyone who forgets the branch.
   *
   * `Number.isFinite` is the second condition and it is not redundant with `count`: the summary
   * contract allows `avgRating: null`, so a count with no usable average is expressible on the wire.
   * It resolves to `null` here rather than `NaN`, which the http mapper also collapses to `count: 0`
   * one layer down — belt and braces, because the two are read off the payload independently.
   */
  const overall = useMemo(() => {
    const rated = rating.count > 0 && Number.isFinite(rating.avg);
    return rated ? +rating.avg.toFixed(1) : null;
  }, [rating]);

  const priceStats = useMemo(() => {
    const buys = listings.filter((l) => l.deal === 'buy' && l.area);
    const rents = listings.filter((l) => l.deal === 'rent');
    return {
      psf: buys.length ? Math.round(buys.reduce((s, l) => s + l.price / l.area, 0) / buys.length) : null,
      rentAvg: rents.length ? Math.round(rents.reduce((s, l) => s + l.price, 0) / rents.length) : null,
      forSale: buys.length, forRent: rents.length,
    };
  }, [listings]);

  const commute = commuteInfo(soc.lat, soc.lng);
  const nearby = connectivityFor({ localitySlug: soc.localitySlug });
  const hasCoords = soc.lat != null && soc.lng != null;
  const dirUrl = hasCoords
    ? 'https://www.google.com/maps/dir/?api=1&destination=' + Number(soc.lat) + ',' + Number(soc.lng) + (soc.placeId ? '&destination_place_id=' + encodeURIComponent(soc.placeId) : '')
    : null;
  const age = soc.year ? NOW_YEAR - soc.year : null;
  const hero = HERO[fnvHash(soc.slug) % HERO.length];
  const verified = soc.registration && soc.conveyance;
  const claimed = soc.claimStatus === 'claimed';
  const claimPending = soc.claimStatus === 'pending';
  const iAmResident = resStat && resStat.status === 'verified';
  const iAmAdmin = !soc._generic && isSocietyAdmin(soc.slug);
  const committee = useMemo(() => (iAmAdmin ? committeeResidentReqs(soc.slug) : []), [iAmAdmin, soc.slug, tick]);
  // Live warning while typing: is this exact unit already held by a verified resident?
  const unitTaken = useMemo(() => {
    const holder = verifiedResidentForUnit(soc.slug, unitKeyOf(res.wing, res.flat));
    return !!holder && holder.mobile !== digits((user || {}).mobile);
  }, [soc.slug, res.wing, res.flat, user]);

  const requireLogin = () => { if (!isIn) { nav('/signin?next=' + encodeURIComponent('/society/' + soc.slug)); return false; } return true; };
  const refreshCommittee = (r, status) => {
    const out = setResidentStatus(r.slug, r.mobile, status, (user || {}).name || 'Committee');
    if (out === 'conflict') { toast('This unit is already held by another verified resident — can\u2019t verify.', 'error'); return; }
    setTick((t) => t + 1);
    toast(status === 'verified' ? `Verified ${r.name} as a resident` : 'Request rejected', status === 'verified' ? 'success' : 'info');
  };

  const onFollow = () => {
    if (!requireLogin()) return;
    const now = toggleFollowSociety(soc.slug);
    setFollowed(now);
    toast(now ? `Following ${soc.name} — we'll alert you on new listings` : 'Unfollowed', now ? 'success' : 'info');
  };
  const submitReview = () => requireSignedIn(() => {
    /**
     * No `resident` flag.
     *
     * This used to send `resident: isVerifiedResident(soc.slug)` — a client-side lookup, stored
     * alongside the review and rendered as a "Verified resident" badge. The server derives standing
     * itself and its `ReviewCreate` has no such field, so the flag was believed on mocks and
     * discarded live. A badge that a browser can assert about itself is not evidence, and evidence
     * is the only thing that makes a stranger's rating worth reading.
     *
     * `categories` **is** sent, and only the aspects the reviewer touched. The keys are the hub's
     * own `REVIEW_CATS` ids, which the server now accepts for a society target and refuses for a
     * property one — so a typo here is a 400 rather than a bar that silently stays at the baseline
     * forever, which is how this went unnoticed in the first place.
     */
    createEntityReview('society', soc.slug, { rating: pick, text: revText.trim(), categories: cats })
      .then((saved) => (saved === 'login'
        ? null
        // Both, because the rating is no longer derived from the list — re-reading only the cards
        // would leave the headline showing the average from before the user's own review.
        : Promise.all([
          listEntityReviews('society', soc.slug),
          getEntityReviewSummary('society', soc.slug),
        ])))
      .then((res) => {
        if (!res) return;
        const [list, sum] = res;
        setReviews(list.items); setSummary(sum); setSummaryFailed(false);
        setRevText(''); setPick(5); setCats({}); setRateOpen(false);
        toast('Thanks for reviewing this society!', 'success');
      })
      .catch(() => toast('Your review could not be posted. Please try again.', 'error'));
  });
  const submitQuestion = () => {
    if (!qText.trim()) return;
    requireSignedIn(() => {
      const out = addSocietyQuestion(soc.slug, qText);
      if (out === 'login') return;
      setQa(getSocietyQA(soc.slug)); setQText(''); toast('Question posted', 'success');
    });
  };
  const submitAnswer = (qId) => {
    const val = aText.trim();
    if (!val) return;
    requireSignedIn(() => {
      const out = addSocietyAnswer(soc.slug, qId, val);
      if (out === 'login' || !out) return;
      setQa(getSocietyQA(soc.slug)); setAText(''); setAnswerFor(null);
    });
  };
  const closeClaim = () => { setClaim(false); setCl({ name: '', mobile: '', role: '', regNo: '', cert: null }); };
  const submitClaim = () => {
    if (!cl.name.trim()) { toast('Add your name', 'error'); return; }
    if (digits(cl.mobile).length !== 10) { toast('Enter a valid 10-digit mobile', 'error'); return; }
    if (!requireLogin()) return;
    const c = requestSocietyClaim({
      slug: soc.slug, society: soc.name, loc: locName, name: cl.name.trim(),
      mobile: digits(cl.mobile), role: cl.role.trim(), regNo: cl.regNo.trim(), cert: cl.cert,
    });
    if (c === 'login') return;
    if (c === 'exists') { toast('This society already has an onboarding request under review.', 'error'); return; }
    setTick((t) => t + 1); closeClaim();
    toast('Onboarding request received — our team will verify the committee & reach out!', 'success');
  };
  const closeResident = () => { setResOpen(false); setResStep(1); setRes({ flat: '', wing: '', note: '', proofType: 'maintenance', doc: null }); otp.setOtp(''); };
  const resToStep2 = () => {
    if (!res.flat.trim()) { toast('Add your flat / unit number', 'error'); return; }
    if (!requireLogin()) return;
    setResStep(2);
    if (!otp.otpSent) otp.send();
  };
  const submitResident = () => {
    if (otp.otp.length !== 6) { otp.setOtpError(true); toast('Enter the 6-digit OTP sent to your mobile', 'error'); return; }
    if (!requireLogin()) return;
    const r = requestResidentVerification(soc.slug, {
      flat: res.flat.trim(), wing: res.wing.trim(), note: res.note.trim(),
      proofType: res.proofType, doc: res.doc, otpVerified: true,
    });
    if (r === 'login') return;
    setResStat(r); setTick((t) => t + 1); closeResident();
    toast('Residence verification submitted — we\u2019ll confirm your Resident badge shortly', 'success');
  };

  const openSuggest = () => {
    if (!requireLogin()) return;
    const s = getSocietySuggestion(soc.slug);
    const f = (s && s.status === 'pending' && s.fields) || {};
    setSug({
      builder: f.builder || (soc._community ? '' : soc.builder || ''),
      year: f.year || (soc._community ? '' : soc.year || ''),
      towers: f.towers || (soc._community ? '' : soc.towers || ''),
      units: f.units || (soc._community ? '' : soc.units || ''),
      amenities: f.amenities || (soc._community ? [] : soc.amenities || []),
    });
    setSugOpen(true);
  };
  const toggleSugAmenity = (a) => setSug((s) => ({ ...s, amenities: s.amenities.includes(a) ? s.amenities.filter((x) => x !== a) : [...s.amenities, a] }));
  const submitSuggest = () => {
    if (!requireLogin()) return;
    const rec = suggestSocietyDetails(soc.slug, { ...sug, name: soc.name, localitySlug: soc.localitySlug }, (user || {}).mobile);
    if (!rec) { toast('Add at least one detail to suggest.', 'error'); return; }
    setSugRec(rec); setSugOpen(false);
    toast('Thanks! Your details were sent for review.', 'success');
  };

  // Sign-in gate for community contributions (badge-not-gate, ADR-019): L1
  // mobile-verified sign-in is the only floor — identity verification is a badge,
  // never required to participate. Resident/committee-only actions add their own
  // check on top (see requireResident).
  const requireSignedIn = (fn) => {
    if (!isIn) { nav('/signin?next=' + encodeURIComponent('/society/' + soc.slug)); return; }
    fn();
  };
  const refreshContribs = () => setContribs(getSocietyContributions(soc.slug));
  const openContribute = (kind) => requireSignedIn(() => {
    setCKind(kind);
    setCForm({ category: CONTRIB_META[kind].cats[0], text: '', name: '', contact: '', note: '', caption: '', photo: null });
    setContribOpen(true);
  });
  const submitContribution = () => {
    const rec = addSocietyContribution(soc.slug, { kind: cKind, ...cForm });
    if (rec === 'login') { nav('/signin?next=' + encodeURIComponent('/society/' + soc.slug)); return; }
    if (!rec) { toast(cKind === 'pick' ? 'Add the person / service name.' : cKind === 'photo' ? 'Add a photo to share.' : 'Write your tip first.', 'error'); return; }
    refreshContribs(); setContribOpen(false);
    toast('Thanks for contributing to this community!', 'success');
  };
  const onHelpful = (id) => requireSignedIn(() => {
    const out = toggleContributionHelpful(soc.slug, id);
    if (out === 'login') return;
    refreshContribs();
  });
  const onRemoveContribution = (id) => {
    const out = removeSocietyContribution(soc.slug, id);
    if (out === 'forbidden' || out === 'login') { toast('You can only remove your own contribution.', 'error'); return; }
    refreshContribs();
    toast('Contribution removed', 'info');
  };

  // Threaded replies on a contribution (sign-in only).
  const openReply = (id) => requireSignedIn(() => { setReplyFor(id); setReplyText(''); });
  const submitReply = (id) => {
    const val = replyText.trim();
    if (!val) return;
    requireSignedIn(() => {
      const out = addContributionReply(soc.slug, id, val);
      if (out === 'login' || !out) return;
      refreshContribs(); setReplyFor(null); setReplyText('');
    });
  };
  const onRemoveReply = (id, rid) => {
    const out = removeContributionReply(soc.slug, id, rid);
    if (out === 'forbidden' || out === 'login') { toast('You can only remove your own reply.', 'error'); return; }
    refreshContribs();
  };

  // Report any hub content → ops moderation queue (sign-in only).
  const openReport = (target) => requireSignedIn(() => { setReportFor(target); setReportReason(''); });
  const submitReport = () => {
    if (!reportFor) return;
    const out = reportSocietyContent({ slug: soc.slug, entityId: soc.id, reason: reportReason, ...reportFor });
    if (out === 'login') { setReportFor(null); nav('/signin?next=' + encodeURIComponent('/society/' + soc.slug)); return; }
    if (out === 'dup') { toast('You already reported this — our team is on it.', 'info'); setReportFor(null); return; }
    if (!out) { toast('Could not submit report.', 'error'); return; }
    setReportFor(null); toast('Reported. Thanks — our team will review it.', 'success');
  };

  // Events & notices — posting limited to verified residents / committee.
  const requireResident = (fn) => requireSignedIn(() => {
    if (!(iAmResident || iAmAdmin)) { toast('Only verified residents or the committee can post this.', 'error'); return; }
    fn();
  });
  const refreshBoard = () => setBoard(getSocietyBoard(soc.slug));
  const openBoard = (kind) => requireResident(() => {
    setBKind(kind);
    setBForm({ title: '', body: '', category: BOARD_META[kind].cats[0], date: calDay || ymd(new Date()), time: '' });
    setBoardOpen(true);
  });
  const submitBoard = () => {
    const out = addBoardItem(soc.slug, { kind: bKind, ...bForm });
    if (out === 'login') { nav('/signin?next=' + encodeURIComponent('/society/' + soc.slug)); return; }
    if (out === 'forbidden') { toast('Only verified residents or the committee can post events.', 'error'); return; }
    if (!out) { toast(bKind === 'event' ? 'Add a title and date.' : 'Add a title.', 'error'); return; }
    refreshBoard(); setBoardOpen(false);
    if (out.kind === 'event' && out.date) { setCalMonth(new Date(+out.date.slice(0, 4), +out.date.slice(5, 7) - 1, 1)); setCalDay(out.date); }
    toast(bKind === 'event' ? 'Event added to the calendar' : 'Notice posted', 'success');
  };
  const onRemoveBoard = (id) => {
    const out = removeBoardItem(soc.slug, id);
    if (out === 'forbidden' || out === 'login') { toast('You can only remove your own post.', 'error'); return; }
    refreshBoard(); toast('Removed', 'info');
  };

  // Resident WhatsApp group link — proposed then ops-approved.
  const openWa = () => requireResident(() => { setWaUrl((waRaw && waRaw.url) || ''); setWaOpen(true); });
  const submitWa = () => {
    const out = proposeSocietyWhatsapp(soc.slug, waUrl.trim());
    if (out === 'login') { nav('/signin?next=' + encodeURIComponent('/society/' + soc.slug)); return; }
    if (out === 'forbidden') { toast('Only verified residents or the committee can add the group link.', 'error'); return; }
    if (out === 'badurl') { toast('Enter a valid WhatsApp invite link (https://chat.whatsapp.com/…).', 'error'); return; }
    setWaRaw(out); setWa(getSocietyWhatsappJoin(soc.slug)); setWaExists(hasSocietyWhatsapp(soc.slug)); setWaOpen(false);
    toast('Sent for review — verified residents can join once our team approves it.', 'success');
  };

  // Resident-proposed location correction — pending until ops approve.
  const openLocation = () => requireResident(() => setLocOpen(true));
  const submitLocation = ({ lat, lng, placeId, label }) => {
    const out = proposeSocietyLocation(soc.slug, { lat, lng, placeId, label });
    if (out === 'login') { nav('/signin?next=' + encodeURIComponent('/society/' + soc.slug)); return; }
    if (out === 'forbidden') { toast('Only verified residents or the committee can suggest the location.', 'error'); return; }
    if (out === 'bounds') { toast('That pin looks outside the city — drop it on the society.', 'error'); return; }
    if (!out) { toast('Could not submit the location.', 'error'); return; }
    setLocFix(out); setLocOpen(false);
    toast('Sent for review — the map updates once our team approves it.', 'success');
  };

  const contribCounts = useMemo(() => ({
    all: contribs.length,
    tip: contribs.filter((c) => c.kind === 'tip').length,
    pick: contribs.filter((c) => c.kind === 'pick').length,
    photo: contribs.filter((c) => c.kind === 'photo').length,
  }), [contribs]);
  const shownContribs = contribFilter === 'all' ? contribs : contribs.filter((c) => c.kind === contribFilter);
  const myMob = digits((user || {}).mobile);
  const iAmResidentOrAdmin = iAmResident || iAmAdmin;
  const boardEvents = useMemo(() => board.filter((b) => b.kind === 'event'), [board]);
  const boardNotices = useMemo(() => board.filter((b) => b.kind === 'notice'), [board]);
  const eventDots = useMemo(() => { const m = {}; boardEvents.forEach((e) => { if (e.date) m[e.date] = (m[e.date] || 0) + 1; }); return m; }, [boardEvents]);
  const dayEvents = useMemo(() => boardEvents.filter((e) => e.date === calDay).sort((a, b) => (a.time || '').localeCompare(b.time || '')), [boardEvents, calDay]);

  /* Stats and living facts carry label *keys* and, where the value itself is
     composed copy ("1.2/unit", "6 total"), a value key plus its interpolation
     args. The raw datum stays separate from its presentation so the page can
     render either language without this hook knowing which one is active. */
  const stats = [
    ['home', 'society.statUnits', soc.units != null ? fmtNum(soc.units) : null],
    ['building-2', 'society.statTowers', soc.towers != null ? String(soc.towers) : null],
    ['calendar', 'society.statBuilt', soc.year ? { key: 'society.builtValue', args: { year: soc.year, age } } : null],
    ['users', 'society.statOccupancy', soc.occupancy != null ? `${soc.occupancy}%` : null],
  ].filter((s) => s[2] != null);
  const living = [
    ['droplets', 'society.livingWater', soc.water],
    ['zap', 'society.livingPower', soc.power],
    ['car', 'society.livingParking', soc.parkingRatio != null ? { key: 'society.parkingPerUnit', args: { ratio: soc.parkingRatio } } : null],
    ['move-vertical', 'society.livingLifts', soc.lifts != null ? { key: 'society.liftsTotal', args: { count: soc.lifts } } : null],
    ['shield-check', 'society.livingSecurity', soc.security],
    ['indian-rupee', 'society.livingMaintenance', soc.maintenancePerSqft != null ? { key: 'society.maintenancePerSqft', args: { rate: soc.maintenancePerSqft } } : null],
    ['paw-print', 'society.livingPets', soc.petPolicy],
    ['utensils', 'society.livingFood', soc.vegPolicy],
  ].filter((l) => l[2] != null && l[2] !== '');
  const tabs = [
    { id: 'overview', labelKey: 'society.tabOverview', icon: 'file-text', show: true },
    { id: 'homes', labelKey: 'society.tabHomes', icon: 'building-2', show: listings.length > 0, count: listings.length },
    { id: 'reviews', labelKey: 'society.tabReviews', icon: 'star', show: true, count: rating.count || 0 },
    { id: 'community', labelKey: 'society.tabCommunity', icon: 'users', show: true, count: contribCounts.all || 0 },
    { id: 'location', labelKey: 'society.tabLocation', icon: 'map-pin', show: !soc._generic },
  ].filter((t) => t.show);
  const current = tabs.some((t) => t.id === activeTab) ? activeTab : 'overview';
  const selectTab = (id) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id === 'overview') next.delete('tab'); else next.set('tab', id);
      return next;
    }, { replace: true });
  };
  const inp = 'w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-teal-400/50';

  const ctx = {
    soc, locName, living, listings, priceStats,
    rating, overall, bars, reviews, openReport,
    qText, setQText, submitQuestion, inp, qa,
    answerFor, aText, setAText, submitAnswer, setAnswerFor,
    iAmResidentOrAdmin, openBoard, calMonth, setCalMonth, eventDots, calDay, setCalDay,
    dayEvents, myMob, iAmAdmin, onRemoveBoard, boardNotices,
    contribCounts, openContribute, contribFilter, setContribFilter, shownContribs,
    onRemoveContribution, openReply, replyFor, replyText, setReplyText, submitReply,
    onHelpful, onRemoveReply,
    hasCoords, dirUrl, locFix, openLocation, commute, nearby,
    iAmResident, resStat, requireLogin, setResStep, setResOpen,
    wa, waRaw, openWa, waExists, committee, refreshCommittee,
    saasOn, claimed, claimPending, setClaim, followed, onFollow,
    setRateOpen, claim, closeClaim, cl, setCl, submitClaim,
    resOpen, closeResident, resStep, res, setRes, unitTaken, resToStep2, user, otp, submitResident,
    sugOpen, setSugOpen, sug, setSug, toggleSugAmenity, submitSuggest,
    contribOpen, setContribOpen, cKind, setCKind, cForm, setCForm, submitContribution,
    boardOpen, setBoardOpen, bKind, setBKind, bForm, setBForm, submitBoard,
    waOpen, setWaOpen, waUrl, setWaUrl, submitWa,
    reportFor, setReportFor, reportReason, setReportReason, submitReport,
    locOpen, submitLocation, setLocOpen,
  };

  return {
    ...ctx,
    rootRef, hero, verified, rateOpen, pick, setPick, revText, setRevText, cats, setCat,
    submitReview, sugRec, openSuggest, stats, tabs, current, selectTab,
  };
}
