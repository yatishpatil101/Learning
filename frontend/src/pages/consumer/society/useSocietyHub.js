import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useFollows } from '../../../context/FollowContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { useScrollReveal } from '../../../lib/useScrollReveal.js';
import { fmtNum } from '../../../lib/format.js';
import { listProperties } from '../../../services/propertyService.js';
import { fnvHash } from '../../../lib/hash.js';
import { listingsInSociety } from '../../../data/societies.js';
import { commuteInfo, connectivityFor } from '../property/locationIntel.js';
import { createEntityReview, getEntityReviewSummary, listEntityReviews } from '../../../services/reviewService.js';
import { useOtpFlow } from '../../../components/auth/useOtpFlow.js';
/**
 * Everything on this hub now goes through `societyService` and `reportService`.
 *
 * It used to go through `lib/store` — which is to say through the reader's own `localStorage`. That
 * was not a caching layer with a server behind it; it was the whole of the storage. A question
 * asked here was answered by nobody because nobody else could see it; a "verified resident" badge
 * was a claim the browser made about itself; and the Report button wrote a row into the reporting
 * member's own device, which the ops queue — reading the *moderator's* device — could never find.
 *
 * `digits` stays because it is a string utility. The society *catalogue* no longer comes through
 * here at all: `getSociety` asks the seam for the building, which in the live build is
 * `GET /societies/{slug}` and in the mock build is the same bundled catalogue this file used to
 * read directly. That was the last thing on this page answered by the reader's own device, and it
 * had a failure worth naming: a society minted through the API is not in the bundled 348 rows, so
 * the lookup missed and the hub drew `genericSociety` — a real, ops-verified building rendered as
 * a stub with its slug for a name.
 */
import { digits } from '../../../lib/store.js';
import {
  getSociety,
  getSocietyMembership, requestResidency, listSocietyResidents, decideResidency, claimSociety,
  listSocietyQuestions, askSocietyQuestion, answerSocietyQuestion,
  listSocietyBoard, postBoardItem, removeBoardItem,
  listSocietyContributions, addSocietyContribution, removeSocietyContribution,
  setContributionHelpful, addContributionReply, removeContributionReply,
  getSocietyProposals, proposeSocietyChange,
} from '../../../services/societyService.js';
import { createReport } from '../../../services/reportService.js';
import { uploadDocument } from '../../../services/documentService.js';
import { uploadPhoto } from '../../../services/photoService.js';
import { SOCIETY_REPORT_REASONS } from '../../../lib/reportReasons.js';
import { TAB_IDS, REVIEW_CATS, REVIEW_CAT_KEYS, NOW_YEAR, HERO, CONTRIB_META, BOARD_META, ymd, titleCase } from './constants.js';
import { genericSociety } from './helpers.jsx';

/**
 * The six things on this page a reader can report.
 *
 * These are *client* kinds, and they stay bare words on purpose: `reportMapper.js` owns the
 * translation to the wire's `society_contribution`/`society_reply`/… and is the single place that
 * knows the pairing, so duplicating it here would be a second copy to drift. `review` is
 * deliberately in the list and deliberately not prefixed on the wire — a society review is an
 * entity review, reportable and moderatable long before this hub existed, and giving it a second
 * name would have split one queue into two.
 *
 * The set exists only to refuse a kind nobody mapped. `toTargetType` degrades an unknown kind to
 * `property` with a console warning rather than throwing, which is right for it — a report is worth
 * more mis-filed than lost — but wrong here: from this page an unmapped kind can only be a bug, and
 * a complaint about a neighbour's post filed against a *property* id is worse than one refused out
 * loud.
 */
const REPORTABLE_KINDS = new Set(['contribution', 'reply', 'question', 'answer', 'board', 'review']);


