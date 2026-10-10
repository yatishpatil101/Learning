import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import PropertyImage from '../ui/PropertyImage.jsx';
import { fmtArea, fmtINR, fmtNum } from '../../lib/format.js';
import { FURN_LBL } from '../../pages/consumer/listings/constants.js';
import { POSSESSION, AMEN_ICON, amenLabel } from './tileMeta.js';
import { useSaved } from '../../context/SavedContext.jsx';
import { cityLabelFor } from '../../lib/geoConfig.js';
import { messagesLinkForProp } from '../../lib/chatFormat.js';
import { useSignInGate } from '../../lib/useSignInGate.js';
import useSwipeDismiss from '../../lib/useSwipeDismiss.js';
import { queuePendingChat } from '../../services/conversationService.js';
import { ContactOwnerModal } from '../../pages/consumer/property/ContactOwnerModal.jsx';
import { ScheduleVisitModal } from '../../pages/consumer/property/ScheduleVisitModal.jsx';
import InlineOtpSheet from '../auth/InlineOtpSheet.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { digits } from '../../lib/contact.js';
import '../../styles/routes/property-map-detail.css';
import { propertyHref } from '../../lib/listingSeo.js';

const isLandListing = (p) => {
  const type = (p.type || '').toLowerCase();
  return ['plot', 'open plot', 'farm land', 'farmland'].includes(type) || !!p.landUse;
};

const landTitle = (p, t) => {
  const type = (p.type || '').trim();
  const lower = type.toLowerCase();
  if (lower.includes('farm') || p.landUse === 'agricultural') return t('listings.titleFarmland');
  if (lower.includes('na') || p.naStatus === 'sanctioned') return t('listings.titleNaPlot');
  if (p.landUse === 'commercial') return t('listings.titleCommercialPlot');
  if (p.landUse === 'residential') return t('listings.titleResidentialPlot');
  if (type && !['plot', 'open plot'].includes(lower)) return type;
  return t('listings.titlePlot');
};

const titleOf = (p, t) => {
  if (p.shareType === 'flatmates') return 'Flatmate / Shared';
  if (isLandListing(p)) return landTitle(p, t);
  return p.bhkNum ? `${p.bhkNum} BHK ${p.type}` : p.type;
};

const factsOf = (p, t) => {
  const isShare = p.shareType === 'flatmates';
  const isPlot = isLandListing(p);
  const baths = Number(p.bath) || 0;
  const areaRow = [
    [t('property.carpetArea'), p.carpetArea, 'sqft'],
    [t('property.builtupArea'), p.builtUpArea, 'sqft'],
    [t('property.superBuiltup'), p.superBuiltUpArea, 'sqft'],
    [isPlot ? t('property.plotArea') : t('property.totalArea'), p.area, p.areaUnit],
  ].find(([, value]) => Number(value) > 0);
  const area = areaRow ? fmtArea(areaRow[1], areaRow[2]) : '';
  const furn = FURN_LBL[p.furnishing];
  const possession = POSSESSION[p.construction];
  const out = [];
  if (isShare) {
    if (area) out.push({ icon: 'maximize-2', value: area, label: areaRow[0] });
    if (furn) out.push({ icon: 'sofa', value: furn, label: 'Furnishing' });
  } else if (isPlot) {
    if (area) out.push({ icon: 'maximize-2', value: area, label: areaRow[0] });
    if (p.type) out.push({ icon: 'building-2', value: p.type, label: 'Land type' });
  } else {
    if (p.bhkNum) out.push({ icon: 'bed-double', value: p.bhkNum + ' Bed', label: 'Bedrooms' });
    if (baths) out.push({ icon: 'bath', value: baths + ' Bath', label: 'Bathrooms' });
    if (area) out.push({ icon: 'maximize-2', value: area, label: areaRow[0] });
    if (furn) out.push({ icon: 'sofa', value: furn, label: 'Furnishing' });
    if (p.type) out.push({ icon: 'building-2', value: p.type, label: 'Type' });
  }
  if (possession) out.push({ icon: 'calendar', value: possession, label: 'Possession' });
  return out;
};

