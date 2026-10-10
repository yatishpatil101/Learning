import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useFollows } from '../../../context/FollowContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { useScrollReveal } from '../../../lib/useScrollReveal.js';
import { useSignInGate } from '../../../lib/useSignInGate.js';
import { fmtNum } from '../../../lib/format.js';
import { fnvHash } from '../../../lib/hash.js';
import { commuteInfo } from '../property/locationIntel.js';
import { createEntityReview, getEntityReviewSummary, listEntityReviews } from '../../../services/reviewService.js';
import { getSociety } from '../../../services/societyService.js';
import { TAB_IDS, REVIEW_CATS, REVIEW_CAT_KEYS, NOW_YEAR, HERO, titleCase } from './constants.js';
import { genericSociety } from './helpers.jsx';

const MIN_REVIEWS_FOR_TAB = 3;
/** The reviews tab shows five; list and summary share one request at this size. */
const REVIEW_READ = { size: 5 };
const EMPTY_HOMES = [];

export function useSocietyHub() {
  const rootRef = useScrollReveal();
  const { slug: routeSlug } = useParams();
  const [params, setParams] = useSearchParams();
  const sendToSignIn = useSignInGate();
  const { isIn } = useAuth();
  const { toast } = useToast();
  const follows = useFollows();

  const activeTab = useMemo(() => {
    const urlTab = params.get('tab');
    return TAB_IDS.includes(urlTab) ? urlTab : 'overview';
  }, [params]);
  const slug = (routeSlug || '').toLowerCase();
  const fallbackName = params.get('name');
  const fallbackLoc = params.get('loc') || 'Pune';
  // `socLoading` gates the first paint so a real building never flashes as an unknown one.
  // `null` from the seam is the honest miss; a thrown read is an outage, not a missing society.
  const [soc, setSoc] = useState(() => genericSociety(slug, fallbackName, fallbackLoc));
  const [socLoading, setSocLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setSocLoading(true);
    setLoadError(null);
    getSociety(slug)
      .then((resolved) => {
        if (!alive) return;
        if (!resolved) { setSoc(genericSociety(slug, fallbackName, fallbackLoc)); return; }
        // A thin minted row carries only name + locality; specs are never fabricated.
        const thin = resolved.units == null && !resolved.builder;
        setSoc({ ...resolved, _thin: thin });
      })
      .catch((err) => {
        console.warn('[society] could not read the society', err);
        if (alive) setLoadError(err);
      })
      .finally(() => { if (alive) setSocLoading(false); });
    return () => { alive = false; };
  }, [slug, fallbackName, fallbackLoc, reload]);
  const retryLoad = () => setReload((n) => n + 1);
  const locName = soc._locName || titleCase(soc.localitySlug);

  const listings = soc.homes || EMPTY_HOMES;
  const [reviews, setReviews] = useState([]);
  // `null` until the summary read settles; `summaryFailed` keeps "could not read" distinguishable
  // from "count is 0", which is the difference between an outage and an unreviewed society.
  const [summary, setSummary] = useState(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [pick, setPick] = useState(5);
  // Sparse by design: a key appears only once the reviewer taps that row, so "did not rate" stays
  // distinguishable from "rated 1" all the way to the column.
  const [cats, setCats] = useState({});
  const setCat = (k, v) => setCats((c) => ({ ...c, [k]: v }));
  const [revText, setRevText] = useState('');
  const [reportFor, setReportFor] = useState(null);

  // The server accepts the slug as an alias for its UUID key; soc.id is a local synthetic id it cannot resolve.
  useEffect(() => {
    let alive = true;
    setSummary(null);
    setSummaryFailed(false);
    listEntityReviews('society', soc.slug, REVIEW_READ)
      .then((res) => { if (alive) setReviews(res.items); })
      .catch(() => { if (alive) setReviews([]); });
    // The summary covers the whole corpus, not just the page above.
    getEntityReviewSummary('society', soc.slug, REVIEW_READ)
      .then((s) => { if (alive) setSummary(s); })
      .catch(() => { if (alive) setSummaryFailed(true); });
    return () => { alive = false; };
  }, [soc.slug]);

  // The summary is the authority: reducing the on-screen page would pass the newest few off as the rating.
  const rating = useMemo(() => ({
    avg: summary ? summary.avg : null,
    count: summary ? summary.count : 0,
    loading: !summary && !summaryFailed,
    failed: summaryFailed,
  }), [summary, summaryFailed]);
  // `catAvg` is sparse, so `Number.isFinite` is the whole presence test.
  const bars = useMemo(() => {
    const catAvg = summary?.catAvg || {};
    return REVIEW_CATS.filter((k) => Number.isFinite(catAvg[k])).map((k) => ({ id: k, labelKey: REVIEW_CAT_KEYS[k], value: catAvg[k] }));
  }, [summary]);
  // `null` rather than `0` so an unreviewed society can never print "0/5".
  const overall = useMemo(() => {
    const rated = rating.count > 0 && Number.isFinite(rating.avg);
    return rated ? +rating.avg.toFixed(1) : null;
  }, [rating]);

  const priceStats = { psf: soc.psf, rentAvg: soc.rentAvg, forSale: soc.forSale || 0, forRent: soc.forRent || 0 };

  const commute = commuteInfo(soc.lat, soc.lng);
  const hasCoords = soc.lat != null && soc.lng != null;
  const dirUrl = hasCoords
    ? 'https://www.google.com/maps/dir/?api=1&destination=' + Number(soc.lat) + ',' + Number(soc.lng) + (soc.placeId ? '&destination_place_id=' + encodeURIComponent(soc.placeId) : '')
    : null;
  const age = soc.year ? NOW_YEAR - soc.year : null;
  const hero = HERO[fnvHash(soc.slug) % HERO.length];

  const requireLogin = () => { if (!isIn) { sendToSignIn('society'); return false; } return true; };
  const onFollow = async () => {
    if (soc._generic || !requireLogin()) return;
    /* The toast reports the state the write settled on, not the one attempted: the context rolls a
       failed follow back, and promising alerts on a refused follow is a promise the page can't keep. */
    const now = await follows.toggle(soc.slug);
    toast(now ? `Following ${soc.name} — we'll alert you on new listings` : 'Unfollowed', now ? 'success' : 'info');
  };
  const submitReview = () => {
    if (soc._generic || !requireLogin()) return;
    // No `resident` flag: `categories` carries only the aspects the reviewer actually touched.
    createEntityReview('society', soc.slug, { rating: pick, text: revText.trim(), categories: cats })
      .then((saved) => (saved === 'login'
        ? null
        // Both reads: the headline comes from the summary, so re-reading only the cards would
        // leave a stale average beside the reviewer's own rating.
        : Promise.all([
          listEntityReviews('society', soc.slug, REVIEW_READ),
          getEntityReviewSummary('society', soc.slug, REVIEW_READ),
        ])))
      .then((res) => {
        if (!res) return;
        const [list, sum] = res;
        setReviews(list.items); setSummary(sum); setSummaryFailed(false);
        setRevText(''); setPick(5); setCats({}); setRateOpen(false);
        toast('Thanks for reviewing this society!', 'success');
      })
      .catch(() => toast('Your review could not be posted. Please try again.', 'error'));
  };
  const openReport = (review) => { if (requireLogin()) setReportFor(review); };
  const closeReport = () => setReportFor(null);

  /* Carry label keys plus value key and args, not text, so either language renders without this hook knowing. */
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
    { id: 'homes', labelKey: 'society.tabHomes', icon: 'building-2', show: listings.length > 0, count: soc.listingCount || listings.length },
    { id: 'reviews', labelKey: 'society.tabReviews', icon: 'star', show: (rating.count || 0) >= MIN_REVIEWS_FOR_TAB, count: rating.count || 0 },
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

  return {
    rootRef, soc, socLoading, loadError, retryLoad, locName, living, listings, priceStats,
    rating, overall, bars, reviews, openReport, reportFor, closeReport, toast,
    hasCoords, dirUrl, commute,
    followed: follows.has(soc.slug), onFollow,
    hero, rateOpen, setRateOpen, pick, setPick, revText, setRevText, cats, setCat, inp,
    submitReview, stats, tabs, current, selectTab,
  };
}
