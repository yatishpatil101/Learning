import { memo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { srcSetFor, CARD_SIZES } from '../../../lib/imgSrcSet.js';
import Icon from '../../../components/Icon.jsx';
import { fmtINR, timeAgo } from '../../../lib/format.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useCompare } from '../../../context/CompareContext.jsx';
import { useSaved } from '../../../context/SavedContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { useAppFlags } from '../../../context/AppFlagsContext.jsx';
import { haptic } from '../../../lib/haptics.js';
import { emiOf, tenantLabel } from './matchers.js';
import { AMEN_LBL, FURN_LBL, SHARING_LBL } from './constants.js';
import { cityLabelFor } from '../../../lib/geoConfig.js';
import { isFeaturedActive } from '../../../lib/featured.js';

const Card = memo(function Card({ p, locName, index = 0, list = false, linkState, onOpen }) {
  const { t } = useTranslation();
  const { isIn } = useAuth();
  const navigate = useNavigate();
  const { flagEnabled } = useAppFlags();
  const compare = useCompare();
  const savedList = useSaved();
  const { toast } = useToast();
  // Read from the shared set rather than per-card state: thirty cards asking the network the same
  // question thirty times is what this context exists to prevent.
  const saved = savedList.has(p.id);
  const showCompare = flagEnabled('compareProperties');
  const inCompare = compare ? compare.has(p.id) : false;
  const handleHeart = (e) => {
    e.preventDefault();
    if (!isIn) { navigate(`/signin?reason=save&next=${encodeURIComponent('/listings')}`); return; }
    savedList.toggle(p.id);
    /* Saving is the one action on a results card that changes state without moving
       the user anywhere: the card stays put and a small heart changes colour, which
       is easy to miss mid-scroll with a thumb over it. The tick is the confirmation
       the visual can't reliably give. No-op on iOS and under reduce-motion.
       Fired on the tap, not on the response — the toggle is optimistic, and haptics
       that arrive a round trip late read as lag rather than as feedback. */
    haptic('tick');
  };
  const handleCompare = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!compare) return;
    if (inCompare || compare.count < 4) {
      compare.toggle(p.id);
      toast(inCompare ? t('listings.removedFromCompare') : t('listings.addedToCompare'), 'toggle');
    } else {
      toast(t('listings.compareLimit'), 'warning');
    }
  };
  // Make the span[role=button] controls keyboard-operable (Enter/Space). They can't
  // be real <button>s here because the whole card is an <a> (nested-interactive).
  const onKeyActivate = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); } };
  const isRent = p.deal === 'rent';
  const verified = p.ownerVerified || p.ownershipVerified;
  const isPgShare = p.shareType === 'pg' || p.shareType === 'flatmates';
  // A PG's `sharing` is an array of occupancy types (single/double/…); legacy and
  // synthetic stock may still carry a single key. Show the first, "+N" if more.
  const sharingKeys = Array.isArray(p.sharing) ? p.sharing : (p.sharing ? [p.sharing] : []);
  const sharingText = p.shareType === 'pg' && sharingKeys.length
    ? (SHARING_LBL[sharingKeys[0]] || t('listings.sharing')) + (sharingKeys.length > 1 ? ` +${sharingKeys.length - 1}` : '')
    : t('listings.sharing');
  const isPlot = ['plot', 'open plot', 'farm land'].includes((p.type || '').toLowerCase());
  const baths = Number(p.bath) || 0;
  const psf = p.area ? Math.round((p.price || 0) / p.area) : 0;
  const deposit = Number(p.deposit) || (isRent ? (p.price || 0) * 2 : 0);
  const isUnderOffer = p.status === 'under-offer';
  const postedByPuneNest = !!p.postedByAdmin;
  const posterLabel = postedByPuneNest ? 'PuneNest' : t('listings.owner');
  const posterIcon = postedByPuneNest ? 'shield-check' : 'user';
  let title = isPlot ? (p.type && (p.type || '').toLowerCase() !== 'plot' ? p.type : t('listings.titleResidentialPlot')) : p.bhkNum ? `${p.bhkNum} BHK ${p.type}` : p.type;
  if (p.shareType === 'pg') title = t('listings.titlePgHostel');
  else if (p.shareType === 'flatmates') title = t('listings.titleFlatmateShared');
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
    if (p.rera) chips.push(['badge-check', 'RERA']);
  }
  if (isUnderOffer) chips.push(['handshake', t('listings.underOffer')]);

  if (list) {
    const loc = locName || p.locality;
    const furn = FURN_LBL[p.furnishing] || '';
    const status = isRent
      ? ({ now: t('listings.listStatusAvailableNow'), '15': t('listings.listStatusAvailable15'), '30': t('listings.listStatusAvailable30') }[p.availableFrom] || t('listings.listStatusAvailable'))
      : ({ ready: t('listings.readyToMove'), under: t('listings.underConstruction'), new: t('listings.newLaunch') }[p.construction] || '');
    const sub = isRent ? furn : t('listings.psfEmi', { psf: Math.round((p.price || 0) / (p.area || 1)).toLocaleString('en-IN'), emi: emiOf(p.price) });
    const amenChips = (p.amenities || []).slice(0, 4);
    return (
      <Link to={`/property/${p.id}`} state={linkState} onClick={onOpen} viewTransition onMouseEnter={() => import('../Property.jsx')} className="list-card card-hover glass rounded-2xl overflow-hidden t-all block list-reveal" style={{ animationDelay: `${120 + Math.min(index, 14) * 45}ms` }}>
        <div className="lr">
          <div className="lr-img">
            <img src={p.image} srcSet={srcSetFor(p.image)} sizes={CARD_SIZES} alt={p.title} width={248} height={186} className="w-full h-full object-cover" loading="lazy" />
            {verified ? (
              <span className="badge-verified-icon absolute top-3 left-3" title={[p.ownerVerified ? t('listings.verifOwner') : '', p.ownershipVerified ? t('listings.verifOwnership') : ''].filter(Boolean).join(' · ')}>
                <Icon name="shield-check" />
              </span>
            ) : null}
            {isFeaturedActive(p) && (
              <span className="absolute bottom-3 left-3 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/70 text-amber-50">Featured</span>
            )}
            <div className="absolute top-3 right-3 flex flex-col gap-2">
              <span className={'heart-btn w-11 h-11 sm:w-9 sm:h-9 rounded-full bg-black/40 backdrop-blur flex items-center justify-center t-all hover:bg-black/60' + (saved ? ' active' : '')} role="button" tabIndex={0} onClick={handleHeart} onKeyDown={onKeyActivate(handleHeart)} aria-label={saved ? t('listings.removeFromSaved') : t('listings.saveProperty')} aria-pressed={saved}>
                <Icon name="heart" weight={saved ? 'fill' : 'regular'} className="w-4 h-4" />
              </span>
              {showCompare ? (
                <span className={'w-11 h-11 sm:w-9 sm:h-9 rounded-full backdrop-blur flex items-center justify-center t-all ' + (inCompare ? 'bg-teal-500/80 text-white hover:bg-teal-500' : 'bg-black/40 text-gray-200 hover:bg-black/60')} role="button" tabIndex={0} onClick={handleCompare} onKeyDown={onKeyActivate(handleCompare)} aria-label={inCompare ? t('listings.removeFromCompare') : t('listings.addToCompare')} aria-pressed={inCompare} title={inCompare ? t('listings.removeFromCompare') : t('listings.addToCompare')}>
                  <Icon name="git-compare" className="w-4 h-4" />
                </span>
              ) : null}
            </div>
          </div>
          <div className="lr-body">
            <div className="lr-info">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-white">{title}</h3>
                {p.ownerVerified ? <span className="badge-verified px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider inline-flex items-center gap-1"><Icon name="user-check" className="w-2.5 h-2.5" /> {t('listings.verifOwner')}</span> : null}
                {p.ownershipVerified ? <span className="badge-rera px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider inline-flex items-center gap-1"><Icon name="file-check" className="w-2.5 h-2.5" /> {t('listings.verifOwnership')}</span> : null}
              </div>
              <p className="flex items-center gap-1 text-sm text-gray-400 mt-1"><Icon name="map-pin" className="w-3.5 h-3.5 text-teal-400" /> {loc}, {cityLabelFor(p)}</p>
              <div className="flex items-center gap-4 mt-3 text-sm text-gray-300 flex-wrap">
                {p.bhkNum ? <span className="flex items-center gap-1.5"><Icon name="bed-double" className="w-4 h-4 text-gray-500" /> {p.bhkNum} {t('listings.beds')}</span> : null}
                {baths ? <span className="flex items-center gap-1.5"><Icon name="bath" className="w-4 h-4 text-gray-500" /> {baths} {t('listings.baths')}</span> : null}
                <span className="flex items-center gap-1.5"><Icon name="maximize-2" className="w-4 h-4 text-gray-500" /> {(p.area || 0).toLocaleString('en-IN')} {t('listings.sqftDot')}</span>
                {furn ? <span className="flex items-center gap-1.5"><Icon name="sofa" className="w-4 h-4 text-gray-500" /> {furn}</span> : null}
              </div>
              {amenChips.length ? (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {amenChips.map((a) => (
                    <span key={a} className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-gray-400">{AMEN_LBL[a] || a}</span>
                  ))}
                </div>
              ) : null}
              <p className="flex items-center gap-1 text-[11px] mt-3 text-gray-500"><Icon name="clock" className="w-3 h-3" /> {t('listings.posted')} {timeAgo(p.createdAt)}
                {postedByPuneNest ? <span className="ml-auto inline-flex items-center gap-1 font-medium text-teal-300/90"><Icon name={posterIcon} className="w-3 h-3" /> {posterLabel}</span> : null}
              </p>
            </div>
            <div className="lr-aside">
              <span className="lr-status">{status}</span>
              <h3 className="text-xl font-extrabold text-white mt-1">
                {isRent ? <>₹{(p.price || 0).toLocaleString('en-IN')}<span className="text-sm font-medium text-gray-400">{t('listings.perMonth')}</span></> : fmtINR(p.price)}
              </h3>
              <span className="text-[11px] text-gray-500 mt-0.5">{sub}</span>
              <span className="lr-cta mt-3">{t('listings.viewDetails')} <Icon name="arrow-right" className="w-4 h-4" /></span>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link to={`/property/${p.id}`} state={linkState} onClick={onOpen} viewTransition onMouseEnter={() => import('../Property.jsx')} className="card-hover glass rounded-2xl overflow-hidden t-all block list-reveal" style={{ animationDelay: `${120 + Math.min(index, 14) * 45}ms` }}>
      <div className="relative overflow-hidden card-img-wrap h-48">
        <img src={p.image} srcSet={srcSetFor(p.image)} sizes={CARD_SIZES} alt={p.title} width={400} height={192} className="card-img w-full h-full object-cover" loading="lazy" style={{ viewTransitionName: `property-hero-${p.id}` }} />
        {verified ? (
          <span className="badge-verified-icon absolute top-3 left-3" title={[p.ownerVerified ? t('listings.verifOwner') : '', p.ownershipVerified ? t('listings.verifOwnership') : ''].filter(Boolean).join(' · ')}>
            <Icon name="shield-check" />
          </span>
        ) : null}
        <div className="absolute top-3 right-3 flex flex-col gap-2">
          <span className={'heart-btn w-11 h-11 sm:w-9 sm:h-9 rounded-full bg-black/40 backdrop-blur flex items-center justify-center t-all hover:bg-black/60' + (saved ? ' active' : '')} role="button" tabIndex={0} onClick={handleHeart} onKeyDown={onKeyActivate(handleHeart)} aria-label={saved ? t('listings.removeFromSaved') : t('listings.saveProperty')} aria-pressed={saved}>
            <Icon name="heart" weight={saved ? 'fill' : 'regular'} className="w-4 h-4" />
          </span>
          {showCompare ? (
            <span className={'w-11 h-11 sm:w-9 sm:h-9 rounded-full backdrop-blur flex items-center justify-center t-all ' + (inCompare ? 'bg-teal-500/80 text-white hover:bg-teal-500' : 'bg-black/40 text-gray-200 hover:bg-black/60')} role="button" tabIndex={0} onClick={handleCompare} onKeyDown={onKeyActivate(handleCompare)} aria-label={inCompare ? t('listings.removeFromCompare') : t('listings.addToCompare')} aria-pressed={inCompare} title={inCompare ? t('listings.removeFromCompare') : t('listings.addToCompare')}>
              <Icon name="git-compare" className="w-4 h-4" />
            </span>
          ) : null}
        </div>
        <div className="absolute bottom-3 left-3 flex gap-1.5 flex-wrap">
          {isFeaturedActive(p) && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/70 text-amber-50">Featured</span>
          )}
          {isRent ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-teal-600/50 text-teal-50">{t('listings.badgeRent')}</span>
          ) : (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-600/50 text-emerald-50">{t('listings.badgeSale')}</span>
          )}
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
          {isPgShare ? (
            <>
              <span className="flex items-center gap-1"><Icon name="users" className="w-3.5 h-3.5" /> {sharingText}</span>
              {p.area ? <span className="flex items-center gap-1"><Icon name="maximize-2" className="w-3.5 h-3.5" /> {p.area.toLocaleString('en-IN')} {t('listings.sqft')}</span> : null}
            </>
          ) : isPlot ? (
            p.area ? <span className="flex items-center gap-1"><Icon name="maximize-2" className="w-3.5 h-3.5" /> {p.area.toLocaleString('en-IN')} {t('listings.sqft')}</span> : null
          ) : (
            <>
              {p.bhkNum ? <span className="flex items-center gap-1"><Icon name="bed-double" className="w-3.5 h-3.5" /> {p.bhkNum} BHK</span> : null}
              {baths ? <span className="flex items-center gap-1"><Icon name="bath" className="w-3.5 h-3.5" /> {baths} {t('listings.bath')}</span> : null}
              {p.area ? <span className="flex items-center gap-1"><Icon name="maximize-2" className="w-3.5 h-3.5" /> {p.area.toLocaleString('en-IN')} {t('listings.sqft')}</span> : null}
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
        <p className="flex items-center gap-1 text-[11px] mt-3 pt-3 border-t border-white/5 text-gray-500"><Icon name="clock" className="w-3 h-3" /> {t('listings.posted')} {timeAgo(p.createdAt)}
          {postedByPuneNest ? <span className="ml-auto inline-flex items-center gap-1 font-medium text-teal-300/90"><Icon name={posterIcon} className="w-3 h-3" /> {posterLabel}</span> : null}
        </p>
      </div>
    </Link>
  );
});

export default Card;
