import { Link } from 'react-router';
import Icon from '../../components/Icon.jsx';
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

export default function Property() {
  const ctx = useProperty();
  /* Decided above the early returns so the hook order is stable, and centrally so that exactly one price
     element is ever rendered across the hero and the header. */
  const priceOnHero = useSheetViewport();
  const { tr } = ctx;
  // A skeleton in the page's own shape rather than a centred spinner: it holds the
  // layout, so the hero arriving does not shove the page down.
  if (ctx.loading) return <PropertySkeleton />;
  if (ctx.notFound) return <div className="mx-auto max-w-3xl px-4 py-32 text-center text-slate-400">{tr('property.notFound')}</div>;
  if (ctx.underReview) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-32 text-center">
        <Icon name="clock" className="w-10 h-10 text-amber-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">{tr('property.underReviewTitle')}</h2>
        <p className="text-gray-400 text-sm">{tr('property.underReviewBody')}</p>
      </div>
    );
  }
  /* Same two sentences DealPanel shows on a still-live listing whose deal closed, so the answer does not
     depend on which of the two routes into "closed" the listing took. */
  if (ctx.dealClosed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-32 text-center">
        <Icon name="check-circle" className="w-10 h-10 text-slate-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">{tr('property.noLongerAvailable')}</h2>
        <p className="text-gray-400 text-sm">{tr('property.propertyBeenSub', { word: ctx.closedWord })}</p>
      </div>
    );
  }

  const {
    rootRef, returnTo, isRent, p, title, gallery, active, setActive,
    flagEnabled, setLightbox, setTourOpen, requestPhotos, tabs, current, selectTab,
    contactApproved, handleContact, canChat, ownerPreview, staffPreview,
  } = ctx;

  return (
    <div ref={rootRef} className="dz-property">
      {/* selfPadded route — reserves the fixed navbar itself, from the token. The gaps
          make ≥768px resolve to the 112px (pt-28) it hardcoded before; phones inherit
          the shorter bar. */}
      <div className="pt-[calc(var(--dz-nav-h)+16px)] sm:pt-[calc(var(--dz-nav-h)+40px)] pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          {ownerPreview && (
            <div role="status" className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3">
              <Icon name="clock" className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
              <p className="text-amber-200 text-sm">{tr(staffPreview ? 'property.staffPreview' : 'property.ownerPreview')}</p>
            </div>
          )}

          {/* Breadcrumb — hidden on mobile (the navbar's back tile covers up-navigation
              there); kept from sm+ for orientation and SEO. */}
          <nav className="hidden sm:flex items-center gap-2 text-sm mb-4 sm:mb-6 flex-wrap" aria-label="Breadcrumb">
            <Link to="/" className="text-slate-500 hover:text-brand-teal-3 flex items-center gap-1"><Icon name="home" className="w-3.5 h-3.5" /> {tr('property.home')}</Link>
            <Icon name="chevron-right" className="w-3.5 h-3.5 text-slate-600" />
            <Link to={returnTo} state={{ restore: true }} className="text-slate-500 hover:text-brand-teal-3">{isRent ? tr('property.breadcrumbRent') : tr('property.breadcrumbBuy')}</Link>
            <Icon name="chevron-right" className="w-3.5 h-3.5 text-slate-600" />
            <Link to={`/locality/${p.localitySlug}`} className="text-slate-500 hover:text-brand-teal-3">{p.locality}</Link>
            <Icon name="chevron-right" className="w-3.5 h-3.5 text-slate-600" />
            <span className="text-slate-300 truncate">{title}</span>
          </nav>

          {/* Keyed on the listing: `active` is reset here on an id change but the gallery's own
              `ask` slide is not, so an in-place navigation would otherwise park the next
              listing's hero on its request-photos card. */}
          <Gallery key={p.id} gallery={gallery} active={active} setActive={setActive} title={title} p={p} flagEnabled={flagEnabled} setLightbox={setLightbox} setTourOpen={setTourOpen} requestPhotos={requestPhotos} priceStr={priceOnHero ? ctx.priceStr : null} />

          <PropertyHeader ctx={ctx} priceOnHero={priceOnHero} />

          {/* SECTION TABS — collapse the long scroll into grouped tabs.

              The row also carries the *desktop* contact CTA on its right. The tab bar
              is the only element on this page that is already sticky for the whole
              document (its containing block wraps every section), so docking the CTA
              here buys desktop a permanently reachable "contact" without introducing a
              second fixed element: the bottom-right corner already belongs to the
              assistant FAB, and a full-width desktop bar would sit on top of it (see
              AssistantWidget's `detailBar` offset, which deliberately stops at lg).
              Mobile keeps the bottom bar (`.dz-sticky-cta`, lg:hidden) — the two are
              exact complements and never render together. */}
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
            {/* Outside the tablist, not inside it — a CTA is not a tab, and HScroll's
                row would scroll it out of reach with the tabs. */}
            <div className="hidden lg:flex items-center pl-3 border-b border-white/10 bg-ink/80 backdrop-blur-md">
              {contactApproved && canChat ? (
                <Link to={messagesLinkForProp(p)} onClick={() => queuePendingChat(p, { active: true })} className="btn-teal flex items-center gap-1.5 text-sm font-semibold py-2 px-4 shadow-none">
                  <Icon name="message-circle" className="w-4 h-4" /> {tr('property.chat')}
                </Link>
              ) : (
                /* Deliberately no wa.me deep link and no number on this surface: it routes through the same
                   gate as every other contact entry point, so an always-visible CTA is not a way around it. */
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
        {/* Never branches on approval: the sidebar owner card is `lg:` only, so this sheet is a
            phone's only surface for the number, WhatsApp and chat in every gate state. */}
        <button onClick={handleContact} className="btn-teal flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-semibold py-3 px-4"><Icon name="message-circle" className="w-4 h-4" /> {tr('property.contactOwner')}</button>
        {/* Matches the sibling primary exactly: no py-* (the 1px border already sits inside
            the 44px box) and the button system's 1.125rem inline padding, so `flex-1`
            hands both halves the same width. */}
        {flagEnabled('scheduleVisit') && <Link to={`/schedule-visit?listing=${p.id}`} className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-white/15 text-slate-200 text-sm font-semibold px-[1.125rem]"><Icon name="calendar" className="w-4 h-4" /> {tr('property.visit')}</Link>}
      </div>

      <PropertyModals ctx={ctx} />
    </div>
  );
}