export default function MapDetailPanel({ property: p, list, locName, activeIndex, onClose, onSelect, fromSearch, onOpenFull, scheduleEnabled, chatEnabled, isIn, toast }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sendToSignIn = useSignInGate();
  const { isIn: authIn, user, loading: authLoading } = useAuth();
  const [shot, setShot] = useState(0);
  const savedList = useSaved();
  const saved = savedList.has(p?.id);
  const [contactOpen, setContactOpen] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);
  const [inlineOtpReason, setInlineOtpReason] = useState(null);
  const [resumeAction, setResumeAction] = useState(null);
  const [resumeAfterVerify, setResumeAfterVerify] = useState(0);
  /* Below 768px this is a bottom sheet with a grabber, and a grabber that cannot be grabbed is the loudest non-native
     tell on the map. */
  const signedIn = Boolean(isIn || authIn);
  const swipe = useSwipeDismiss(onClose, { axis: 'y', query: '(max-width: 767px)' });

  const gallery = p ? (p.gallery && p.gallery.length ? p.gallery : [p.image]).filter(Boolean) : [];

  useEffect(() => { setShot(0); }, [p?.id]);

  useEffect(() => {
    if (!resumeAfterVerify || !signedIn || !resumeAction || !p) return;
    if (resumeAction === 'schedule') {
      setVisitOpen(true);
    } else if (!chatEnabled) {
      setContactOpen(true);
    } else {
      (async () => {
        await queuePendingChat(p);
        navigate(messagesLinkForProp(p));
      })();
    }
    setResumeAction(null);
  }, [chatEnabled, navigate, p, resumeAction, resumeAfterVerify, signedIn]);

  const resumeAfterInlineOtpCloses = () => {
    if (typeof window === 'undefined' || !window.history.state?.__dzInlineOtpGate) {
      setResumeAfterVerify((n) => n + 1);
      return;
    }
    let done = false;
    let fallback = 0;
    const resume = () => {
      if (done) return;
      done = true;
      window.removeEventListener('popstate', resume);
      window.clearTimeout(fallback);
      setResumeAfterVerify((n) => n + 1);
    };
    window.addEventListener('popstate', resume, { once: true });
    fallback = window.setTimeout(resume, 1000);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (contactOpen || visitOpen || inlineOtpReason) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && gallery.length > 1) setShot((i) => (i - 1 + gallery.length) % gallery.length);
      else if (e.key === 'ArrowRight' && gallery.length > 1) setShot((i) => (i + 1) % gallery.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gallery.length, onClose, contactOpen, inlineOtpReason, visitOpen]);

  if (!p) return null;

  const isRent = p.deal === 'rent';

  const loc = (locName && locName[p.localitySlug]) || p.locality;
  const priceStr = isRent ? `₹${(p.price || 0).toLocaleString('en-IN')}` : fmtINR(p.price);
  const emi = Math.round((p.price * 0.0072) / 100) * 100;
  const facts = factsOf(p, t);
  const amenities = Array.isArray(p.amenities) ? p.amenities : [];
  const overviewFeatures = amenities.slice(0, 3).map(amenLabel).join(', ').toLowerCase();
  const total = list.length;

  const tags = [];
  tags.push([p.construction === 'new' ? 'New launch' : p.construction === 'under' ? 'Under constr.' : 'Ready to move', 'is-teal']);
  if (p.ownerVerified) tags.push([t('property.verifiedOwner'), 'is-indigo']);
  if (p.ownershipVerified) tags.push([t('property.ownershipVerified'), 'is-emerald']);
  if (p.reraId) tags.push([t('listings.reraBadge'), 'is-coral']);

  const step = (delta) => {
    const next = activeIndex + delta;
    if (next >= 0 && next < total) onSelect(list[next].id);
  };
  const openInlineOtp = (action, reason) => {
    if (authLoading) {
      toast?.(t('auth.gateChecking'), 'info');
      return;
    }
    setResumeAction(action);
    setInlineOtpReason(reason);
  };
  // Mirrors the property-detail page: L1 contact (badge-not-gate), so queue a pending in-app chat
  // request and open the thread, falling back to the enquiry popup when messaging is disabled.
  const contact = async () => {
    if (!signedIn) { openInlineOtp('contact', 'contact'); return; }
    if (!chatEnabled) { setContactOpen(true); return; }
    await queuePendingChat(p);
    navigate(messagesLinkForProp(p));
  };
  const schedule = () => {
    if (!signedIn) { openInlineOtp('schedule', 'schedule'); return; }
    setVisitOpen(true);
  };
  const toggleSave = () => {
    if (!signedIn) { sendToSignIn('save'); return; }
    savedList.toggle(p.id, p.uuid);
  };
  const isOwner = signedIn && digits(p.ownerMobile) && digits(p.ownerMobile) === digits(user?.mobile);

  return (
    <>
      <aside {...swipe} data-no-ptr className="dz-mdp" role="dialog" aria-modal="true" aria-label={titleOf(p, t) + ' details'}>
        <span className="dz-mdp-grip" aria-hidden="true" />
        <div className="dz-mdp-top">
          <div className="dz-mdp-step">
            <button type="button" onClick={() => step(-1)} disabled={activeIndex <= 0} aria-label="Previous property"><Icon name="chevron-left" /></button>
            <span>{activeIndex + 1} <i>of</i> {total}</span>
            <button type="button" onClick={() => step(1)} disabled={activeIndex >= total - 1} aria-label="Next property"><Icon name="chevron-right" /></button>
          </div>
          <button type="button" className="dz-mdp-close" onClick={onClose} aria-label="Close details"><Icon name="x" /></button>
        </div>

        <div className="dz-mdp-scroll">
          <div className="dz-mdp-media">
            <PropertyImage src={gallery[shot]} sizes="(max-width: 767px) 100vw, 384px" alt={p.title} />
            <span className={'dz-mdp-deal ' + (isRent ? 'is-rent' : 'is-sale')}>{isRent ? 'For Rent' : 'For Sale'}</span>
            <button type="button" className={'dz-mdp-heart' + (saved ? ' is-on' : '')} onClick={toggleSave} aria-label={saved ? 'Saved' : 'Save property'}><Icon name="heart" weight={saved ? 'fill' : 'regular'} /></button>
            {gallery.length > 1 ? (
              <>
                <button type="button" className="dz-mdp-nav is-prev" onClick={() => setShot((i) => (i - 1 + gallery.length) % gallery.length)} aria-label="Previous photo"><Icon name="chevron-left" /></button>
                <button type="button" className="dz-mdp-nav is-next" onClick={() => setShot((i) => (i + 1) % gallery.length)} aria-label="Next photo"><Icon name="chevron-right" /></button>
                <span className="dz-mdp-count">{shot + 1} / {gallery.length}</span>
              </>
            ) : null}
          </div>

          <div className="dz-mdp-info">
            <div className="dz-mdp-tags">
              {tags.map(([label, cls]) => <span key={label} className={'dz-mdp-tag ' + cls}>{label}</span>)}
            </div>
            <div className="dz-mdp-price">{priceStr}{isRent ? <i>/mo</i> : null}</div>
            {!isRent ? <div className="dz-mdp-emi">EMI from ₹{fmtNum(emi)}/mo · {t('property.noBrokerageDeal')}</div> : <div className="dz-mdp-emi">{t('property.noBrokerageSub')}</div>}
            <h3 className="dz-mdp-title">{titleOf(p, t)}</h3>
            <div className="dz-mdp-loc"><Icon name="map-pin" /> {loc}, {cityLabelFor(p)}</div>

            {facts.length ? (
              <div className="dz-mdp-facts">
                {facts.map((fct, i) => (
                  <div className="dz-mdp-fact" key={i}>
                    <Icon name={fct.icon} />
                    <div><b>{fct.value}</b><span>{fct.label}</span></div>
                  </div>
                ))}
              </div>
            ) : null}

            {amenities.length ? (
              <div className="dz-mdp-sect">
                <div className="dz-mdp-sect-hd">Amenities</div>
                <div className="dz-mdp-chips">
                  {amenities.map((k) => (
                    <span className="dz-mdp-chip" key={k}><Icon name={AMEN_ICON[k] || 'check'} /> {amenLabel(k)}</span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="dz-mdp-sect">
              <div className="dz-mdp-sect-hd">Overview</div>
              <p className="dz-mdp-desc">
                {t(overviewFeatures ? 'property.mapOverviewWithAmenities' : 'property.mapOverviewBasic', {
                  type: `${p.bhkNum ? p.bhkNum + ' BHK ' : ''}${(p.type || 'home').toLowerCase()}`,
                  locality: loc,
                  features: overviewFeatures,
                  disclosure: t('property.mapDirectOwner'),
                })}
              </p>
            </div>
          </div>
        </div>

        <div className="dz-mdp-actions">
          <div className="dz-mdp-cta-row">
            {isOwner ? (
              <Link to="/dashboard?tab=listings" className="dz-mdp-btn is-primary"><Icon name="layout-dashboard" /> {t('property.manageListing')}</Link>
            ) : (
              <button type="button" className="dz-mdp-btn is-primary" onClick={contact}><Icon name="phone" /> {t('property.contactOwner')}</button>
            )}
            {!isOwner && scheduleEnabled ? <button type="button" className="dz-mdp-btn is-ghost" onClick={schedule}><Icon name="calendar-check" /> Schedule</button> : null}
          </div>
          <Link
            to={propertyHref(p)}
            state={{ from: fromSearch, restore: true }}
            onClick={onOpenFull}
            onMouseEnter={() => import('../../pages/consumer/Property.jsx')}
            className="dz-mdp-full"
          >
            Open full page <Icon name="arrow-right" />
          </Link>
        </div>
      </aside>

      {contactOpen ? <ContactOwnerModal p={p} isIn={signedIn} onClose={() => setContactOpen(false)} toast={toast} /> : null}
      {visitOpen && scheduleEnabled ? <ScheduleVisitModal p={p} isIn={signedIn} onClose={() => setVisitOpen(false)} toast={toast} /> : null}
      <InlineOtpSheet open={!!inlineOtpReason} reason={inlineOtpReason || 'contact'} onClose={() => { setInlineOtpReason(null); setResumeAction(null); }} onVerified={() => { resumeAfterInlineOtpCloses(); setInlineOtpReason(null); }} />
    </>
  );
}
