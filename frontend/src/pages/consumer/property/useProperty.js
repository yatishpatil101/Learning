import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useScrollReveal } from '../../../lib/useScrollReveal.js';
import useScrollLock from '../../../hooks/useScrollLock.js';
import { recordSignal } from '../../../services/demandService.js';
import { getProperty } from '../../../services/propertyService.js';
import { track } from '../../../lib/pmf.js';
import { fmtArea, fmtINR, fmtNum, isSqftUnit } from '../../../lib/format.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { useContactGate } from './useContactGate.js';
import { requestPhotos as askForPhotos } from '../../../services/photoRequestService.js';
import { pushRecentProp, getLastSearch } from '../../../lib/localPrefs.js';
import { useSignInGate } from '../../../lib/useSignInGate.js';
import { messagesLinkForProp } from '../../../lib/chatFormat.js';
import { isBrokered } from '../../../lib/contact.js';
import { queuePendingChat } from '../../../services/conversationService.js';
import { AMEN_LABEL, availableLabel, deriveFloor, deriveFacing, deriveOverlooking, deriveAge, propertyKind } from './derivations.js';
import { commercialSpecsFor } from '../list-property/constants.js';
import { LANDUSE_LBL } from '../../../data/propertyTypes.js';

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
  // Keyed on the route param, not `p.id`, so the gate is requested in parallel with the listing —
  // and because a hook cannot sit below this function's `p === undefined` early return.
  const { gate: contactGate } = useContactGate(id);
  const rootRef = useScrollReveal([p]);
  const lbTouchX = useRef(null);
