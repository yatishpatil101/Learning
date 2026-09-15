import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useFollows } from '../../../context/FollowContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { useScrollReveal } from '../../../lib/useScrollReveal.js';
import { useSignInGate } from '../../../lib/useSignInGate.js';
import { fmtNum } from '../../../lib/format.js';
import { listProperties } from '../../../services/propertyService.js';
import { fnvHash } from '../../../lib/hash.js';
import { listingsInSociety } from '../../../data/societies.js';
import { commuteInfo, connectivityFor } from '../property/locationIntel.js';
import { createEntityReview, getEntityReviewSummary, listEntityReviews } from '../../../services/reviewService.js';
import { useOtpFlow } from '../../../components/auth/useOtpFlow.js';
// All hub state comes from the service seam so that standing, reports and the catalogue are
// server facts rather than claims the reader's own browser makes about itself.
import { digits } from '../../../lib/contact.js';
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

// Client-side kinds only; `reportMapper.js` owns the wire names. The set exists to refuse an
// unmapped kind outright, since mis-filing a complaint against a property id is worse than failing.
const REPORTABLE_KINDS = new Set(['contribution', 'reply', 'question', 'answer', 'board', 'review']);


export function useSocietyHub() {
  const rootRef = useScrollReveal();
  const { slug: routeSlug } = useParams();
  const [params, setParams] = useSearchParams();
  const sendToSignIn = useSignInGate();
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
  // `socLoading` gates the first paint so a real building never flashes as an unknown one.
  // `null` from the seam is the honest miss; a thrown read stays `socFailed` — a different claim.
  const [soc, setSoc] = useState(() => genericSociety(slug, fallbackName, fallbackLoc));
  const [socLoading, setSocLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setSocLoading(true);
    getSociety(slug)
      .then((resolved) => {
        if (!alive) return;
        if (!resolved) { setSoc(genericSociety(slug, fallbackName, fallbackLoc)); return; }
        // A thin community-minted row carries only name + locality; specs are never fabricated,
        // so the hub renders what it holds and shows an honest "add details" state for the rest.
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
  // Sparse by design: a key appears only once the reviewer taps that row, so "did not rate" stays
  // distinguishable from "rated 1" all the way to the column.
  const [cats, setCats] = useState({});
  const setCat = (k, v) => setCats((c) => ({ ...c, [k]: v }));
  const [revText, setRevText] = useState('');
  const [qText, setQText] = useState('');
  const [answerFor, setAnswerFor] = useState(null);
  const [aText, setAText] = useState('');
  const [claim, setClaim] = useState(false);
  const [cl, setCl] = useState({ name: '', mobile: '', role: '', regNo: '', cert: null, certFile: null });
  // Claiming is two network calls, so the button is slow enough to double-tap; without this the
  // second tap files a duplicate claim that 409s against the claimant's own first one.
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
  // A reason code, not prose: ops filter on the code and read the free-text `details` beside it.
  // The server refuses a report carrying no recognised reason.
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
  // Standing as the server sees it — `{ resident, admin, claim, verifiedResidents }` in one read,
  // so it survives clearing site data or signing in on another device.
  const [membership, setMembership] = useState(null);
  const [committee, setCommittee] = useState([]);

  // Keyed on `soc.slug`: the database keys societies by UUID and accepts the slug as an alias,
  // while `soc.id` is a synthetic local `S01` the server cannot resolve.
  useEffect(() => {
    let alive = true;
    setSummary(null);
    setSummaryFailed(false);
    listEntityReviews('society', soc.slug)
      .then((res) => { if (alive) setReviews(res.items); })
      .catch(() => { if (alive) setReviews([]); });
    // Independent of the list above: the list is one page of 20, the summary is the whole corpus.
    // A distinct `summaryFailed` keeps "unreadable rating" apart from "nobody has rated".
    getEntityReviewSummary('society', soc.slug)
      .then((s) => { if (alive) setSummary(s); })
      .catch(() => { if (alive) setSummaryFailed(true); });
    return () => { alive = false; };
  }, [soc.slug]);

  // Four independent reads so one failure cannot blank the others. `tick` is a dependency so any
  // change to standing re-reads the set rather than each writer patching its own slice.
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
    // Proposals, WhatsApp and the location fix are one server table (a pending resident-suggested
    // change), so they arrive in one read and are split back out here rather than at call sites.
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

  // Committee-only: the residents endpoint rejects everyone else, so firing it for every visitor
  // would put a 403 in the console of a page working exactly as intended.
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

  // The summary endpoint is the authority: the on-screen list is paged at 20, so reducing it would
  // pass off the twenty most recent reviews as the society's rating. `failed` ≠ `count === 0`.
  const rating = useMemo(() => ({
    avg: summary ? summary.avg : null,
    count: summary ? summary.count : 0,
    loading: !summary && !summaryFailed,
    failed: summaryFailed,
  }), [summary, summaryFailed]);
  // Resident answers only; `catAvg` is sparse, so `Number.isFinite` is the whole presence test and
  // a partly-rated society draws a partial grid rather than a padded one.
  const bars = useMemo(() => {
    const catAvg = summary?.catAvg || {};
    return REVIEW_CATS.filter((k) => Number.isFinite(catAvg[k])).map((k) => ({ id: k, labelKey: REVIEW_CAT_KEYS[k], value: catAvg[k] }));
  }, [summary]);
  // `null` rather than `0` so an unreviewed society can never print "0/5". `Number.isFinite` is not
  // redundant with `count`: the summary contract allows a count with a null average.
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
  // `verifiedAt` is the ops stamp; the catalogue's registration/conveyance columns only apply to
  // curated rows, and a member-minted society arrives with neither.
  const verified = !!soc.verifiedAt || (soc.source !== 'community' && !!(soc.registration && soc.conveyance));
  const claimed = soc.claimStatus === 'claimed' || membership?.claim?.status === 'approved';
  const claimPending = soc.claimStatus === 'pending' || membership?.claim?.status === 'pending';
  const iAmResident = resStat?.status === 'verified';
  const iAmAdmin = !soc._generic && !!membership?.admin;
  // Courtesy warning while typing, answerable only from the committee queue; the server's partial
  // unique index on the verified unit is the authority and refuses a duplicate with a 409 anyway.
  const unitTaken = useMemo(() => {
    const typed = `${res.wing || ''}${res.flat || ''}`.replace(/[\s\-/]/g, '').toLowerCase();
    if (!typed) return false;
    const mine = digits((user || {}).mobile);
    return committee.some((r) => (r.unitKey || '').replace(/[\s\-/]/g, '').toLowerCase() === typed
      && r.status === 'verified'
      && digits(r.mobile || '') !== mine);
  }, [committee, res.wing, res.flat, user]);

  const requireLogin = () => { if (!isIn) { sendToSignIn('community'); return false; } return true; };
  const refreshCommittee = async (r, status) => {
    try {
      await decideResidency(soc.slug, r.id, { status });
    } catch (e) {
      // 409 is the unit index refusing a second verified resident in one flat — the whole reason
      // the committee reviews these, so it earns its own copy rather than the generic failure.
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
       failed follow back, and promising alerts on a refused follow is a promise the page can't keep. */
    const now = await follows.toggle(soc.slug);
    toast(now ? `Following ${soc.name} — we'll alert you on new listings` : 'Unfollowed', now ? 'success' : 'info');
  };
  const submitReview = () => requireSignedIn(() => {
    // No `resident` flag: the server derives standing itself, and a badge a browser asserts about
    // itself is not evidence. `categories` carries only the aspects the reviewer actually touched.
    createEntityReview('society', soc.slug, { rating: pick, text: revText.trim(), categories: cats })
      .then((saved) => (saved === 'login'
        ? null
        // Both reads: the headline comes from the summary, so re-reading only the cards would
        // leave a stale average beside the reviewer's own rating.
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
  // Vault upload first, because the claim carries the document id; a failed upload aborts rather
  // than filing a claim without the certificate an operator approves on.
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
          /* The registration number has its own searchable field; duplicating it into `note` would
             print it twice and cost the reviewer whatever the claimant wanted to say. */
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

  // Badge-not-gate (ADR-019): L1 mobile-verified sign-in is the only floor for community actions;
  // resident/committee-only actions add their own check on top (see requireResident).
  const requireSignedIn = (fn) => {
    if (!isIn) { sendToSignIn('community'); return; }
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
  // `text`, `note` and `caption` are three names for the author's own words, so they collapse into
  // one `body` on the wire; only the structured part genuinely differs between the three forms.
  const submitContribution = async () => {
    const body = (cKind === 'pick' ? cForm.note : cKind === 'photo' ? cForm.caption : cForm.text).trim();
    if (cKind === 'pick' ? !cForm.name.trim() : cKind === 'photo' ? !cForm.photo : !body) {
      toast(cKind === 'pick' ? 'Add the person / service name.' : cKind === 'photo' ? 'Add a photo to share.' : 'Write your tip first.', 'error');
      return;
    }
    if (!isIn) { sendToSignIn('community'); return; }
    /* Upload first, then reference: `photoUrl` on the wire is a String, so sending the preview
       object dies in deserialisation. `photoFile`, not `photo.dataUrl` — the 2 MB preview cap would
       reject exactly the large phone photographs people share. A failed upload stops the
       contribution, since the server refuses a photo kind with no `photoUrl` anyway. */
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
  // Idempotent: the button sends the state it wants, so a retried tap settles on the state the
  // reader can see rather than flipping it back the way a toggle would.
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

  // Five target types rather than one `society_content`: a target id means nothing without the
  // table it indexes, and a moderator upholding a complaint has to remove the right row.
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
      if (e?.status === 401) { if (sendToSignIn('community')) setReportFor(null); return; }
      toast('Could not submit report.', 'error');
      return;
    }
    setReportBusy(false);
    setReportFor(null);
    // The provider turns the server's per-reporter 409 into this rather than throwing: complaining
    // twice about the same post is not a failure and should not read like one.
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
    if (!isIn) { sendToSignIn('community'); return; }
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
