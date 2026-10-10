import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import Icon from '../../components/Icon.jsx';
import Breadcrumbs from '../../components/Breadcrumbs.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import { messagesLinkForProp } from '../../lib/chatFormat.js';
import { queuePendingChat } from '../../services/conversationService.js';
import useSheetViewport from '../../lib/useSheetViewport.js';
import { Gallery } from './property/Gallery.jsx';
import PropertySkeleton from './property/PropertySkeleton.jsx';
import useProperty from './property/useProperty.js';
import PropertyHeader from './property/PropertyHeader.jsx';
import PropertyTabs from './property/PropertyTabs.jsx';
import PropertyModals from './property/PropertyModals.jsx';
import ListingUnavailable from './property/ListingUnavailable.jsx';
import usePageHead from '../../lib/usePageHead.js';
import { listingHead, propertyHref } from '../../lib/listingSeo.js';

export default function Property() {
  const location = useLocation();
  const navigate = useNavigate();
  const [visitIntent, setVisitIntent] = useState(() => new URLSearchParams(location.search).get('visit') === '1');
  const ctx = useProperty();
  const priceOnHero = useSheetViewport();
  const { tr } = ctx;
  const { p, isIn, setVisitOpen, visitOpen, flagEnabled } = ctx;
  const head = p ? listingHead({ bhk: p.bhkNum, type: p.type, deal: p.deal, locality: p.locality, price: p.price, area: p.area, areaUnit: p.areaUnit }) : {};
  usePageHead({ ...head, path: p ? propertyHref(p) : undefined, noindex: Boolean(p) && (p.status !== 'approved' || p.dealStatus === 'closed') });
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('visit') !== '1') return;
    setVisitIntent(true);
    params.delete('visit');
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ''}${location.hash}`, { replace: true, state: location.state });
  }, [location.hash, location.pathname, location.search, location.state, navigate]);
  useEffect(() => {
    if (!visitIntent || !p || visitOpen || !setVisitOpen) return;
    if (!flagEnabled?.('scheduleVisit')) {
      setVisitIntent(false);
      return;
    }
    if (!isIn) return;
    setVisitOpen(true);
    setVisitIntent(false);
  }, [flagEnabled, isIn, p, setVisitOpen, visitIntent, visitOpen]);
  // A skeleton in the page's own shape rather than a centred spinner: it holds the
  // layout, so the hero arriving does not shove the page down.
  if (ctx.loading) return <PropertySkeleton />;
  if (ctx.notFound) return <ListingUnavailable reason="not-found" tr={tr} />;
  if (ctx.underReview) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-32 text-center">
        <Icon name="clock" className="w-10 h-10 text-amber-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">{tr('property.underReviewTitle')}</h2>
        <p className="text-gray-400 text-sm">{tr('property.underReviewBody')}</p>
      </div>
    );
  }
  if (ctx.dealClosed) {
    return <ListingUnavailable reason="closed" listing={p} closedWord={ctx.closedWord} tr={tr} />;
  }
  if (ctx.listingPaused) {
    return <ListingUnavailable reason="paused" listing={p} tr={tr} />;
  }

  const {
    rootRef, returnTo, isRent, title, gallery, active, setActive,
    setLightbox, requestPhotos, tabs, current, selectTab,
    contactApproved, handleContact, handleSchedule, canChat, isOwner, ownerPreview, staffPreview,
  } = ctx;
  const openChat = async (event) => {
    event?.preventDefault();
    await queuePendingChat(p, { active: true });
    navigate(messagesLinkForProp(p));
  };

  return (
    <div ref={rootRef} className="dz-property">

      <div className="pt-[calc(var(--dz-nav-h)+16px)] sm:pt-[calc(var(--dz-nav-h)+40px)] pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          {ownerPreview && (
            <div role="status" className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3">
              <Icon name="clock" className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
              <p className="text-amber-200 text-sm">{tr(staffPreview ? 'property.staffPreview' : 'property.ownerPreview')}</p>
            </div>
          )}

          <Breadcrumbs
            className="mb-2 sm:mb-4"
            trail={[
              [tr('property.home'), '/'],
              [isRent ? tr('property.breadcrumbRent') : tr('property.breadcrumbBuy'), returnTo, { restore: true }],
              [p.locality, p.localitySlug ? `/locality/${p.localitySlug}` : returnTo],
              ...(p.societySlug && p.societyName ? [[p.societyName, `/society/${p.societySlug}`]] : []),
              [title, null],
            ]}
          />

          {/* Keyed on the listing: `active` is reset here on an id change but the gallery's own `ask` slide is not,
             so an in-place navigation would otherwise park the next listing's hero on its request-photos card. */}
          <Gallery key={p.id} gallery={gallery} active={active} setActive={setActive} title={title} p={p} setLightbox={setLightbox} requestPhotos={requestPhotos} priceStr={priceOnHero ? ctx.priceStr : null} />

          <PropertyHeader ctx={ctx} priceOnHero={priceOnHero} />

          {/* SECTION TABS — collapse the long scroll into grouped tabs. */}
          <div className="dz-docks-under-nav sticky top-[var(--dz-nav-h)] z-30 section-mb flex items-stretch">
            <HScroll role="tablist" aria-label={tr('property.tablistAria')} wrapClassName="flex-1 min-w-0" className="flex gap-1 sm:gap-2 border-b border-white/10 bg-ink/80 backdrop-blur-md">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={current === t.id}
                  onClick={() => selectTab(t.id)}
                  className={`dz-detail-tab ${current === t.id ? 'is-active' : ''}`}
                >
                  <Icon name={t.icon} className="w-4 h-4" /> <span>{t.label}</span>
                </button>
              ))}
            </HScroll>

            {/* Outside the tablist: a CTA is not a tab, and HScroll's row would scroll it out of reach. */}
            <div className="hidden lg:flex items-center pl-3 border-b border-white/10 bg-ink/80 backdrop-blur-md">
              {isOwner ? (
                <Link to="/dashboard?tab=listings" className="btn-teal flex items-center gap-1.5 text-sm font-semibold py-2 px-4 shadow-none">
                  <Icon name="layout-dashboard" className="w-4 h-4" /> {tr('property.manageListing')}
                </Link>
              ) : contactApproved && canChat ? (
                <Link to={messagesLinkForProp(p)} onClick={openChat} className="btn-teal flex items-center gap-1.5 text-sm font-semibold py-2 px-4 shadow-none">
                  <Icon name="message-circle" className="w-4 h-4" /> {tr('property.chat')}
                </Link>
              ) : (
                /* Deliberately no wa.me deep link and no number on this surface: it routes through the same gate as
                   every other contact entry point, so an always-visible CTA is not a way around it. */
                <button type="button" onClick={handleContact} className="btn-teal flex items-center gap-1.5 text-sm font-semibold py-2 px-4 shadow-none">
                  <Icon name="message-circle" className="w-4 h-4" /> {tr('property.contactOwner')}
                </button>
              )}
            </div>
          </div>

          <PropertyTabs ctx={ctx} />

        </div>
      </div>

      <div className="dz-sticky-cta lg:hidden">
        {isOwner ? (
          <Link to="/dashboard?tab=listings" className="btn-teal flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-semibold py-3 px-4"><Icon name="layout-dashboard" className="w-4 h-4" /> {tr('property.manageListing')}</Link>
        ) : (
          /* Never branches on approval: the sidebar owner card is `lg:` only, so this sheet is
           * a phone's only surface for the number, WhatsApp and chat in every gate state. */
          <button type="button" onClick={handleContact} className="btn-teal flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-semibold py-3 px-4"><Icon name="message-circle" className="w-4 h-4" /> {tr('property.contactOwner')}</button>
        )}

        {!isOwner && flagEnabled('scheduleVisit') && <button type="button" onClick={handleSchedule} className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-white/15 text-slate-200 text-sm font-semibold px-[1.125rem]"><Icon name="calendar" className="w-4 h-4" /> {tr('property.visit')}</button>}
      </div>

      <PropertyModals ctx={ctx} />
    </div>
  );
}