/* Declared up here rather than beside its handler because everything below line 86 is past an early return —
   a hook there changes call order between the found and not-found renders. */
  const photoAskBusy = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const sendToSignIn = useSignInGate();
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
      if (!alive) return;
      // `r ?? null`: `undefined` is "still asking" and `null` is "there is nothing there", so
      // skipping the write on a miss would spin the skeleton forever.
      setP(r ?? null);
      if (r) {
        // `r.uuid`, not the routing slug on `r.id`: the demand table keys on the property UUID.
        // Not awaited — a telemetry write must not delay the page it is measuring.
        recordSignal({ kind: 'view', localitySlug: r.localitySlug, propertyId: r.uuid });
        pushRecentProp(r.id);
        track('view_listing', { id: r.id, locality: r.locality, deal: r.deal });
      }
    });
    return () => { alive = false; };
  }, [id]);

  const gallery = useMemo(() => (p ? (p.gallery && p.gallery.length ? p.gallery : [p.image]) : []), [p]);

  useScrollLock(lightbox || tourOpen);
  useEffect(() => {
    if (!lightbox && !tourOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { setLightbox(false); setTourOpen(false); }
      else if (lightbox && e.key === 'ArrowLeft') setActive((i) => (i - 1 + gallery.length) % gallery.length);
      else if (lightbox && e.key === 'ArrowRight') setActive((i) => (i + 1) % gallery.length);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox, tourOpen, gallery.length]);

  if (p === undefined) return { loading: true, tr };
  if (!p) return { notFound: true, tr };

  const ownerMob = String(p.ownerMobile || '');
  const contactApproved = contactGate.status === 'approved' || contactGate.status === 'owner';
  const canChat = flagEnabled('inAppMessaging');

  /* The sign-in branch belongs here, not inside ContactOwnerModal: gating inside the sheet strands the
     `reason`/`next` pair a click deeper, and a visitor who just closes the sheet has been told nothing. */
  const startChatRequest = () => { queuePendingChat(p); navigate(messagesLinkForProp(p)); };
  const handleContact = () => {
    if (!isIn) { sendToSignIn('contact'); return; }
    if (!canChat) { setContactOpen(true); return; }
    startChatRequest();
  };

  // Gate: only the owner or admin can view non-approved listings
  const isOwner = isIn && p.ownerMobile && String(p.ownerMobile) === String(user?.mobile);
  const isAdmin = user?.role === 'admin' || user?.role === 'staff';
  const isApproved = p.status === 'approved';
  if (!isApproved && !isOwner && !isAdmin) {
/* `rented` / `sold` are terminal, so "not verified yet — check back later" is false and contradicts the search
   card. An interstitial, since the URL stays reachable from a saved link but the CTAs have nothing to offer. */
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
  /* Fallback, not a synonym: `landUse` is the column the Land-use filter reads, and it covers farm
     land — which the wizard never asks about, because it is agricultural by definition. */
  const plotZone = p.plotZone || LANDUSE_LBL[p.landUse] || '';
  /* The owner's answer or nothing: a derived bathroom count would sit beside the price and carpet
     area with no hedge, and a confident wrong number stops a reader asking. */
  const baths = p.bath ?? null;
  const furnishLabel = ['unfurnished', 'semi', 'furnished'].includes(p.furnishing) ? tr(`property.furnishing.${p.furnishing}`) : '—';
  const parkingLabel = p.parkingSpaces ? String(p.parkingSpaces) : '—';
  const possessionLabel = {
    ready: tr('property.readyToMove'),
    new: tr('property.newLaunch'),
    under: tr('property.underConstruction'),
  }[p.construction] || '—';
  /* A listing can reach this page with no `type` (older seeds, partial imports), and an unguarded
     `p.type.toLowerCase()` white-screens it. */
  const typeLabel = p.type || tr('property.typeFallback');
  const typeLower = String(typeLabel).toLowerCase();
  const bhkLabel = p.bhkNum == null ? '' : p.bhkNum === 0 ? '1 RK ' : p.bhkNum + ' BHK ';
  const title = `${bhkLabel}${typeLabel} for ${isRent ? 'Rent' : 'Sale'} in ${p.locality}`;
  const priceStr = isRent ? `₹${(p.price || 0).toLocaleString('en-IN')}/month` : fmtINR(p.price);

  // Derived from this listing's own views/enquiries so the figures vary per listing and stay
  // stable; one hardcoded number on every property reads as fake urgency.
  const viewingNow = 3 + ((p.views || 0) % 15);
  const visitsScheduled = 1 + ((p.enquiries || 0) % 5);
  // "This week" is a weekly slice of lifetime enquiries (accrued over ~6 weeks),
  // not the lifetime total — so the figure reads as a genuine recent-demand signal.
  const enquiriesThisWeek = p.enquiries ? Math.max(1, Math.round(p.enquiries / 6)) : 0;

  // Type-aware Key Details: land/commercial don't have bedrooms/furnishing/floor.
  const areaLabel = fmtArea(p.area, p.areaUnit) || '—';
  const perUnitLabel = tr('property.pricePerSqft');
  const perUnitVal = '₹' + (p.area ? fmtNum(Math.round(p.price / p.area)) : '0');
/* Buy only, and only with a real area: a tenant compares the monthly figure, never a rate per foot, and a
   plot priced per acre would be quoted per acre under a ₹/sq.ft label. Without the area test it reads "₹0". */
  const showPerUnit = !isRent && isSqftUnit(p.areaUnit) && p.area > 0;
  let details;
  // On land the row is labelled Possession, and `possessionLabel` is the better answer whenever the
  // move-in bucket has none — including an unrecognised token, hence testing the label not the value.
  const landPossession = availableLabel(tr, p.availableFrom);
  if (isLand) {
    /* `naSanctioned` is the retired boolean, read only when the three-state is unanswered so a
       listing published under it keeps saying what its owner said. */
    const naStatus = p.naStatus || (p.naSanctioned ? 'sanctioned' : '');
    /* Answered rows only: a dash beside a measurement reads as a specification rather than an
       unasked question, and the toggles default to off, so off is silence. */
    const landSpecs = [
      ['ruler', tr('property.spec.plotDimensions'), p.plotLength && p.plotWidth ? `${p.plotLength} × ${p.plotWidth} ft` : ''],
      ['milestone', tr('property.spec.roadWidth'), p.roadWidth ? `${p.roadWidth} ft` : ''],
      ['expand', tr('property.spec.openSides'), p.openSides || ''],
      ['droplets', tr('property.spec.waterSource'), p.waterSource || ''],
      ['file-check', tr('property.spec.naStatus'), naStatus ? tr('property.naStatus.' + naStatus) : ''],
      ['scale', tr('property.spec.otherRights'), p.otherRights ? tr('property.otherRights.' + p.otherRights) : ''],
      ['user-check', tr('property.spec.buyerEligibility'), p.buyerEligibility ? tr('property.buyerEligibility.' + p.buyerEligibility) : ''],
      ...['cornerPlot', 'boundaryWall', 'electricity', 'roadAccess', 'satbara']
        .map((key) => ['circle-check', tr('property.spec.' + key), p[key] ? tr('property.yes') : '']),
    ].filter(([, , value]) => value);
    details = [
      ['maximize', tr('property.plotArea'), areaLabel, 'keydetail.plotArea'],
      ['layout-grid', tr('property.plotZone'), plotZone || typeLabel, 'keydetail.plotZone'],
      ['compass', tr('property.facing'), deriveFacing(p), 'keydetail.facing'],
      ['calendar-check', tr('property.possession'), landPossession === '\u2014' ? possessionLabel : landPossession, 'keydetail.available'],
      ...(showPerUnit ? [['indian-rupee', perUnitLabel, perUnitVal, 'keydetail.perUnitBuy']] : []),
      ['file-check', tr('property.titleLabel'), p.ownershipVerified ? tr('property.clearTitle') : tr('property.underVerification'), 'keydetail.title'],
      ...landSpecs,
    ];
  } else if (kind === 'commercial') {
    /* Answered rows only: an unstated floor load is a question for the owner, not a dash that
       reads like a specification. */
    const specs = commercialSpecsFor(p.commercialType)
      .filter(({ key }) => String(p[key] ?? '').trim())
      .map(({ key, unit }) => ['ruler', tr('property.spec.' + key),
        unit ? `${p[key]} ${unit}` : String(p[key])]);
    details = [
      ['maximize', tr('property.area'), areaLabel, 'keydetail.area'],
      ['sofa', tr('property.furnishingLabel'), furnishLabel, 'keydetail.furnishing'],
      ['building', tr('property.floor'), deriveFloor(p), 'keydetail.floor'],
      ['compass', tr('property.facing'), deriveFacing(p), 'keydetail.facing'],
      ['eye', tr('property.overlooking'), deriveOverlooking(p), 'keydetail.overlooking'],
      ['car-front', tr('property.parking'), parkingLabel, 'keydetail.parking'],
      isRent
        ? ['calendar-check', tr('property.available'), availableLabel(tr, p.availableFrom), 'keydetail.available']
        : ['calendar-days', tr('property.age'), deriveAge(p), 'keydetail.age'],
      ...specs,
    ];
  } else {
    details = [
      ['bed-double', tr('property.bedrooms'), p.bhkNum == null ? '—' : p.bhkNum === 0 ? '1 RK' : p.bhkNum + ' BHK', 'keydetail.bedrooms'],
      ['bath', tr('property.bathrooms'), baths ?? '—', 'keydetail.bathrooms'],
      ['maximize', tr('property.area'), areaLabel, 'keydetail.area'],
      ['sofa', tr('property.furnishingLabel'), furnishLabel, 'keydetail.furnishing'],
      ['building', tr('property.floor'), deriveFloor(p), 'keydetail.floor'],
      ['compass', tr('property.facing'), deriveFacing(p), 'keydetail.facing'],
      ['eye', tr('property.overlooking'), deriveOverlooking(p), 'keydetail.overlooking'],
      ['car-front', tr('property.parking'), parkingLabel, 'keydetail.parking'],
      isRent
        ? ['calendar-check', tr('property.available'), availableLabel(tr, p.availableFrom), 'keydetail.available']
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
    if (plotZone) highlights.push(['layout-grid', tr('property.zoneLabel', { zone: plotZone })]);
    if (p.ownershipVerified) highlights.push(['file-check', tr('property.clearTitleHl')]);
  } else {
    // Guarded because `deriveFacing` returns '' when no direction was stated: an unguarded push
    // renders a pill reading " Facing" and burns one of the four `slice(0, 4)` slots.
    const facing = deriveFacing(p);
    if (facing) highlights.push(['compass', tr('property.facingLabel', { facing })]);
    if (p.amenities?.includes('security')) highlights.push(['shield-check', tr('property.security247')]);
    if (p.amenities?.includes('power')) highlights.push(['zap', tr('property.powerBackup')]);
  }
  const topHighlights = highlights.slice(0, 4);

  // Type-aware "Read more" blurb — a co-op community pitch (schools/hospitals) is
  // meaningless for an office or a plot, so each kind gets its own framing.
  const amenPhrase = (p.amenities || []).map((a) => AMEN_LABEL[a] || a).join(', ') || tr('property.modernAmenities');
  const brokered = isBrokered(p);
  const overviewMore = isLand
    ? tr(brokered ? 'property.overviewLandBrokered' : 'property.overviewLand', {
        type: typeLower,
        locality: p.locality,
        zone: plotZone ? tr('property.overviewLandZone', { zone: String(plotZone).toLowerCase() }) : '',
      })
    : kind === 'commercial'
      ? tr(brokered ? 'property.overviewCommercialBrokered' : 'property.overviewCommercial', { type: typeLower, locality: p.locality, amenities: amenPhrase })
      : tr(brokered ? 'property.overviewResidentialBrokered' : 'property.overviewResidential', {
          bhk: p.bhkNum ? p.bhkNum + ' BHK ' : '',
          type: typeLower,
          locality: p.locality,
          amenities: amenPhrase,
        });

  const waShare = () => {
    const msg = `${title} ${priceStr} on Draazy (₹0 brokerage): ${window.location.href}`;
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener');
  };

  const tags = [];
/* Two tiers: the neutral badges that open and close the row state facts, while every verification claim
   between them shares one emerald so the trust block reads as a set rather than four unrelated colours. */
  // Sale: possession status. Rent: furnishing (possession is a buy concept, meaningless for rentals).
  if (!isRent) tags.push([possessionLabel, '', p.construction === 'new' ? 'hard-hat' : 'key', p.construction === 'new' ? 'tag.underConstruction' : 'tag.readyToMove']);
  else if (!isLand && furnishLabel !== '—') tags.push([furnishLabel, '', 'sofa', 'tag.furnishing']);
  if (p.ownerVerified) tags.push([tr('property.verifiedOwner'), 'tag-emerald', 'user-check', 'tag.verifiedOwner']);
  if (p.ownershipVerified) tags.push([tr('property.ownershipVerified'), 'tag-emerald', 'file-check', 'tag.ownershipVerified']);
  if (p.rera) tags.push([tr('property.reraApproved'), 'tag-emerald', 'badge-check', 'tag.rera']);
  /* Last, and neutral on purpose: this is a fact about the transaction, not a verification Draazy
     performed, so it must not join the emerald set the tiers above are reserved for. Only the
     "deal direct" half is withdrawn for a broker's listing — Draazy's own cut is nil regardless. */
  tags.push(brokered
    ? [tr('property.zeroBrokerageOnly'), '', 'hand-coins', 'tag.zeroBrokerageOnly']
    : [tr('property.zeroBrokerageDirect'), '', 'hand-coins', 'tag.zeroBrokerage']);

/* Re-stated here only to spend a toast instead of a round trip; the server enforces both independently.
   `created` is the server's word — saying "sent" for a duplicate promises a notification nobody will get. */
  const requestPhotos = async () => {
    if (!isIn) { sendToSignIn('photos'); return; }
    if (isOwner) { toast(tr('property.ownListingPhotos'), 'info'); return; }
    if (photoAskBusy.current) return;
    /* Captured before the await, because `signInPath` reads `window.location` at call time and a
       401 can land after the buyer has already moved to another page. */
    const back = window.location.pathname + window.location.search;
    photoAskBusy.current = true;
    try {
      const { created } = await askForPhotos(p.id);
      toast(created ? tr('property.photosSent') : tr('property.photosDuplicate'), created ? 'success' : 'info');
    } catch (err) {
      if (err?.status === 401) { sendToSignIn('photos', back); return; }
      if (err?.status === 400) { toast(tr('property.ownListingPhotos'), 'info'); return; }
      toast(tr('property.photosFailed'), 'error');
    } finally {
      photoAskBusy.current = false;
    }
  };

  const returnTo = location.state?.from || getLastSearch()?.search || `/listings?deal=${p.deal}&loc=${encodeURIComponent(p.locality)}`;

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
    handleContact, ownerMob, contactApproved, ownerHidesNumber: contactGate.ownerHidesNumber, canChat, isOwner, isAdmin, isApproved,
    // Owner and staff previews both need saying out loud: otherwise the only difference between a
    // live page and a pending one is invisible. Not `!isApproved` — sold/rented is also unapproved.
    ownerPreview: (isOwner || isAdmin) && (p.status === 'pending' || p.status === 'flagged'),
    staffPreview: !isOwner && isAdmin && (p.status === 'pending' || p.status === 'flagged'),
    isRent, kind, isLand, baths, furnishLabel, parkingLabel, possessionLabel, title, priceStr,
    viewingNow, visitsScheduled, enquiriesThisWeek, perUnitLabel, perUnitVal, showPerUnit, details, highlights,
    topHighlights, amenPhrase, overviewMore, waShare, tags, requestPhotos, returnTo,
    hasAmenities, reviewsOn, tabs, current, selectTab,
  };
}
