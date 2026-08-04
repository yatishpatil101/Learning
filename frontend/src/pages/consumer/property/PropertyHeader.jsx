import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import Tip from '../../../components/ui/Tip.jsx';
import QualityScoreBadge from '../../../components/ui/QualityScoreBadge.jsx';
import { fmtINR, fmtNum, timeAgo } from '../../../lib/format.js';
import { listingFreshness } from '../../../lib/freshness.js';
import { cityLabelFor } from '../../../lib/geoConfig.js';
import { OwnerCard } from './OwnerCard.jsx';
import { DealPanel } from './DealPanel.jsx';
import { CompareToggleBar } from './CompareToggleBar.jsx';

export default function PropertyHeader({ ctx, priceOnHero = false }) {
  const {
    tags, priceStr, isRent, isLand, tr, emi, title, p,
    viewingNow, enquiriesThisWeek, visitsScheduled, perUnitVal, kind,
    setReportOpen, isIn, toast, contactApproved, ownerMob, handleContact, canChat,
    flagEnabled, setVisitOpen, saved, setSaved,
  } = ctx;
  return (
          <section className="fade-in grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 section-mb">
            {/* Left */}
            <div className="lg:col-span-2">
              {/* The panel's surface, grid and icon colours live in `.tag-strip` in
                  index.css, not in utilities here — the tile IS the design.

                  No `weight` prop: `file-check` resolves to a Lucide fallback, which
                  ignores it, so asking for `fill` produced two solid Phosphor glyphs
                  beside one outline. Outline everywhere is the one weight both sets
                  can actually honour. */}
              <div className="tag-strip mb-4">
                {tags.map(([label, cls, ic, tipKey]) => (
                  <Tip key={label} k={tipKey}>
                    <span className={`tag ${cls}`}>{ic ? <Icon name={ic} className="w-4 h-4" /> : null} {label}</span>
                  </Tip>
                ))}
              </div>

              {/* On phones the price is laid over the hero photo instead (see Gallery),
                  so it clears the fold. Skipped rather than hidden so only one price
                  element exists at a time. */}
              {priceOnHero ? null : (
                <div className="mb-1">
                  <span data-testid="property-price" className="text-3xl sm:text-4xl font-extrabold gradient-text">{priceStr}</span>
                </div>
              )}
              {!isRent && !isLand ? <p className="text-slate-400 text-sm mb-2">{tr('property.emiStartsAt')} <span className="text-brand-coral-2 font-semibold">₹{fmtNum(emi)}/month</span></p> : null}
              <p className="inline-flex items-center gap-1.5 mb-4 px-2.5 py-1 rounded-full text-xs font-semibold text-emerald-300" style={{ background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.25)' }}>
                <Icon name="hand-coins" className="w-3.5 h-3.5" /> {tr('property.zeroBrokerageDirect')}
              </p>
              <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2 leading-tight">{title}</h1>
              <div className="flex items-center gap-2 text-slate-400 mb-3">
                <Icon name="map-pin" className="w-4 h-4 text-brand-teal-2 flex-shrink-0" />
                <span className="text-sm sm:text-base">{p.locality}, {cityLabelFor(p)}</span>
              </div>
              <div className="flex items-center gap-3 text-slate-500 text-sm">
                <span className="flex items-center gap-1.5"><Icon name="clock" className="w-3.5 h-3.5" /> {tr('property.postedAgo', { time: timeAgo(p.createdAt).toLowerCase() })}</span>
              </div>

              {/* Owner-activity signal: tells the buyer whether the owner is actively
                  keeping this listing up to date, so they don't chase a ghost listing. */}
              {(() => {
                const fr = listingFreshness(p);
                if (!fr.buyer.show) return null;
                const CLS = {
                  emerald: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25',
                  gray: 'text-slate-300 bg-white/5 border-white/10',
                  amber: 'text-amber-300 bg-amber-500/10 border-amber-500/25',
                }[fr.buyer.tone];
                return (
                  <div className={'mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ' + CLS} title={tr('property.freshnessTitle')}>
                    {fr.state === 'active' ? (
                      <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span>
                    ) : (
                      <Icon name={fr.buyer.icon} className="w-3.5 h-3.5" />
                    )}
                    {fr.buyer.label}
                  </div>
                );
              })()}

              <div className="mt-4 sm:mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {[
                  ['ruler', isRent ? tr('property.rentPerSqft') : tr('property.pricePerSqft'), perUnitVal],
                  ['landmark', isRent ? tr('property.deposit') : tr('property.estEmi'), isRent ? fmtINR(p.deposit || p.price * 2) : '₹' + fmtNum(emi) + '/mo'],
                  ['eye', tr('property.totalViews'), fmtNum(p.views)],
                  ['heart', tr('property.shortlisted'), fmtNum(p.enquiries)],
                ].map(([ic, lbl, val]) => (
                  <div key={lbl} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                    <div className="flex items-center gap-1.5 text-slate-400 text-[11px] mb-1"><Icon name={ic} className="w-3.5 h-3.5 text-brand-teal-3" /> {lbl}</div>
                    <p className="text-white font-bold text-base">{val}</p>
                  </div>
                ))}
                <QualityScoreBadge listing={p} variant="tile" />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
                <span className="flex items-center gap-1.5"><span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span> <b className="text-white font-semibold">{viewingNow}</b> {tr('property.viewingNow')}</span>
                <span className="flex items-center gap-1.5"><Icon name="message-square-text" className="w-3.5 h-3.5" /> <b className="text-white font-semibold">{enquiriesThisWeek}</b> {tr('property.enquiriesThisWeek')}</span>
                <span className="flex items-center gap-1.5"><Icon name="calendar-check" className="w-3.5 h-3.5" /> <b className="text-white font-semibold">{visitsScheduled}</b> {tr('property.visitsScheduled')}</span>
              </div>

              {/* Flatmate-split card — any multi-BHK residential rental is shareable
                  (flats, apartments, row houses, penthouses, villas), not just a
                  hardcoded few. A studio / 1-BHK isn't practical to split, so gate on 2+ BHK. */}
              {isRent && kind === 'residential' && (p.bhkNum || 0) >= 2 && p.price > 0 ? (
                <div className="mt-5 glass-strong rounded-2xl p-5">
                  <div className="flex items-start justify-between mb-3.5">
                    <div>
                      <h3 className="font-semibold text-white flex items-center gap-2"><Icon name="users" className="w-4 h-4 text-brand-teal-2" /> {tr('property.sharingFlatTitle')}</h3>
                      <p className="text-xs text-slate-400 mt-1">{tr('property.sharingFlatSub')}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="glass-strong rounded-xl p-3 text-center">
                      <p className="text-xs text-slate-400 mb-1">{tr('property.shareAlone')}</p>
                      <p className="text-lg font-bold text-white">₹{(p.price / 1000).toFixed(0)}k</p>
                    </div>
                    <div className="glass-strong rounded-xl p-3 text-center">
                      <p className="text-xs text-slate-400 mb-1">{tr('property.share2')}</p>
                      <p className="text-lg font-bold text-brand-teal-3">₹{(p.price / 2 / 1000).toFixed(0)}k</p>
                    </div>
                    <div className="glass-strong rounded-xl p-3 text-center">
                      <p className="text-xs text-slate-400 mb-1">{tr('property.share3')}</p>
                      <p className="text-lg font-bold text-emerald-400">₹{(p.price / 3 / 1000).toFixed(0)}k</p>
                    </div>
                  </div>
                  <Link to={`/flatmates?startGroup=1&title=${encodeURIComponent(title)}&rent=${p.price}&loc=${encodeURIComponent(p.locality)}`} className="mt-3.5 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl border border-brand-teal-2/30 bg-brand-teal-1/10 text-brand-teal-3 text-sm font-medium hover:bg-brand-teal-1/20 transition-smooth"><Icon name="users-round" className="w-4 h-4" /> {tr('property.findFlatmates')}</Link>
                </div>
              ) : null}

              {/* PuneNest Assured */}
              <div className="mt-5 rounded-2xl border border-emerald-500/20 p-4" style={{ background: 'linear-gradient(135deg,rgba(16,185,129,.08),rgba(20,184,166,.06))' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon name="shield-check" className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-white font-bold text-sm">{tr('property.assuredTitle')}</h3>
                  <span className="text-[10px] text-emerald-300 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 font-semibold uppercase tracking-wide">{tr('property.trustedListing')}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <span className="inline-flex items-center gap-2 text-xs text-slate-200 rounded-lg border border-white/10 bg-white/5 px-3 py-2"><Icon name="user-check" className="w-4 h-4 text-emerald-400" /> {tr('property.assuredVerified')}</span>
                  <span className="inline-flex items-center gap-2 text-xs text-slate-200 rounded-lg border border-white/10 bg-white/5 px-3 py-2"><Icon name="hand-coins" className="w-4 h-4 text-brand-teal-3" /> {tr('property.zeroBrokerageDirect')}</span>
                  <span className="inline-flex items-center gap-2 text-xs text-slate-200 rounded-lg border border-white/10 bg-white/5 px-3 py-2"><Icon name="phone-off" className="w-4 h-4 text-gray-400" /> {tr('property.numberProtected')}</span>
                  <button type="button" onClick={() => setReportOpen(true)} className="inline-flex items-center gap-2 text-xs text-slate-200 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10 hover:border-amber-400/30 transition-smooth"><Icon name="flag" className="w-4 h-4 text-amber-400" /> {tr('property.reportReverify')}</button>
                </div>
              </div>
            </div>

            {/* Right */}
            <div className="space-y-4">
              <OwnerCard p={p} isIn={isIn} toast={toast} contactApproved={contactApproved} ownerMob={ownerMob} onContact={handleContact} canChat={canChat} />

              {/* Primary engagement — for a first-time buyer a site visit is the #1 next step,
                  so it leads the sidebar. Offers / finalisation sit below. */}
              {/* Hidden on mobile: the sticky bottom bar already exposes "Visit",
                  so this standalone button would be a third copy of the same action.
                  Hide via a wrapper <div> — `.btn-teal` sets its own `display`, which
                  would override Tailwind's `hidden` if applied to the button directly. */}
              {flagEnabled('scheduleVisit') && (
                <div className="hidden lg:block">
                  <button onClick={() => setVisitOpen(true)} className="btn-teal w-full flex items-center justify-center gap-2 py-3 shadow-none"><Icon name="calendar" className="w-5 h-5" /> {tr('property.scheduleVisit')}</button>
                </div>
              )}

              <DealPanel p={p} isIn={isIn} toast={toast} contactApproved={contactApproved} />

              {flagEnabled('emiCalculator') && !isLand && !isRent && <Link to="/emi-calculator" className="flex items-center justify-center gap-1.5 text-sm font-semibold text-brand-teal-3 hover:text-brand-teal-2 transition-smooth"><Icon name="calculator" className="w-4 h-4" /> {tr('property.calculateEmi')}</Link>}
              {flagEnabled('compareProperties') && <CompareToggleBar p={p} saved={saved} setSaved={setSaved} />}
            </div>
          </section>
  );
}
