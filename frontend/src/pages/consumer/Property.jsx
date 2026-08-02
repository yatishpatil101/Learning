import { Link } from 'react-router';
import Icon from '../../components/Icon.jsx';
import Loading from '../../components/ui/Loading.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import { digits } from '../../lib/contact.js';
import { queueOwnerChat, messagesLinkForProp } from '../../lib/chat.js';
import { Gallery } from './property/Gallery.jsx';
import useProperty from './property/useProperty.js';
import PropertyHeader from './property/PropertyHeader.jsx';
import PropertyTabs from './property/PropertyTabs.jsx';
import PropertyModals from './property/PropertyModals.jsx';

export default function Property() {
  const ctx = useProperty();
  const { tr } = ctx;
  if (ctx.loading) return <Loading />;
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

  const {
    rootRef, goBackToSearch, backToMap, returnTo, isRent, p, title, gallery, active, setActive,
    flagEnabled, setLightbox, setTourOpen, requestPhotos, tabs, current, selectTab,
    contactApproved, ownerMob, handleContact,
  } = ctx;

  return (
    <div ref={rootRef}>
      {/* selfPadded route — reserves the fixed navbar itself, from the token. The gaps
          make ≥768px resolve to the 112px (pt-28) it hardcoded before; phones inherit
          the shorter bar. */}
      <div className="pt-[calc(var(--pn-nav-h)+16px)] sm:pt-[calc(var(--pn-nav-h)+40px)] pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          <button type="button" onClick={goBackToSearch} className="pn-back-search">
            <Icon name={backToMap ? 'map-pin' : 'arrow-left'} className="w-4 h-4" />
            {backToMap ? tr('property.backToMap') : tr('property.backToResults')}
          </button>

          {/* Breadcrumb — hidden on mobile (the "Back to results" pill above already
              covers up-navigation); kept from sm+ for orientation and SEO. */}
          <nav className="hidden sm:flex items-center gap-2 text-sm mb-4 sm:mb-6 flex-wrap" aria-label="Breadcrumb">
            <Link to="/" className="text-slate-500 hover:text-brand-teal-3 flex items-center gap-1"><Icon name="home" className="w-3.5 h-3.5" /> {tr('property.home')}</Link>
            <Icon name="chevron-right" className="w-3.5 h-3.5 text-slate-600" />
            <Link to={returnTo} state={{ restore: true }} className="text-slate-500 hover:text-brand-teal-3">{isRent ? tr('property.breadcrumbRent') : tr('property.breadcrumbBuy')}</Link>
            <Icon name="chevron-right" className="w-3.5 h-3.5 text-slate-600" />
            <Link to={`/locality/${p.localitySlug}`} className="text-slate-500 hover:text-brand-teal-3">{p.locality}</Link>
            <Icon name="chevron-right" className="w-3.5 h-3.5 text-slate-600" />
            <span className="text-slate-300 truncate">{title}</span>
          </nav>

          {/* GALLERY */}
          <Gallery gallery={gallery} active={active} setActive={setActive} title={title} p={p} flagEnabled={flagEnabled} setLightbox={setLightbox} setTourOpen={setTourOpen} requestPhotos={requestPhotos} />

          {/* HEADER */}
          <PropertyHeader ctx={ctx} />

          {/* SECTION TABS — collapse the long scroll into grouped tabs */}
          <div className="pn-docks-under-nav sticky top-[var(--pn-nav-h)] z-30 section-mb">
            <HScroll role="tablist" aria-label={tr('property.tablistAria')} className="flex gap-1 sm:gap-2 border-b border-white/10 bg-ink/80 backdrop-blur-md">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={current === t.id}
                  onClick={() => selectTab(t.id)}
                  className={`pn-detail-tab ${current === t.id ? 'is-active' : ''}`}
                >
                  <Icon name={t.icon} className="w-4 h-4" /> <span>{t.label}</span>
                </button>
              ))}
            </HScroll>
          </div>

          <PropertyTabs ctx={ctx} />

        </div>
      </div>

      {/* Sticky mobile CTA bar */}
      <div className="pn-sticky-cta lg:hidden">
        {contactApproved ? (
          flagEnabled('inAppMessaging') ? (
            <Link to={messagesLinkForProp(p)} onClick={() => queueOwnerChat(p, { active: true })} className="btn-teal flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-semibold py-3 px-4">
              <Icon name="message-circle" className="w-4 h-4" /> {tr('property.chat')}
            </Link>
          ) : (
            <a href={`https://wa.me/91${digits(ownerMob)}?text=${encodeURIComponent(`Hi, I'm interested in "${p.title}" on PuneNest.`)}`} target="_blank" rel="noopener noreferrer" className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold py-3 px-[1.125rem]">
              <Icon name="message-circle" className="w-4 h-4" /> {tr('property.whatsapp')}
            </a>
          )
        ) : (
          <button onClick={handleContact} className="btn-teal flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-semibold py-3 px-4"><Icon name="message-circle" className="w-4 h-4" /> {tr('property.contactOwner')}</button>
        )}
        {/* Matches the sibling primary exactly: no py-* (the 1px border already sits inside
            the 44px box) and the button system's 1.125rem inline padding, so `flex-1`
            hands both halves the same width. */}
        {flagEnabled('scheduleVisit') && <Link to={`/schedule-visit?listing=${p.id}`} className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-white/15 text-slate-200 text-sm font-semibold px-[1.125rem]"><Icon name="calendar" className="w-4 h-4" /> {tr('property.visit')}</Link>}
      </div>

      <PropertyModals ctx={ctx} />
    </div>
  );
}