export function useSocietyHub() {
  const rootRef = useScrollReveal();
  const { slug: routeSlug } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { isIn, user } = useAuth();
  const { toast } = useToast();
  const follows = useFollows();
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
  /* The building itself, from the seam.
   *
   * `socLoading` is not decoration. Every path into this state starts by awaiting something — a
   * request live, the lazy MahaRERA chunk in mock — so without a gate the very first paint of every
   * society page is `genericSociety`: the slug title-cased, no builder, no specs, and the "we don't
   * have this building yet" panel. It would correct itself a frame later, which is precisely what
   * makes it bad: a real building would flash as an unknown one on every load, and an assertion
   * about the unknown-society state would pass against a society that exists.
   *
   * `null` from the seam is the honest miss and keeps its old rendering. A *thrown* read does not
   * come here at all — it is caught below and left as `socFailed`, because "no such society" and
   * "we could not reach the server" are different claims and only the first one is ours to make. */
  const [soc, setSoc] = useState(() => genericSociety(slug, fallbackName, fallbackLoc));
  const [socLoading, setSocLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setSocLoading(true);
    getSociety(slug)
      .then((resolved) => {
        if (!alive) return;
        if (!resolved) { setSoc(genericSociety(slug, fallbackName, fallbackLoc)); return; }
        // A "thin" community/demand-minted row carries only name + locality. We DON'T
        // backfill fabricated specs — the hub renders only fields we actually hold,
        // and shows an honest "add details" state for the rest.
        const thin = resolved.units == null && !resolved.builder;
        setSoc({ ...resolved, _thin: thin, _community: resolved.source === 'community' });
      })
      .catch((err) => {
        console.warn('[society] could not read the society', err);
        if (alive) setSoc(genericSociety(slug, fallbackName, fallbackLoc));
      })
      .finally(() => { if (alive) setSocLoading(false); });
    return () => { alive = false; };
  }, [slug, tick, fallbackName, fallbackLoc]);
  const locName = soc._locName || titleCase(soc.localitySlug);

  const [listings, setListings] = useState([]);
  const [reviews, setReviews] = useState([]);
  // `null` until the summary read settles; `summaryFailed` keeps "could not read" distinguishable
  // from "count is 0", which is the difference between an outage and an unreviewed society.
  const [summary, setSummary] = useState(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [qa, setQa] = useState([]);
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
  const [cl, setCl] = useState({ name: '', mobile: '', role: '', regNo: '', cert: null, certFile: null });
  // Filing a claim is now two network calls (vault upload, then the claim), so the button is slow
  // enough to double-tap. Without this a second tap files a second claim and the first one comes
  // back 409 — the claimant is told their own submission conflicts with itself.
  const [claimBusy, setClaimBusy] = useState(false);
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
  const [cForm, setCForm] = useState({ category: '', text: '', name: '', contact: '', note: '', caption: '', photo: null, photoFile: null });
  const otp = useOtpFlow();
  // Threaded replies + reporting
  const [replyFor, setReplyFor] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [reportFor, setReportFor] = useState(null); // { targetType, targetId, parentId?, snapshot }
  /**
   * A reason *code*, not prose.
   *
   * This was a free-text `<textarea maxLength={200}>` whose contents were the entire complaint. A
   * queue of sentences cannot be counted, filtered or acted on consistently — "he put my number on
   * here" and "this is spam" arrived as the same shapeless field — and the server refuses a report
   * with no recognised reason. So the picker carries the code and the textarea, which is still
   * here, is sent as `details`: the code is what ops filter on, the prose is what they read.
   */
  const [reportReason, setReportReason] = useState(SOCIETY_REPORT_REASONS[0][0]);
  const [reportDetails, setReportDetails] = useState('');
  const [reportBusy, setReportBusy] = useState(false);

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
   * Standing on this hub, as the server sees it: `{ resident, admin, claim, verifiedResidents }`.
   *
   * Three separate browser-local lookups used to answer this — "am I a verified resident here", "am
   * I on the committee", "has anyone claimed this society". All three read the reader's own device,
   * so every one of them was a claim the browser made about itself: clearing site data demoted you,
   * and signing in on a phone made you a stranger to a society you had been verified in for months.
   * One read, one source.
   */
  const [membership, setMembership] = useState(null);
  const [committee, setCommittee] = useState([]);

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

  /**
   * The hub's own data, in four reads.
   *
   * Every one of these used to be a synchronous `localStorage` lookup, which is why this effect had
   * no `alive` guard and no error branch: nothing could fail and nothing could arrive late. All
   * four now cross the network, so each settles independently — a board that 500s must not blank
   * the questions beside it — and each resolves to an empty list rather than leaving the previous
   * society's rows on screen while the next one loads.
   *
   * `tick` is in the dependency list so that anything which changes standing (a committee decision,
   * a residency request) re-reads the set, rather than each writer patching its own slice of state
   * and slowly drifting from what the server holds.
   */
  useEffect(() => {
    let alive = true;
    setContribFilter('all');
    setReplyFor(null); setReportFor(null); setBoardOpen(false); setWaOpen(false); setLocOpen(false);

    getSocietyMembership(soc.slug)
      .then((m) => { if (alive) { setMembership(m); setResStat(m.resident); } })
      .catch(() => { if (alive) { setMembership(null); setResStat(null); } });
    listSocietyQuestions(soc.slug)
      .then((rows) => { if (alive) setQa(rows); })
      .catch(() => { if (alive) setQa([]); });
    listSocietyContributions(soc.slug)
      .then((rows) => { if (alive) setContribs(rows); })
      .catch(() => { if (alive) setContribs([]); });
    listSocietyBoard(soc.slug)
      .then((rows) => { if (alive) setBoard(rows); })
      .catch(() => { if (alive) setBoard([]); });
    /**
     * Proposals, WhatsApp and the location fix are one read, because on the server they are one
     * table: three shapes of "a resident suggested a change to this society's record", each
     * pending until ops decide. The hub still shows them in three places, so they are split back
     * out here rather than at the call sites.
     */
    getSocietyProposals(soc.slug)
      .then((p) => {
        if (!alive) return;
        const pending = p.pending || [];
        setSugRec(pending.find((x) => x.kind === 'details') || null);
        setWaRaw(pending.find((x) => x.kind === 'whatsapp') || null);
        setLocFix(pending.find((x) => x.kind === 'location') || null);
        setWaExists(!!p.whatsappAvailable);
        setWa(p.whatsappJoinUrl ? { url: p.whatsappJoinUrl } : null);
      })
      .catch(() => {
        if (!alive) return;
        setSugRec(null); setWaRaw(null); setLocFix(null); setWaExists(false); setWa(null);
      });

    listProperties({}).then((all) => { if (alive) setListings(soc._generic ? [] : listingsInSociety(all, soc.slug)); });
    return () => { alive = false; };
  }, [soc, tick]);

  /**
   * The committee's own queue, read only by the committee.
   *
   * Separate from the effect above because it is a different permission, not a different slice of
   * the same one: `GET /societies/{slug}/residents` is refused to everybody except the committee
   * and staff, so firing it for every visitor would put a 403 in the console of a page that is
   * working exactly as intended.
   */
  useEffect(() => {
    if (!membership?.admin) { setCommittee([]); return undefined; }
    let alive = true;
    // Unfiltered: the panel below shows the pending ones, but `unitTaken` needs the verified ones
    // to warn a neighbour that the flat they are typing is already held.
    listSocietyResidents(soc.slug)
      .then((rows) => { if (alive) setCommittee(rows); })
      .catch(() => { if (alive) setCommittee([]); });
    return () => { alive = false; };
  }, [soc.slug, membership?.admin, tick]);


  useEffect(() => {
    if (!claim && !resOpen && !boardOpen && !waOpen && !reportFor) return;
    const onKey = (e) => { if (e.key === 'Escape') { closeClaim(); closeResident(); setBoardOpen(false); setWaOpen(false); setReportFor(null); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the closers are stable in behaviour but not in identity (`closeResident` closes over the OTP hook, which changes on every keystroke); re-binding the listener per keystroke to satisfy the rule would be worse than the rule.
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
  /**
   * "Verified" means ops looked at this society, not that two booleans happen to be set.
   *
   * `registration && conveyance` were the curated catalogue's own columns and said nothing about a
   * member-minted society, which arrives with neither and could therefore never become verified
   * however many times ops confirmed it. `verifiedAt` is the stamp the C5 verification route
   * writes, and `source` distinguishes a row somebody added from one that shipped with the
   * catalogue.
   */
  const verified = !!soc.verifiedAt || (soc.source !== 'community' && !!(soc.registration && soc.conveyance));
  const claimed = soc.claimStatus === 'claimed' || membership?.claim?.status === 'approved';
  const claimPending = soc.claimStatus === 'pending' || membership?.claim?.status === 'pending';
  const iAmResident = resStat?.status === 'verified';
  const iAmAdmin = !soc._generic && !!membership?.admin;
  /**
   * Is this exact flat already held by somebody else?
   *
   * Answered from the committee queue when the reader is on the committee, and left `false`
   * otherwise. It used to be answered from the browser's own copy of every residency request in
   * the society — which nobody outside the committee has any business holding, and which was
   * wrong for everybody who had not personally seen those requests arrive. The authoritative
   * answer is the server's partial unique index on the verified unit; this is only a courtesy
   * warning while typing, and the write is refused with a 409 either way.
   */
  const unitTaken = useMemo(() => {
    const typed = `${res.wing || ''}${res.flat || ''}`.replace(/[\s\-/]/g, '').toLowerCase();
    if (!typed) return false;
    const mine = digits((user || {}).mobile);
    return committee.some((r) => (r.unitKey || '').replace(/[\s\-/]/g, '').toLowerCase() === typed
      && r.status === 'verified'
      && digits(r.mobile || '') !== mine);
  }, [committee, res.wing, res.flat, user]);

  const requireLogin = () => { if (!isIn) { nav('/signin?next=' + encodeURIComponent('/society/' + soc.slug)); return false; } return true; };
  const refreshCommittee = async (r, status) => {
    try {
      await decideResidency(soc.slug, r.id, { status });
    } catch (e) {
      // 409 is the unit index refusing a second verified resident in one flat. It is the whole
      // reason the committee reviews these at all, so it gets its own sentence rather than the
      // generic failure copy.
      toast(e?.status === 409
        ? 'This unit is already held by another verified resident — can\u2019t verify.'
        : 'That decision could not be saved. Please try again.', 'error');
      return;
    }
    setTick((t) => t + 1);
    toast(status === 'verified' ? `Verified ${r.name} as a resident` : 'Request rejected', status === 'verified' ? 'success' : 'info');
  };

  const onFollow = async () => {
    if (!requireLogin()) return;
    /* The toast reports the state the write settled on, not the one attempted: the context rolls a
       failed follow back, and a "we'll alert you" on a follow the server refused is a promise the
       page cannot keep (D227). */
    const now = await follows.toggle(soc.slug);
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
    requireSignedIn(async () => {
      try {
        await askSocietyQuestion(soc.slug, qText.trim());
      } catch { toast('Your question could not be posted. Please try again.', 'error'); return; }
      // Re-read rather than append: the server orders questions newest-first and the row it
      // returns carries a resident badge this page cannot derive for itself.
      try { setQa(await listSocietyQuestions(soc.slug)); } catch { /* the write landed; the list will catch up on the next visit */ }
      setQText(''); toast('Question posted', 'success');
    });
  };
  const submitAnswer = (qId) => {
    const val = aText.trim();
    if (!val) return;
    requireSignedIn(async () => {
      try {
        await answerSocietyQuestion(soc.slug, qId, val);
      } catch { toast('Your answer could not be posted. Please try again.', 'error'); return; }
      try { setQa(await listSocietyQuestions(soc.slug)); } catch { /* as above */ }
      setAText(''); setAnswerFor(null);
    });
  };
  const closeClaim = () => { setClaim(false); setCl({ name: '', mobile: '', role: '', regNo: '', cert: null, certFile: null }); };
  /**
   * File the onboarding request, uploading the registration certificate first if one was picked.
   *
   * **Two calls, in this order, and the first one is allowed to fail the whole thing.** The vault
   * upload has to happen before the claim, because the claim carries the document's id and there is
   * no id until the file is stored. If the upload fails we stop rather than filing the claim without
   * it: the certificate is the evidence an operator approves on, and a claim that silently arrives
   * bare looks to the reviewer like a committee that could not be bothered to prove itself.
   *
   * The file goes to the caller's own personal vault, which means the server's existing upload
   * validation applies unchanged — 10 MB, PDF/JPEG/PNG/HEIC/WebP, and a magic-byte sniff that has to
   * agree with the declared type. Nothing is re-implemented here; a second set of rules on this side
   * would only ever be the stale one.
   *
   * `certFile` rather than `cert.dataUrl`: the preview is capped at 2 MB (see `EvidenceUpload`), so
   * rebuilding bytes from it would reject the large phone photographs of a certificate that the
   * vault would otherwise accept, and reject them client-side with no explanation.
   */
  const submitClaim = async () => {
    if (claimBusy) return;
    if (!cl.name.trim()) { toast('Add your name', 'error'); return; }
    if (digits(cl.mobile).length !== 10) { toast('Enter a valid 10-digit mobile', 'error'); return; }
    if (!requireLogin()) return;
    setClaimBusy(true);
    try {
      let certificateDocumentId = null;
      if (cl.certFile) {
        try {
          const doc = await uploadDocument(digits(cl.mobile), 'personal', {
            category: 'Society registration certificate', file: cl.certFile,
          });
          certificateDocumentId = doc?.id || null;
        } catch {
          toast('That certificate could not be uploaded. Check it is a PDF or image under 10 MB.', 'error');
          return;
        }
      }
      try {
        await claimSociety(soc.slug, {
          name: cl.name.trim(), role: cl.role.trim(), email: cl.email || null,
          /* The registration number goes in its own field now (V109). It used to be smuggled into
             `note` as "Registration no. \u2026" because the wire had nowhere else to put it, which cost the
             reviewer the one thing a note is for \u2014 whatever the claimant actually wanted to say \u2014 and
             made the number unsearchable, since it was prose. Sending both would print it twice. */
          registrationNo: cl.regNo.trim() || null,
          certificateDocumentId,
          note: null,
        });
      } catch (e) {
        if (e?.status === 409) { toast('This society already has an onboarding request under review.', 'error'); return; }
        toast('Your request could not be sent. Please try again.', 'error');
        return;
      }
      setTick((t) => t + 1); closeClaim();
      toast('Onboarding request received — our team will verify the committee & reach out!', 'success');
    } finally {
      setClaimBusy(false);
    }
  };
  const closeResident = () => { setResOpen(false); setResStep(1); setRes({ flat: '', wing: '', note: '', proofType: 'maintenance', doc: null }); otp.setOtp(''); };
  const resToStep2 = () => {
    if (!res.flat.trim()) { toast('Add your flat / unit number', 'error'); return; }
    if (!requireLogin()) return;
    setResStep(2);
    if (!otp.otpSent) otp.send();
  };
  const submitResident = async () => {
    if (otp.otp.length !== 6) { otp.setOtpError(true); toast('Enter the 6-digit OTP sent to your mobile', 'error'); return; }
    if (!requireLogin()) return;
    let saved;
    try {
      saved = await requestResidency(soc.slug, {
        flat: res.flat.trim(), wing: res.wing.trim(), note: res.note.trim(), relation: 'resident',
      });
    } catch (e) {
      toast(e?.status === 409
        ? 'Another resident is already verified in this flat — ask the committee.'
        : 'Your request could not be sent. Please try again.', 'error');
      return;
    }
    setResStat(saved); setTick((t) => t + 1); closeResident();
    toast('Residence verification submitted — we\u2019ll confirm your Resident badge shortly', 'success');
  };

  const openSuggest = () => {
    if (!requireLogin()) return;
    // A pending suggestion of my own prefills the form, so a second visit edits the proposal rather
    // than filing a duplicate the server would refuse.
    const f = sugRec && sugRec.status === 'pending' ? sugRec : {};
    setSug({
      builder: f.builder || (soc._community ? '' : soc.builder || ''),
      year: f.buildYear || (soc._community ? '' : soc.year || ''),
      towers: f.towers || (soc._community ? '' : soc.towers || ''),
      units: f.units || (soc._community ? '' : soc.units || ''),
      amenities: f.amenities || (soc._community ? [] : soc.amenities || []),
    });
    setSugOpen(true);
  };
  const toggleSugAmenity = (a) => setSug((s) => ({ ...s, amenities: s.amenities.includes(a) ? s.amenities.filter((x) => x !== a) : [...s.amenities, a] }));
  const submitSuggest = async () => {
    if (!requireLogin()) return;
    const num = (v) => { const n = Number(v); return Number.isFinite(n) && v !== '' && v !== null ? n : null; };
    const body = {
      kind: 'details',
      builder: sug.builder.trim() || null,
      buildYear: num(sug.year),
      towers: num(sug.towers),
      units: num(sug.units),
      amenities: sug.amenities.length ? sug.amenities : null,
    };
    // Empty is caught here rather than sent: the server would answer 400, and "add at least one
    // detail" is a better sentence than whatever a validation failure renders as.
    if (!body.builder && body.buildYear == null && body.towers == null && body.units == null && !body.amenities) {
      toast('Add at least one detail to suggest.', 'error'); return;
    }
    let rec;
    try { rec = await proposeSocietyChange(soc.slug, body); } catch {
      toast('Your suggestion could not be sent. Please try again.', 'error'); return;
    }
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
  const refreshContribs = async () => {
    try { setContribs(await listSocietyContributions(soc.slug)); } catch { /* leave what is on screen */ }
  };
  const openContribute = (kind) => requireSignedIn(() => {
    setCKind(kind);
    setCForm({ category: CONTRIB_META[kind].cats[0], text: '', name: '', contact: '', note: '', caption: '', photo: null, photoFile: null });
    setContribOpen(true);
  });
  /**
   * Three form shapes, one wire shape.
   *
   * A tip's prose lives in `text`, a pick's in `note` and a photo's in `caption` — three names for
   * the same thing, the author's own words — so they collapse into `body` here. The structured
   * part (who the tradesman is, how to reach him, the photo) is what actually differs between the
   * three, and that stays separate.
   */
  const submitContribution = async () => {
    const body = (cKind === 'pick' ? cForm.note : cKind === 'photo' ? cForm.caption : cForm.text).trim();
    if (cKind === 'pick' ? !cForm.name.trim() : cKind === 'photo' ? !cForm.photo : !body) {
      toast(cKind === 'pick' ? 'Add the person / service name.' : cKind === 'photo' ? 'Add a photo to share.' : 'Write your tip first.', 'error');
      return;
    }
    if (!isIn) { nav('/signin?next=' + encodeURIComponent('/society/' + soc.slug)); return; }
    /* Upload first, then reference — the same two-calls-in-order shape as `submitClaim` above, and
       for a sharper reason. `photoUrl` on the wire is a `String`, and what was being sent was
       `EvidenceUpload`'s preview *object* (`{ name, size, mime, dataUrl }`). Jackson cannot bind an
       object to a String, so live the request died in deserialisation before it reached the service
       and the resident got the generic "could not be shared" toast with nothing to act on. Mock mode
       hid it completely: the store keeps the object in `localStorage` and the preview renders, so
       every mock spec passed on a photo nobody else could ever see.

       `cForm.photoFile`, not `cForm.photo.dataUrl`: the preview is capped at 2 MB, so rebuilding
       bytes from it would reject exactly the large phone photographs people actually share, and
       reject them here with no explanation. The raw `File` comes through `EvidenceUpload`'s second
       callback argument, which exists for this.

       A failed upload stops the contribution rather than filing it bare. A photo contribution with
       no photo is refused by the server anyway (`SocietyContributionService` requires `photoUrl`
       for the photo kind), so filing one would only convert a nameable failure into a generic one. */
    let photoUrl = null;
    if (cKind === 'photo') {
      try {
        const stored = await uploadPhoto(cForm.photoFile);
        photoUrl = stored?.url || null;
      } catch {
        toast('That photo could not be uploaded. Please try again.', 'error');
        return;
      }
    }
    try {
      await addSocietyContribution(soc.slug, {
        kind: cKind,
        category: cForm.category || null,
        body: body || null,
        referralName: cKind === 'pick' ? cForm.name.trim() : null,
        referralContact: cKind === 'pick' ? digits(cForm.contact) || null : null,
        photoUrl,
      });
    } catch { toast('That could not be shared. Please try again.', 'error'); return; }
    await refreshContribs(); setContribOpen(false);
    toast('Thanks for contributing to this community!', 'success');
  };
  /**
   * Two idempotent verbs, not a toggle.
   *
   * The button sends the state it wants, so a retried tap settles on the state the reader can see
   * rather than flipping it back — which is what a toggle over an unreliable network does.
   */
  const onHelpful = (c) => requireSignedIn(async () => {
    try { await setContributionHelpful(soc.slug, c.id, !c.helpfulByMe); } catch { return; }
    await refreshContribs();
  });
  const onRemoveContribution = async (id) => {
    try { await removeSocietyContribution(soc.slug, id); } catch (e) {
      toast(e?.status === 403 ? 'You can only remove your own contribution.' : 'That could not be removed.', 'error');
      return;
    }
    await refreshContribs();
    toast('Contribution removed', 'info');
  };

  // Threaded replies on a contribution (sign-in only).
  const openReply = (id) => requireSignedIn(() => { setReplyFor(id); setReplyText(''); });
  const submitReply = (id) => {
    const val = replyText.trim();
    if (!val) return;
    requireSignedIn(async () => {
      try { await addContributionReply(soc.slug, id, val); } catch {
        toast('Your reply could not be posted.', 'error'); return;
      }
      await refreshContribs(); setReplyFor(null); setReplyText('');
    });
  };
  const onRemoveReply = async (id, rid) => {
    try { await removeContributionReply(soc.slug, id, rid); } catch (e) {
      toast(e?.status === 403 ? 'You can only remove your own reply.' : 'That could not be removed.', 'error');
      return;
    }
    await refreshContribs();
  };

  /**
   * Report any hub content → the platform moderation queue.
   *
   * This used to write a row into the reporting member's own `localStorage`, under a key the ops
   * console then read *from the moderator's* device. The queue was empty by construction: a
   * recommendation naming a real tradesman with his real mobile number could be reported by fifty
   * neighbours and not one moderator would ever see a single complaint.
   *
   * The five surfaces are five target types rather than one `society_content` because a target id
   * means nothing without knowing which table it indexes — and a moderator upholding a complaint
   * has to remove the right row. A society *review* is deliberately not a sixth: it is already
   * reportable as `review`, and has been since long before this hub existed.
   */
  const openReport = (target) => requireSignedIn(() => {
    setReportFor(target); setReportReason(SOCIETY_REPORT_REASONS[0][0]); setReportDetails('');
  });
  const submitReport = async () => {
    if (!reportFor || reportBusy) return;
    const kind = reportFor.targetType;
    if (!REPORTABLE_KINDS.has(kind)) { toast('Could not submit report.', 'error'); return; }
    setReportBusy(true);
    let result;
    try {
      /* `kind`, not `targetType` — `createReport` maps the client's word onto the wire's itself.
         Handing it a wire type leaves `report.kind` undefined, and the mapper's forgiving fallback
         then files the complaint as a **property** report against a contribution's id: a row no
         moderator can act on, pointing at a listing that does not exist. */
      result = await createReport({
        kind,
        targetId: String(reportFor.targetId),
        reason: reportReason,
        details: reportDetails.trim() || null,
      });
    } catch (e) {
      setReportBusy(false);
      if (e?.status === 401) { setReportFor(null); nav('/signin?next=' + encodeURIComponent('/society/' + soc.slug)); return; }
      toast('Could not submit report.', 'error');
      return;
    }
    setReportBusy(false);
    setReportFor(null);
    // The duplicate guard is per reporter, and the provider turns the server's 409 into this rather
    // than throwing: this reader has already complained about this post, which is not a failure and
    // should not read like one.
    if (result === 'duplicate') { toast('You already reported this — our team is on it.', 'info'); return; }
    toast('Reported. Thanks — our team will review it.', 'success');
  };

  // Events & notices — posting limited to verified residents / committee.
  const requireResident = (fn) => requireSignedIn(() => {
    if (!(iAmResident || iAmAdmin)) { toast('Only verified residents or the committee can post this.', 'error'); return; }
    fn();
  });
  const refreshBoard = async () => {
    try { setBoard(await listSocietyBoard(soc.slug)); } catch { /* leave what is on screen */ }
  };
  const openBoard = (kind) => requireResident(() => {
    setBKind(kind);
    setBForm({ title: '', body: '', category: BOARD_META[kind].cats[0], date: calDay || ymd(new Date()), time: '' });
    setBoardOpen(true);
  });
  const submitBoard = async () => {
    if (!bForm.title.trim() || (bKind === 'event' && !bForm.date)) {
      toast(bKind === 'event' ? 'Add a title and date.' : 'Add a title.', 'error'); return;
    }
    if (!isIn) { nav('/signin?next=' + encodeURIComponent('/society/' + soc.slug)); return; }
    try {
      await postBoardItem(soc.slug, {
        kind: bKind,
        title: bForm.title.trim(),
        body: bForm.body.trim() || null,
        category: bForm.category || null,
        eventDate: bKind === 'event' ? bForm.date : null,
        eventTime: bKind === 'event' ? bForm.time || null : null,
      });
    } catch (e) {
      toast(e?.status === 403
        ? 'Only verified residents or the committee can post events.'
        : 'That could not be posted. Please try again.', 'error');
      return;
    }
    await refreshBoard(); setBoardOpen(false);
    if (bKind === 'event' && bForm.date) { setCalMonth(new Date(+bForm.date.slice(0, 4), +bForm.date.slice(5, 7) - 1, 1)); setCalDay(bForm.date); }
    toast(bKind === 'event' ? 'Event added to the calendar' : 'Notice posted', 'success');
  };
  const onRemoveBoard = async (id) => {
    try { await removeBoardItem(soc.slug, id); } catch (e) {
      toast(e?.status === 403 ? 'You can only remove your own post.' : 'That could not be removed.', 'error');
      return;
    }
    await refreshBoard(); toast('Removed', 'info');
  };

  // Resident WhatsApp group link — proposed then ops-approved.
  const openWa = () => requireResident(() => { setWaUrl((waRaw && waRaw.inviteUrl) || ''); setWaOpen(true); });
  const submitWa = async () => {
    const url = waUrl.trim();
    // Checked here as well as on the server, because the server's 400 arrives after a round trip
    // and this one is unambiguous enough to answer immediately.
    if (!/^https:\/\/chat\.whatsapp\.com\/\S+$/i.test(url)) {
      toast('Enter a valid WhatsApp invite link (https://chat.whatsapp.com/…).', 'error'); return;
    }
    let rec;
    try { rec = await proposeSocietyChange(soc.slug, { kind: 'whatsapp', inviteUrl: url }); } catch (e) {
      toast(e?.status === 403
        ? 'Only verified residents or the committee can add the group link.'
        : 'That link could not be submitted. Please try again.', 'error');
      return;
    }
    setWaRaw(rec); setWaOpen(false);
    toast('Sent for review — verified residents can join once our team approves it.', 'success');
  };

  // Resident-proposed location correction — pending until ops approve.
  const openLocation = () => requireResident(() => setLocOpen(true));
  const submitLocation = async ({ lat, lng, placeId, label }) => {
    let rec;
    try {
      rec = await proposeSocietyChange(soc.slug, { kind: 'location', lat, lng, placeId: placeId || null, label: label || null });
    } catch (e) {
      toast(e?.status === 403
        ? 'Only verified residents or the committee can suggest the location.'
        : 'Could not submit the location.', 'error');
      return;
    }
    setLocFix(rec); setLocOpen(false);
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
  const eventDots = useMemo(() => { const m = {}; boardEvents.forEach((e) => { if (e.eventDate) m[e.eventDate] = (m[e.eventDate] || 0) + 1; }); return m; }, [boardEvents]);
  const dayEvents = useMemo(() => boardEvents.filter((e) => e.eventDate === calDay).sort((a, b) => (a.eventTime || '').localeCompare(b.eventTime || '')), [boardEvents, calDay]);

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
    soc, socLoading, locName, living, listings, priceStats,
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
    saasOn, claimed, claimPending, setClaim, followed: follows.has(soc.slug), onFollow,
    setRateOpen, claim, closeClaim, cl, setCl, submitClaim, claimBusy,
    resOpen, closeResident, resStep, res, setRes, unitTaken, resToStep2, user, otp, submitResident,
    sugOpen, setSugOpen, sug, setSug, toggleSugAmenity, submitSuggest,
    contribOpen, setContribOpen, cKind, setCKind, cForm, setCForm, submitContribution,
    boardOpen, setBoardOpen, bKind, setBKind, bForm, setBForm, submitBoard,
    waOpen, setWaOpen, waUrl, setWaUrl, submitWa,
    reportFor, setReportFor, reportReason, setReportReason, reportDetails, setReportDetails,
    reportBusy, reportReasons: SOCIETY_REPORT_REASONS, submitReport,
    locOpen, submitLocation, setLocOpen,
  };

  return {
    ...ctx,
    rootRef, hero, verified, rateOpen, pick, setPick, revText, setRevText, cats, setCat,
    submitReview, sugRec, openSuggest, stats, tabs, current, selectTab,
  };
}
