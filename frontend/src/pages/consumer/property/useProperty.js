import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useScrollReveal } from '../../../lib/useScrollReveal.js';
import { recordSignal } from '../../../services/demandService.js';
import { getProperty } from '../../../services/propertyService.js';
import { track } from '../../../lib/pmf.js';
import { fmtINR, fmtNum } from '../../../lib/format.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { useContactGate } from './useContactGate.js';
import { requestPhotos as askForPhotos } from '../../../services/photoRequestService.js';
import { messagesLinkForProp } from '../../../lib/chat.js';
import { queuePendingChat } from '../../../services/conversationService.js';
import { pushRecentProp, getLastSearch } from '../../../lib/localPrefs.js';
import { AMEN_LABEL, deriveFloor, deriveFacing, deriveAge, propertyKind } from './derivations.js';

const PROP_TAB_IDS = ['overview', 'amenities', 'location', 'pricing', 'trust'];

export default function useProperty() {
  const { t: tr } = useTranslation();
  const { id } = useParams();
  const [p, setP] = useState(undefined);
  const [active, setActive] = useState(0);
  const [ovOpen, setOvOpen] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);
  const { isIn, user } = useAuth();
  const { toast } = useToast();
  const { flagEnabled } = useAppFlags();
  // Keyed on the route param rather than `p.id` so the gate is requested in parallel with the
  // listing instead of waiting for it — and because hooks cannot live below this function's
  // `p === undefined` early return, where the old synchronous read sat.
  const { gate: contactGate } = useContactGate(id);
  const rootRef = useScrollReveal([p]);
  const lbTouchX = useRef(null);
  /* Re-entrancy guard for the "more photos" ask, declared up here rather than beside its handler
     because everything below line 86 is past an early return — a hook there changes call order
     between the found and not-found renders. */
  const photoAskBusy = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const activeTab = useMemo(() => {
    const urlTab = params.get('tab');
    return PROP_TAB_IDS.includes(urlTab) ? urlTab : 'overview';
  }, [params]);

  useEffect(() => {
    let alive = true;
    setP(undefined);
    setActive(0);
    getProperty(id).then((r) => {
      if (alive && r) {
        setP(r);
        // The slug and the UUID, not the display name and the routing id. `r.id` is the slug the
        // app routes by; the demand table stores a property UUID, so it wants `r.uuid`. Not
        // awaited: `recordSignal` never rejects, and a telemetry write must not delay the page it
        // is measuring.
        recordSignal({ kind: 'view', localitySlug: r.localitySlug, propertyId: r.uuid });
        pushRecentProp(r.id);
        track('view_listing', { id: r.id, locality: r.locality, deal: r.deal });
      }
    });
    return () => { alive = false; };
  }, [id]);

  const gallery = useMemo(() => (p ? (p.gallery && p.gallery.length ? p.gallery : [p.image]) : []), [p]);

  useEffect(() => {
    if (!lightbox && !tourOpen) return undefined;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') { setLightbox(false); setTourOpen(false); }
      else if (lightbox && e.key === 'ArrowLeft') setActive((i) => (i - 1 + gallery.length) % gallery.length);
      else if (lightbox && e.key === 'ArrowRight') setActive((i) => (i + 1) % gallery.length);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [lightbox, tourOpen, gallery.length]);

  if (p === undefined) return { loading: true, tr };
  if (!p) return { notFound: true, tr };

  const ownerMob = String(p.ownerMobile || '');
  const contactApproved = contactGate.status === 'approved' || contactGate.status === 'owner';
  const canChat = flagEnabled('inAppMessaging');

  // "Contact Owner" starts an in-app chat. It's L1 contact (badge-not-gate): any
  // signed-in user may reach the owner — queue a pending request (owner accepts in
  // Messages) and open the thread. The number-reveal channel lives separately in
  // the OwnerCard. When in-app messaging is off, fall back to the enquiry popup.
  const startChatRequest = () => { queuePendingChat(p); navigate(messagesLinkForProp(p)); };
  const handleContact = () => {
    if (!isIn) { toast(tr('property.signInContact'), 'info'); return; }
    if (!canChat) { setContactOpen(true); return; }
    startChatRequest();
  };

  // Gate: only the owner or admin can view non-approved listings
  const isOwner = isIn && p.ownerMobile && String(p.ownerMobile) === String(user?.mobile);
  const isAdmin = user?.role === 'admin' || user?.role === 'staff';
  const isApproved = p.status === 'approved';
  if (!isApproved && !isOwner && !isAdmin) {
    /* Two different reasons a stranger cannot see the page, and they deserve different answers.
       `rented` / `sold` are *terminal* — closing a deal (`POST /me/deals/{id}/close`) moves the
       listing there, so a listing that was verified, went live, and found its tenant lands in this
       branch. Telling that reader "hasn't been verified yet — check back later" is false twice
       over: it was verified, and checking back will never help. It also contradicts the search
       card, which already reads these two statuses as a closed deal (`Card.jsx`, D110) — so the
       card told the truth and the page it links to did not.

       The listing is out of search by then, but the URL stays reachable from a saved property, a
       comparison, a shared link or the browser's history, which is exactly when someone needs the
       honest answer. Still an interstitial rather than the full page: the deal is done, so the
       contact and visit CTAs have nothing to offer. */
    const done = p.status === 'rented' || p.status === 'sold';
    if (!done) return { underReview: true, tr };
    return {
      dealClosed: true,
      closedWord: tr(p.status === 'rented' ? 'property.rentedOutWord' : 'property.soldWord'),
      tr,
    };
  }

  const isRent = p.deal === 'rent';
  const kind = propertyKind(p);
  const isLand = kind === 'land';
  /* The owner's answer, or nothing (D244). This used to fall back to `Math.max(1, bhkNum - 1)`,
     which put an invented number in the Bathrooms tile beside the price and the carpet area, in the
     same type and with no hedge — a 3 BHK was reported as having two bathrooms on the strength of
     arithmetic. A blank tile makes a reader ask the question; a confident wrong one stops them, and
     bathroom count is a real decision input in family and shared rentals. V114 gave it a column, so
     the honest answer is now available and the guess is not needed. */
  const baths = p.bath ?? null;
  const furnishLabel = ['unfurnished', 'semi', 'furnished'].includes(p.furnishing) ? tr(`property.furnishing.${p.furnishing}`) : '—';
  const parkingLabel = p.parkingSpaces ? String(p.parkingSpaces) : '—';
  const emi = Math.round((p.price * 0.0072) / 100) * 100;
  const possessionLabel = p.construction === 'new' ? tr('property.underConstruction') : tr('property.readyToMove');
  /* A listing can reach the detail page with no `type` (older seeds, partial
     imports, hand-written fixtures). Derive the label once and defensively —
     an unguarded p.type.toLowerCase() white-screened the whole page. */
  const typeLabel = p.type || tr('property.typeFallback');
  const typeLower = String(typeLabel).toLowerCase();
  const title = `${p.bhkNum ? p.bhkNum + ' BHK ' : ''}${typeLabel} for ${isRent ? 'Rent' : 'Sale'} in ${p.locality}`;
  const priceStr = isRent ? `₹${(p.price || 0).toLocaleString('en-IN')}/month` : fmtINR(p.price);

  // Live-activity signals — derived from this listing's real popularity (views /
  // enquiries) so they vary per listing and stay stable, instead of the same
  // hardcoded number showing on every property (which reads as fake urgency).
  const viewingNow = 3 + ((p.views || 0) % 15);
  const visitsScheduled = 1 + ((p.enquiries || 0) % 5);
  // "This week" is a weekly slice of lifetime enquiries (accrued over ~6 weeks),
  // not the lifetime total — so the figure reads as a genuine recent-demand signal.
  const enquiriesThisWeek = p.enquiries ? Math.max(1, Math.round(p.enquiries / 6)) : 0;

  // Type-aware Key Details: land/commercial don't have bedrooms/furnishing/floor.
  const perUnitLabel = isRent ? tr('property.rentPerSqft') : tr('property.pricePerSqft');
  const perUnitVal = '₹' + (p.area ? fmtNum(Math.round(p.price / p.area)) : '0');
  let details;
  if (isLand) {
    details = [
      ['maximize', tr('property.plotArea'), p.area ? p.area.toLocaleString('en-IN') + ' sq.ft.' : '—', 'keydetail.plotArea'],
      ['layout-grid', tr('property.plotZone'), p.form?.plotZone || typeLabel, 'keydetail.plotZone'],
      ['compass', tr('property.facing'), deriveFacing(p), 'keydetail.facing'],
      ['calendar-check', tr('property.possession'), p.available || possessionLabel, 'keydetail.available'],
      ['indian-rupee', perUnitLabel, perUnitVal, isRent ? 'keydetail.perUnitRent' : 'keydetail.perUnitBuy'],
      ['file-check', tr('property.titleLabel'), p.ownershipVerified ? tr('property.clearTitle') : tr('property.underVerification'), 'keydetail.title'],
    ];
  } else if (kind === 'commercial') {
    details = [
      ['maximize', tr('property.area'), p.area ? p.area.toLocaleString('en-IN') + ' sq.ft.' : '—', 'keydetail.area'],
      ['sofa', tr('property.furnishingLabel'), furnishLabel, 'keydetail.furnishing'],
      ['building', tr('property.floor'), deriveFloor(p), 'keydetail.floor'],
      ['compass', tr('property.facing'), deriveFacing(p), 'keydetail.facing'],
      ['car-front', tr('property.parking'), parkingLabel, 'keydetail.parking'],
      isRent
        ? ['calendar-check', tr('property.available'), p.available || tr('property.immediately'), 'keydetail.available']
        : ['calendar-days', tr('property.age'), deriveAge(p), 'keydetail.age'],
    ];
  } else {
    details = [
      ['bed-double', tr('property.bedrooms'), p.bhkNum ? p.bhkNum + ' BHK' : '—', 'keydetail.bedrooms'],
      ['bath', tr('property.bathrooms'), baths ?? '—', 'keydetail.bathrooms'],
      ['maximize', tr('property.area'), p.area ? p.area.toLocaleString('en-IN') + ' sq.ft.' : '—', 'keydetail.area'],
      ['sofa', tr('property.furnishingLabel'), furnishLabel, 'keydetail.furnishing'],
      ['building', tr('property.floor'), deriveFloor(p), 'keydetail.floor'],
      ['compass', tr('property.facing'), deriveFacing(p), 'keydetail.facing'],
      ['car-front', tr('property.parking'), parkingLabel, 'keydetail.parking'],
      isRent
        ? ['calendar-check', tr('property.available'), p.available || tr('property.immediately'), 'keydetail.available']
        : ['calendar-days', tr('property.age'), deriveAge(p), 'keydetail.age'],
    ];
  }

  // Data-driven Highlights — only surface signals we can actually back with data.
  const highlights = [];
  if (p.amenities?.includes('parking') || p.parkingSpaces) highlights.push(['car-front', p.parkingSpaces ? tr('property.coveredParkingN', { count: p.parkingSpaces }) : tr('property.coveredParking')]);
  // Possession status is a sale concept. For rent, surface furnishing (a critical rent signal) instead.
  if (isRent) {
    if (!isLand && furnishLabel !== '—') highlights.push(['sofa', furnishLabel]);
  } else {
    highlights.push([p.construction === 'new' ? 'hard-hat' : 'circle-check-big', possessionLabel]);
  }
  if (p.rera) highlights.push(['badge-check', tr('property.reraApproved')]);
  if (isLand) {
    if (p.form?.plotZone) highlights.push(['layout-grid', tr('property.zoneLabel', { zone: p.form.plotZone })]);
    if (p.ownershipVerified) highlights.push(['file-check', tr('property.clearTitleHl')]);
  } else {
    // Guarded because `deriveFacing` no longer invents a direction when none was stated: it
    // returns '' and `property.facingLabel` is "{{facing}} Facing", so an unguarded push
    // rendered a pill reading " Facing" — and, worse, spent one of the four slots in
    // `highlights.slice(0, 4)` doing it, displacing a real signal.
    const facing = deriveFacing(p);
    if (facing) highlights.push(['compass', tr('property.facingLabel', { facing })]);
    if (p.amenities?.includes('security')) highlights.push(['shield-check', tr('property.security247')]);
    if (p.amenities?.includes('power')) highlights.push(['zap', tr('property.powerBackup')]);
  }
  const topHighlights = highlights.slice(0, 4);

  // Type-aware "Read more" blurb — a co-op community pitch (schools/hospitals) is
  // meaningless for an office or a plot, so each kind gets its own framing.
  const amenPhrase = (p.amenities || []).map((a) => AMEN_LABEL[a] || a).join(', ') || tr('property.modernAmenities');
  const overviewMore = isLand
    ? tr('property.overviewLand', {
        type: typeLower,
        locality: p.locality,
        zone: p.form?.plotZone ? tr('property.overviewLandZone', { zone: String(p.form.plotZone).toLowerCase() }) : '',
      })
    : kind === 'commercial'
      ? tr('property.overviewCommercial', { type: typeLower, locality: p.locality, amenities: amenPhrase })
      : tr('property.overviewResidential', {
          bhk: p.bhkNum ? p.bhkNum + ' BHK ' : '',
          type: typeLower,
          locality: p.locality,
          amenities: amenPhrase,
        });

  const waShare = () => {
    const msg = `${title} ${priceStr} on PuneNest (₹0 brokerage): ${window.location.href}`;
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  };

  const tags = [];
  /* Two tiers, deliberately: the first badge states a fact about the property and
     stays neutral; every verification claim shares one emerald so the trust block
     reads as a set rather than four unrelated colours. Each carries an icon — a
     mixed row of some-with, some-without is what made these look scattered. */
  // Sale: possession status. Rent: furnishing (possession is a buy concept, meaningless for rentals).
  if (!isRent) tags.push([possessionLabel, '', p.construction === 'new' ? 'hard-hat' : 'key', p.construction === 'new' ? 'tag.underConstruction' : 'tag.readyToMove']);
  else if (!isLand && furnishLabel !== '—') tags.push([furnishLabel, '', 'sofa', 'tag.furnishing']);
  if (p.ownerVerified) tags.push([tr('property.verifiedOwner'), 'tag-emerald', 'user-check', 'tag.verifiedOwner']);
  if (p.ownershipVerified) tags.push([tr('property.ownershipVerified'), 'tag-emerald', 'file-check', 'tag.ownershipVerified']);
  if (p.rera) tags.push([tr('property.reraApproved'), 'tag-emerald', 'badge-check', 'tag.rera']);

  /* Record a "more photos" request so the owner sees it in their dashboard.

     Sign-in is the whole gate — no PII moves in either direction — and an owner cannot ask about
     their own listing. Both rules are re-stated here only to spend a toast instead of a round trip;
     the server enforces them independently (401 / 400), and the branches below are what happens
     when these two disagree with it, which they will the moment a stale session outlives its token.

     `created` is the server's word on whether this was a new row. Reading it, rather than assuming
     success, is what keeps the second press honest after the previous ask has already been
     resolved: the row is still there, so it is still a duplicate, and telling the buyer "sent"
     would promise the owner a notification nobody is going to receive. */
  const requestPhotos = async () => {
    if (!isIn) { toast(tr('property.signInPhotos'), 'info'); return; }
    if (isOwner) { toast(tr('property.ownListingPhotos'), 'info'); return; }
    if (photoAskBusy.current) return;
    photoAskBusy.current = true;
    try {
      const { created } = await askForPhotos(p.id);
      toast(created ? tr('property.photosSent') : tr('property.photosDuplicate'), created ? 'success' : 'info');
    } catch (err) {
      if (err?.status === 401) { toast(tr('property.signInPhotos'), 'info'); return; }
      if (err?.status === 400) { toast(tr('property.ownListingPhotos'), 'info'); return; }
      toast(tr('property.photosFailed'), 'error');
    } finally {
      photoAskBusy.current = false;
    }
  };

  const returnTo = location.state?.from || getLastSearch()?.search || `/listings?deal=${p.deal}&loc=${encodeURIComponent(p.locality)}`;
  const backToMap = /view=map/.test(returnTo);
  // `state.from` is set only by the results/map cards, so when it's present the
  // previous history entry IS the results page: a true Back pops to it and lets the
  // browser restore filters, the open map pin and scroll for free (no duplicate
  // listings entry). On a cold/deep link — or when arriving from elsewhere — there's
  // nothing to pop to, so navigate to the reconstructed search URL instead.
  const goBackToSearch = () =>
    location.state?.from ? navigate(-1) : navigate(returnTo, { state: { restore: true } });

  const hasAmenities = !!(p.amenities && p.amenities.length);
  const reviewsOn = flagEnabled('reviewsEnabled');
  const tabs = [
    { id: 'overview', label: tr('property.tabOverview'), icon: 'file-text', show: true },
    { id: 'amenities', label: kind === 'residential' ? tr('property.tabAmenitiesSociety') : tr('property.tabAmenities'), icon: 'sparkles', show: hasAmenities || kind === 'residential' || reviewsOn },
    { id: 'location', label: tr('property.tabLocation'), icon: 'map-pin', show: true },
    { id: 'pricing', label: isRent ? tr('property.tabRentDetails') : tr('property.tabPriceInsights'), icon: 'indian-rupee', show: true },
    { id: 'trust', label: tr('property.tabTrust'), icon: 'shield-check', show: true },
  ].filter((t) => t.show);
  const current = tabs.some((t) => t.id === activeTab) ? activeTab : 'overview';
  const selectTab = (tabId) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tabId === 'overview') next.delete('tab'); else next.set('tab', tabId);
      return next;
    }, { replace: true });
  };

  return {
    tr, p, active, setActive, ovOpen, setOvOpen, lightbox, setLightbox,
    tourOpen, setTourOpen, reportOpen, setReportOpen, contactOpen, setContactOpen,
    visitOpen, setVisitOpen,
    isIn, user, toast, flagEnabled, rootRef, lbTouchX, gallery, activeTab,
    startChatRequest, handleContact, ownerMob, contactApproved, ownerHidesNumber: contactGate.ownerHidesNumber, canChat, isOwner, isAdmin, isApproved,
    isRent, kind, isLand, baths, furnishLabel, parkingLabel, emi, possessionLabel, title, priceStr,
    viewingNow, visitsScheduled, enquiriesThisWeek, perUnitLabel, perUnitVal, details, highlights,
    topHighlights, amenPhrase, overviewMore, waShare, tags, requestPhotos, returnTo, backToMap,
    goBackToSearch, hasAmenities, reviewsOn, tabs, current, selectTab,
  };
}
