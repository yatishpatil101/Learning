import { Link } from 'react-router';
import Icon from '../../components/Icon.jsx';
import HScroll from '../../components/ui/HScroll.jsx';
import { Stars } from './property/Stars.jsx';
import { useSocietyHub } from './society/useSocietyHub.js';
import OverviewTab from './society/tabs/OverviewTab.jsx';
import HomesTab from './society/tabs/HomesTab.jsx';
import ReviewsTab from './society/tabs/ReviewsTab.jsx';
import CommunityTab from './society/tabs/CommunityTab.jsx';
import LocationTab from './society/tabs/LocationTab.jsx';
import SocietySidebar from './society/SocietySidebar.jsx';
import SocietyModals from './society/SocietyModals.jsx';

export default function Society() {
  const hub = useSocietyHub();
  const {
    rootRef, soc, locName, hero, onFollow, followed, setRateOpen,
    claimed, verified, iAmResident, showEstimate, rating, overall,
    rateOpen, pick, setPick, revText, setRevText, inp, submitReview,
    sugRec, openSuggest, stats, tabs, current, selectTab,
  } = hub;

  return (
    <div ref={rootRef} className="soc-page">
      <main className="pt-8 sm:pt-10 pb-24 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex items-center gap-2 text-sm text-gray-400 mb-5 reveal" aria-label="Breadcrumb">
          <Link to="/societies" className="hover:text-white">Societies</Link><Icon name="chevron-right" className="w-3.5 h-3.5" />
          <Link to={`/locality/${soc.localitySlug}`} className="hover:text-white capitalize">{locName}</Link><Icon name="chevron-right" className="w-3.5 h-3.5" />
          <span className="text-white font-medium">{soc.name}</span>
        </nav>

        {/* Hero */}
        <section className="rounded-3xl overflow-hidden relative mb-6 glass reveal">
          <img src={hero} alt={soc.name} className="w-full h-56 sm:h-72 object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(15,13,26,.1),rgba(15,13,26,.88))' }} />
          <div className="absolute top-4 right-4 flex gap-2">
            <button onClick={onFollow} className={(followed ? 'btn-teal' : 'btn-outline') + ' !h-9 !px-3 text-sm'}><Icon name={followed ? 'check' : 'bell'} className="w-4 h-4 mr-1.5" /> {followed ? 'Following' : 'Follow'}</button>
            <button onClick={() => setRateOpen((v) => !v)} className="btn-outline !h-9 !px-3 text-sm"><Icon name="star" className="w-4 h-4 mr-1.5" /> Review</button>
          </div>
          <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {claimed ? <span className="tag" style={{ background: 'rgba(37,99,235,.9)', color: '#fff', border: 'none' }}><Icon name="shield-check" className="w-3.5 h-3.5" /> Managed on PuneNest</span> : null}
              {verified ? <span className="tag" style={{ background: 'rgba(13,148,136,.85)', color: '#fff', border: 'none' }}><Icon name="badge-check" className="w-3.5 h-3.5" /> Society Verified</span> : null}
              {iAmResident ? <span className="tag" style={{ background: 'rgba(139,92,246,.85)', color: '#fff', border: 'none' }}><Icon name="home" className="w-3.5 h-3.5" /> You live here</span> : null}
              <span className="tag" style={{ background: 'rgba(16,185,129,.85)', color: '#fff', border: 'none' }}>₹0 Brokerage</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold">{soc.name}</h1>
            <p className="text-gray-300 mt-1 flex items-center gap-3 flex-wrap">
              {soc.builder ? <span className="flex items-center gap-1.5"><Icon name="hard-hat" className="w-4 h-4 text-teal-400" /> {soc.builder}</span> : null}
              <span className="flex items-center gap-1.5"><Icon name="map-pin" className="w-4 h-4 text-teal-400" /> {locName}, Pune</span>
              {!showEstimate && !rating.count ? (
                <span className="flex items-center gap-1.5 text-gray-300 text-sm"><Icon name="sparkles" className="w-4 h-4 text-teal-400" /> Not rated yet</span>
              ) : (
                <span className="flex items-center gap-1.5"><Stars value={overall} size={14} /> <span className="font-semibold text-white">{overall}</span> <span className="text-gray-400 text-sm">{rating.count ? `(${rating.count})` : '(community estimate)'}</span></span>
              )}
            </p>
          </div>
        </section>

        {/* Inline review composer */}
        {rateOpen ? (
          <div className="glass rounded-2xl p-5 mb-6 reveal">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm font-medium text-gray-300">Your rating</span>
              <span className="inline-flex items-center" style={{ gap: 2 }}>
                {[1, 2, 3, 4, 5].map((i) => <button key={i} onClick={() => setPick(i)} aria-label={`${i} star`}><Icon name="star" style={{ width: 22, height: 22 }} className={i <= pick ? 'fill-amber-400 text-amber-400' : 'text-gray-600'} /></button>)}
              </span>
            </div>
            <textarea value={revText} onChange={(e) => setRevText(e.target.value)} rows={3} placeholder="Share what living here is really like — maintenance, water, management, neighbours…" className={inp} />
            <div className="flex justify-end gap-2 mt-2"><button onClick={() => setRateOpen(false)} className="btn-outline">Cancel</button><button onClick={submitReview} className="btn-teal">Post review</button></div>
          </div>
        ) : null}

        {/* Stats / honest unverified state */}
        {soc._thin ? (
          <section className="glass rounded-2xl p-5 mb-8 reveal flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Icon name="info" className={`w-5 h-5 flex-shrink-0 mt-0.5 ${verified ? 'text-teal-400' : 'text-amber-400'}`} />
              <div>
                <p className="font-semibold text-white">{verified ? 'Full details coming soon' : 'Details not confirmed yet'}</p>
                <p className="text-sm text-gray-400">{verified
                  ? "This society is verified — we're still gathering its size, amenities & ratings."
                  : "We haven't confirmed this society's size, amenities or ratings. Know this place? Add its details."}</p>
              </div>
            </div>
            {sugRec && sugRec.status === 'pending' ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-amber-200 whitespace-nowrap flex-shrink-0"><Icon name="clock" className="w-4 h-4" /> Details submitted — pending review</span>
            ) : (
              <button onClick={openSuggest} className="btn-teal !h-9 !px-4 text-sm whitespace-nowrap flex-shrink-0"><Icon name="badge-check" className="w-4 h-4 mr-1.5" /> {verified ? 'Add details' : 'Help verify'}</button>
            )}
          </section>
        ) : (
          <>
            {soc._community ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 reveal">
                <span className="text-xs text-gray-400 flex items-center gap-1.5"><Icon name="info" className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" /> Some details are community-provided and not officially verified.</span>
                <button onClick={openSuggest} className="text-xs font-medium text-brand-teal-3 hover:underline whitespace-nowrap">Suggest an edit</button>
              </div>
            ) : null}
            {stats.length ? (
              <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-8 reveal">
                {stats.map(([icon, label, val]) => (
                  <div key={label} className="rd-cell"><div className="flex items-center gap-1.5 rd-lbl"><Icon name={icon} className="w-3.5 h-3.5 text-teal-400" /> {label}</div><p className="rd-val mt-0.5">{val}</p></div>
                ))}
              </section>
            ) : null}
          </>
        )}

        <div className="sticky top-16 md:top-[72px] z-30 mb-6">
          <HScroll role="tablist" aria-label="Society sections" className="flex gap-1 sm:gap-2 border-b border-white/10 bg-ink/80 backdrop-blur-md">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={current === t.id}
                onClick={() => selectTab(t.id)}
                className={`pn-detail-tab ${current === t.id ? 'is-active' : ''}`}
              >
                <Icon name={t.icon} className="w-4 h-4" /> <span>{t.label}</span>{t.count ? <span className="ml-1 text-[11px] font-semibold text-slate-400">{t.count}</span> : null}
              </button>
            ))}
          </HScroll>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            {current === 'overview' && <OverviewTab ctx={hub} />}

            {current === 'homes' && <HomesTab ctx={hub} />}

            {current === 'reviews' && <ReviewsTab ctx={hub} />}

            {current === 'community' && <CommunityTab ctx={hub} />}

            {current === 'location' && <LocationTab ctx={hub} />}
          </div>

          {/* Sidebar */}
          <SocietySidebar ctx={hub} />
        </div>
      </main>

      <SocietyModals ctx={hub} />
    </div>
  );
}
