import { memo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CARD_SIZES } from '../../../lib/imgSrcSet.js';
import Icon from '../../../components/Icon.jsx';
import PropertyImage from '../../../components/ui/PropertyImage.jsx';
import { fmtArea, fmtINR } from '../../../lib/format.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useSaved } from '../../../context/SavedContext.jsx';
import { haptic } from '../../../lib/haptics.js';
import { onActivateKey } from '../../../lib/onActivateKey.js';
import { emiOf, tenantLabel } from './matchers.js';
import { AMEN_LBL, FURN_LBL } from './constants.js';
import { cityLabelFor } from '../../../lib/geoConfig.js';
import { useSignInGate } from '../../../lib/useSignInGate.js';
import { propertyHref } from '../../../lib/listingSeo.js';

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

const Card = memo(function Card({ p, locName, index = 0, list = false, linkState, onOpen }) {
  const { t } = useTranslation();
  const { isIn } = useAuth();
  const savedList = useSaved();
  const sendToSignIn = useSignInGate();
  // Read from the shared set rather than per-card state: thirty cards asking the network the same
  // question thirty times is what this context exists to prevent.
  const saved = savedList.has(p.id);
  const handleHeart = (e) => {
    e.preventDefault();
    if (!isIn) { sendToSignIn('save'); return; }
    savedList.toggle(p.id, p.uuid);
    haptic('tick');
  };
  const onHeartKey = onActivateKey(handleHeart);
  const isRent = p.deal === 'rent';
  const verified = p.ownerVerified || p.ownershipVerified;
  const posterVerifiedLabel = p.ownerVerified
    ? t('property.verifiedOwner')
    : '';
  const verifiedLabel = [posterVerifiedLabel, p.ownershipVerified ? t('property.ownershipVerified') : ''].filter(Boolean).join(' · ');
  const isShare = p.shareType === 'flatmates';
  const isPlot = isLandListing(p);
  const baths = Number(p.bath) || 0;
  const area = Number(p.area) > 0 ? Number(p.area) : 0;
  const areaLabel = area ? fmtArea(area, p.areaUnit) : '';
  const psf = !isRent && area ? Math.round((p.price || 0) / area) : 0;
  const deposit = Number(p.deposit) > 0 ? Number(p.deposit) : 0;
  const maintenance = Number(p.maintenance) > 0 ? Number(p.maintenance) : 0;
  const isUnderOffer = p.dealStatus === 'reserved' || p.status === 'under-offer';
  const isDealClosed = p.dealStatus === 'closed' || p.status === 'sold' || p.status === 'rented';
  const bhkLabel = p.bhkNum == null ? '' : p.bhkNum === 0 ? '1 RK' : `${p.bhkNum} BHK`;
  let title = isPlot ? landTitle(p, t) : bhkLabel ? `${bhkLabel} ${p.type}` : p.type;
  if (p.shareType === 'flatmates') title = t('listings.titleFlatmateShared');
  const chips = [];
  if (isRent) {
    const tl = tenantLabel(p.tenants);
    if (tl) chips.push(['users', tl]);
    const av = { now: t('listings.availableNow'), '15': t('listings.availableIn15'), '30': t('listings.availableIn30') }[p.availableFrom];
    if (av) chips.push(['calendar-check', av]);
    if (p.pets) chips.push(['paw-print', t('listings.petFriendly')]);
  } else {
    if (p.construction === 'ready') chips.push(['building-2', t('listings.readyToMove')]);
    else if (p.construction === 'under') chips.push(['building-2', t('listings.underConstruction')]);
    else if (p.construction === 'new') chips.push(['sparkles', t('listings.newLaunch')]);
    if (p.reraId) chips.push(['badge-check', t('listings.reraBadge')]);
  }
  if (isUnderOffer) chips.push(['handshake', t('listings.underOffer')]);
  if (isDealClosed) chips.push(['lock', isRent ? t('listings.rentedOut') : t('listings.soldOut')]);

  if (list) {
    const loc = locName || p.locality;
    const furn = FURN_LBL[p.furnishing] || '';
    const status = isRent
      ? ({ now: t('listings.listStatusAvailableNow'), '15': t('listings.listStatusAvailable15'), '30': t('listings.listStatusAvailable30') }[p.availableFrom] || t('listings.listStatusAvailable'))
      : ({ ready: t('listings.readyToMove'), under: t('listings.underConstruction'), new: t('listings.newLaunch') }[p.construction] || '');
    const sub = isRent
      ? (maintenance ? t('listings.maintenanceExtra', { amount: maintenance.toLocaleString('en-IN') }) : '')
      : (psf ? t('listings.psfEmi', { psf: psf.toLocaleString('en-IN'), emi: emiOf(p.price) }) : t('listings.emiFrom', { emi: emiOf(p.price) }));
    const amenChips = (p.amenities || []).slice(0, 4);
    return (
      <Link to={propertyHref(p)} state={linkState} onClick={onOpen} viewTransition onMouseEnter={() => import('../Property.jsx')} className="list-card card-hover glass rounded-2xl overflow-hidden t-all block list-reveal" style={{ animationDelay: `${120 + Math.min(index, 14) * 45}ms` }}>
        <div className="lr">
          <div className="lr-img">
            <PropertyImage src={p.image} sizes={CARD_SIZES} alt={p.title} width={248} height={186} className="w-full h-full object-cover" loading="lazy" />
            {verified ? (
              <span className="badge-verified-icon absolute top-3 left-3" role="img" aria-label={verifiedLabel} title={verifiedLabel}>
                <Icon name="shield-check" />
              </span>
            ) : null}
            <div className="absolute bottom-3 left-3 flex gap-1.5 flex-wrap">
              {p.featured && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/70 text-amber-50">Featured</span>
              )}
            </div>
            <span className={'heart-btn heart-on-photo absolute top-3 right-3 w-11 h-11 [@media(pointer:fine)]:w-9 [@media(pointer:fine)]:h-9 flex items-center justify-center t-all' + (saved ? ' active' : '')} role="button" tabIndex={0} onClick={handleHeart} onKeyDown={onHeartKey} aria-label={saved ? t('listings.removeFromSaved') : t('listings.saveProperty')} aria-pressed={saved}>
              <Icon name="heart" weight={saved ? 'fill' : 'regular'} className="w-6 h-6" />
            </span>
          </div>
          <div className="lr-body">
            <div className="lr-info">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-white">{title}</h3>
                {p.ownerVerified ? <span className="badge-verified px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider inline-flex items-center gap-1"><Icon name="user-check" className="w-2.5 h-2.5" /> {posterVerifiedLabel}</span> : null}
                {p.ownershipVerified ? <span className="badge-rera px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider inline-flex items-center gap-1"><Icon name="file-check" className="w-2.5 h-2.5" /> {t('property.ownershipVerified')}</span> : null}
                {p.reraId ? <span className="badge-rera px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider inline-flex items-center gap-1"><Icon name="badge-check" className="w-2.5 h-2.5" /> {t('listings.reraBadge')}</span> : null}
              </div>
              <p className="flex items-center gap-1 text-sm text-gray-400 mt-1"><Icon name="map-pin" className="w-3.5 h-3.5 text-teal-400" /> {loc}, {cityLabelFor(p)}</p>
              <div className="flex items-center gap-4 mt-3 text-sm text-gray-300 flex-wrap">
                {bhkLabel ? <span className="flex items-center gap-1.5"><Icon name="bed-double" className="w-4 h-4 text-gray-500" /> {bhkLabel}</span> : null}
                {baths ? <span className="flex items-center gap-1.5"><Icon name="bath" className="w-4 h-4 text-gray-500" /> {baths} {t('listings.baths')}</span> : null}
                {areaLabel ? <span className="flex items-center gap-1.5"><Icon name="maximize-2" className="w-4 h-4 text-gray-500" /> {areaLabel}</span> : null}
                {furn ? <span className="flex items-center gap-1.5"><Icon name="sofa" className="w-4 h-4 text-gray-500" /> {furn}</span> : null}
              </div>
              {amenChips.length ? (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {amenChips.map((a) => (
                    <span key={a} className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-gray-400">{AMEN_LBL[a] || a}</span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="lr-aside">
              <span className="lr-status">{status}</span>
              <h3 className="text-xl font-extrabold text-white mt-1">
                {isRent ? <>₹{(p.price || 0).toLocaleString('en-IN')}<span className="text-sm font-medium text-gray-400">{t('listings.perMonth')}</span></> : fmtINR(p.price)}
              </h3>
              {sub ? <span className="text-[11px] text-gray-500 mt-0.5">{sub}</span> : null}
              <span className="lr-cta mt-3">{t('listings.viewDetails')} <Icon name="arrow-right" className="w-4 h-4" /></span>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link to={propertyHref(p)} state={linkState} onClick={onOpen} viewTransition onMouseEnter={() => import('../Property.jsx')} className="card-hover glass rounded-2xl overflow-hidden t-all block list-reveal" style={{ animationDelay: `${120 + Math.min(index, 14) * 45}ms` }}>
      <div className="relative overflow-hidden card-img-wrap h-48">
        <PropertyImage src={p.image} sizes={CARD_SIZES} alt={p.title} width={400} height={192} className="card-img w-full h-full object-cover" loading="lazy" style={{ viewTransitionName: `property-hero-${p.id}` }} />
        {verified ? (
          <span className="badge-verified-icon absolute top-3 left-3" role="img" aria-label={verifiedLabel} title={verifiedLabel}>
            <Icon name="shield-check" />
          </span>
        ) : null}
        <span className={'heart-btn heart-on-photo absolute top-3 right-3 w-11 h-11 [@media(pointer:fine)]:w-9 [@media(pointer:fine)]:h-9 flex items-center justify-center t-all' + (saved ? ' active' : '')} role="button" tabIndex={0} onClick={handleHeart} onKeyDown={onHeartKey} aria-label={saved ? t('listings.removeFromSaved') : t('listings.saveProperty')} aria-pressed={saved}>
          <Icon name="heart" weight={saved ? 'fill' : 'regular'} className="w-6 h-6" />
        </span>
        <div className="absolute bottom-3 left-3 flex gap-1.5 flex-wrap">
          {p.featured && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/70 text-amber-50">Featured</span>
          )}
          {isRent ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-teal-600/50 text-teal-50">{t('listings.badgeRent')}</span>
          ) : (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-600/50 text-emerald-50">{t('listings.badgeSale')}</span>
          )}
          {p.reraId ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-600/60 text-emerald-50">{t('listings.reraBadge')}</span>
          ) : null}
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-white leading-snug">{title}</p>
            <p className="flex items-center gap-1 text-xs text-gray-400 mt-1">
              <Icon name="map-pin" className="w-3 h-3 text-teal-400 flex-shrink-0" />
              <span className="truncate">{locName || p.locality}, {cityLabelFor(p)}</span>
            </p>
          </div>
          <div className="flex-shrink-0 text-right">
            <h3 className="text-lg font-extrabold text-white leading-tight whitespace-nowrap">
              {isRent ? <>₹{(p.price || 0).toLocaleString('en-IN')}<span className="text-sm font-normal text-gray-400">{t('listings.perMonth')}</span></> : fmtINR(p.price)}
            </h3>
            {isRent
              ? (deposit > 0 ? <span className="block text-[11px] text-gray-500 mt-0.5 whitespace-nowrap"><span className="text-gray-400">{t('listings.deposit')}</span> ₹{deposit.toLocaleString('en-IN')}</span> : null)
              : (psf > 0 ? <span className="block text-[11px] text-gray-500 mt-0.5 whitespace-nowrap">₹{psf.toLocaleString('en-IN')}<span className="text-gray-400">/{t('listings.sqft')}</span></span> : null)}
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400 mt-3 flex-wrap">
          {isShare ? (
            <>
              <span className="flex items-center gap-1"><Icon name="users" className="w-3.5 h-3.5" /> {t('listings.sharing')}</span>
              {areaLabel ? <span className="flex items-center gap-1"><Icon name="maximize-2" className="w-3.5 h-3.5" /> {areaLabel}</span> : null}
            </>
          ) : isPlot ? (
            areaLabel ? <span className="flex items-center gap-1"><Icon name="maximize-2" className="w-3.5 h-3.5" /> {areaLabel}</span> : null
          ) : (
            <>
              {bhkLabel ? <span className="flex items-center gap-1"><Icon name="bed-double" className="w-3.5 h-3.5" /> {bhkLabel}</span> : null}
              {baths ? <span className="flex items-center gap-1"><Icon name="bath" className="w-3.5 h-3.5" /> {baths} {t('listings.bath')}</span> : null}
              {areaLabel ? <span className="flex items-center gap-1"><Icon name="maximize-2" className="w-3.5 h-3.5" /> {areaLabel}</span> : null}
              {isRent && p.furnishing ? <span className="flex items-center gap-1"><Icon name="sofa" className="w-3.5 h-3.5" /> {FURN_LBL[p.furnishing] || p.furnishing}</span> : null}
            </>
          )}
        </div>
        {chips.length ? (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {chips.map(([ic, label]) => (
              <span key={label} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[11px] text-gray-300"><Icon name={ic} className="w-3 h-3 text-teal-400" /> {label}</span>
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
});

export default Card;
