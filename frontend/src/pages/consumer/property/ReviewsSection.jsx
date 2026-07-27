import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { useAuth } from '../../../context/AuthContext.jsx';
import { digits } from '../../../lib/contact.js';
import { myMobile, hasCompletedVisit, myVisitStatus, getTenanciesFor } from '../../../lib/store.js';
import { Stars } from './Stars.jsx';
import { loadReviews, saveReview } from './reviews.js';
import { ReviewModal } from './ReviewModal.jsx';

function initials(name) {
  const parts = String(name || 'U').trim().split(/\s+/);
  return ((parts[0]?.[0] || 'U') + (parts[1]?.[0] || '')).toUpperCase();
}

export const RV_CATS = [['locality', 'Locality'], ['condition', 'Condition'], ['value', 'Value'], ['owner', 'Owner'], ['accuracy', 'Accuracy']];

export function ReviewsSection({ p, isIn, onReport, toast }) {
  const { t } = useTranslation();
  const [reviews, setReviews] = useState(() => loadReviews(p.id));
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState(false);
  const { user } = useAuth();

  useEffect(() => { setReviews(loadReviews(p.id)); }, [p.id]);

  const summary = useMemo(() => {
    const count = reviews.length;
    if (!count) return { count: 0 };
    const avg = reviews.reduce((s, r) => s + (r.rating || 0), 0) / count;
    const dist = [0, 0, 0, 0, 0];
    reviews.forEach((r) => { const k = Math.round(r.rating) - 1; if (k >= 0 && k < 5) dist[k]++; });
    const catAvg = {};
    RV_CATS.forEach(([k]) => {
      const vals = reviews.map((r) => r.categories?.[k]).filter(Boolean);
      if (vals.length) catAvg[k] = vals.reduce((s, v) => s + v, 0) / vals.length;
    });
    const recs = reviews.filter((r) => r.recommend != null);
    const recommend = recs.length ? Math.round((recs.filter((r) => r.recommend).length / recs.length) * 100) : null;
    return { count, avg, dist, catAvg, recommend };
  }, [reviews]);

  const shown = reviews.filter((r) => filter === 'all' || r.context === filter);

  const owner = String(p.ownerMobile || '');
  const isOwner = isIn && digits(myMobile()) === digits(owner);
  const hasTenancy = getTenanciesFor(myMobile()).some((t) => t.propId === p.id);
  const eligible = isIn && !isOwner && (hasCompletedVisit(owner, p.id) || hasTenancy);

  const openRate = () => {
    if (!isIn) { toast(t('property.signInRate'), 'info'); return; }
    if (isOwner) { toast(t('property.cantReviewOwn'), 'info'); return; }
    if (!eligible) {
      if (myVisitStatus(owner, p.id) === 'scheduled') toast(t('property.visitBookedReview'), 'info');
      else toast(t('property.bookVisitFirst'), 'info');
      return;
    }
    setModal(true);
  };

  const submit = (review) => {
    saveReview(p.id, review);
    setReviews(loadReviews(p.id));
    setModal(false);
    toast(t('property.reviewPosted'), 'success');
  };

  return (
    <section className="fade-in section-mb">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2"><Icon name="star" className="w-5 h-5 text-amber-400" /> {t('property.ratingsReviews')}</h2>
        <div className="flex items-center gap-2 sm:gap-3">
          <button onClick={onReport} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-red-400 transition-smooth"><Icon name="flag" className="w-4 h-4" /> {t('property.reportListing')}</button>
          {!isOwner ? <button type="button" onClick={openRate} className="btn-teal inline-flex items-center gap-2 text-sm py-2.5 px-4"><Icon name="star" className="w-4 h-4" /> {t('property.rateProperty')}</button> : null}
        </div>
      </div>

      {!summary.count ? (
        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 flex items-center gap-3">
          <Icon name="star" className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <p className="text-slate-300 text-sm">{t('property.noReviewsYet')}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5 flex flex-col items-center justify-center text-center">
              <div className="text-4xl font-extrabold text-white mb-1">{summary.avg.toFixed(1)}</div>
              <div className="mb-1"><Stars value={summary.avg} size={18} /></div>
              <p className="text-slate-400 text-xs">{t('property.reviews', { count: summary.count })}</p>
              {summary.recommend != null ? <p className="text-emerald-400 text-xs mt-2 inline-flex items-center gap-1"><Icon name="badge-check" className="w-3 h-3" /> {t('property.recommendPct', { pct: summary.recommend })}</p> : null}
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
              {[5, 4, 3, 2, 1].map((s) => {
                const c = summary.dist[s - 1];
                const max = Math.max(...summary.dist) || 1;
                return (
                  <div key={s} className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] text-slate-400 w-3">{s}</span>
                    <Icon name="star" className="w-3 h-3 fill-amber-400 text-amber-400" />
                    <div className="flex-1 h-2 rounded-full bg-white/8 overflow-hidden"><div className="h-full bg-amber-400" style={{ width: Math.round((c / max) * 100) + '%' }} /></div>
                    <span className="text-[11px] text-slate-500 w-5 text-right">{c}</span>
                  </div>
                );
              })}
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
              {Object.keys(summary.catAvg).length ? Object.keys(summary.catAvg).map((k) => (
                <div key={k} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-sm text-slate-300">{t('property.reviewCats.' + k)}</span>
                  <span className="inline-flex items-center gap-1"><Stars value={summary.catAvg[k]} size={13} /><span className="text-[11px] text-slate-400 w-6 text-right">{summary.catAvg[k].toFixed(1)}</span></span>
                </div>
              )) : <p className="text-slate-500 text-sm">{t('property.noCategoryRatings')}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {[['all', t('property.filterAll')], ['visit', t('property.filterVisited')], ['tenant', t('property.filterResidents')]].map(([id, lbl]) => {
              const n = id === 'all' ? summary.count : reviews.filter((r) => r.context === id).length;
              return <button key={id} type="button" onClick={() => setFilter(id)} className={'px-3 py-1.5 rounded-lg text-xs font-medium ' + (filter === id ? 'bg-brand-teal-1/20 text-brand-teal-3 border border-brand-teal-2/30' : 'text-slate-400 border border-white/8 hover:text-white')}>{lbl} ({n})</button>;
            })}
          </div>
          <div>
            {shown.length ? shown.map((r) => (
              <div key={r.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 mb-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-teal-1 to-brand-indigo-4 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">{initials(r.user)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-white font-semibold text-sm">{r.user}</span>
                      <span className={'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ' + (r.context === 'tenant' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' : 'bg-teal-500/15 text-teal-300 border-teal-500/25')}><Icon name={r.context === 'tenant' ? 'home' : 'calendar-check'} className="w-2.5 h-2.5" /> {r.context === 'tenant' ? t('property.verifiedResident') : t('property.visited')}</span>
                    </div>
                    <div className="flex items-center gap-2 mb-2"><Stars value={r.rating} size={14} /><span className="text-[11px] text-slate-500">{r.at}</span></div>
                    {r.text ? <p className="text-slate-300 text-sm leading-relaxed mb-2">{r.text}</p> : null}
                    {r.categories && Object.keys(r.categories).length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {Object.keys(r.categories).map((k) => (
                          <span key={k} className="inline-flex items-center gap-1 text-[11px] text-slate-300 bg-white/5 border border-white/8 rounded-lg px-2 py-1">{t('property.reviewCats.' + k)} <Stars value={r.categories[k]} size={11} /></span>
                        ))}
                      </div>
                    ) : null}
                    {r.recommend != null ? <p className={'text-[11px] mt-2 ' + (r.recommend ? 'text-emerald-400' : 'text-slate-400')}><Icon name={r.recommend ? 'thumbs-up' : 'thumbs-down'} className="w-3 h-3 inline" /> {r.recommend ? t('property.wouldRecommend') : t('property.wouldNotRecommend')}</p> : null}
                  </div>
                </div>
              </div>
            )) : <p className="text-slate-500 text-sm py-4">{t('property.noReviewsFilter')}</p>}
          </div>
        </>
      )}

      {modal ? <ReviewModal user={user} onClose={() => setModal(false)} onSubmit={submit} /> : null}
    </section>
  );
}
