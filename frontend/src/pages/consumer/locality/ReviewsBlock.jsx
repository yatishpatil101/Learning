import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

export default function ReviewsBlock({ activeName, locReviews, summary, summaryFailed, onSubmit, revText, setRevText, pick, setPick }) {
  const { t } = useTranslation();
  /** The headline is the server aggregate, not an average of the cards (page one only). A failed read
   * must not reuse the "no reviews yet" copy: that claims nobody reviewed the area. */
  const loading = !summary && !summaryFailed;
  const rated = !!summary && summary.count > 0 && Number.isFinite(summary.avg);
  return (
    <div className="glass-card rounded-2xl p-6 reveal">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white flex items-center gap-2"><Icon name="star" className="w-5 h-5 text-amber-400" /> {t('locality.reviewsTitle')}</h2>
        <div className="text-sm text-gray-300">
          {loading ? <span className="skeleton inline-block h-4 w-28 rounded align-middle" aria-hidden="true" />
            : summaryFailed ? <span className="text-amber-300/80 inline-flex items-center gap-1.5" data-testid="locality-rating-unavailable"><Icon name="alert-triangle" className="w-4 h-4" /> {t('locality.reviewsUnavailable')}</span>
              : rated ? <><span className="text-amber-400 font-bold">{summary.avg.toFixed(1)}</span> ★ · {t('locality.reviewsCount', { count: summary.count })}</>
                : t('locality.reviewsNone')}
        </div>
      </div>
      <form onSubmit={onSubmit} className="rounded-xl p-4 mb-5" style={{ background: 'rgb(var(--dz-c-white) / .03)', border: '1px solid rgb(var(--dz-c-white) / calc(.08 * var(--dz-line-boost)))' }}>
        <p className="text-sm font-semibold text-white mb-2"><Trans i18nKey="locality.reviewPrompt" values={{ name: activeName }} components={{ 1: <span className="text-teal-400" /> }} /></p>
        <div className="flex gap-1 mb-3">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" onClick={() => setPick(n)} style={{ fontSize: '22px', color: n <= pick ? 'rgb(var(--dz-c-amber-500))' : 'rgb(var(--dz-c-slate-600))' }}>★</button>)}</div>
        <textarea value={revText} onChange={(e) => setRevText(e.target.value)} rows={2} placeholder={t('locality.reviewPlaceholder')} className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-teal-400/50" />
        <button type="submit" className="btn-teal mt-3 px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2"><Icon name="send" className="w-4 h-4" /> {t('locality.reviewPost')}</button>
      </form>
      <div className="space-y-3">
        {locReviews.length ? locReviews.map((rv, i) => (
          <div key={i} className="glass-card rounded-xl p-4"><div className="flex items-center justify-between mb-1"><span className="font-semibold text-sm">{rv.user}</span><span className="text-sm">{[1, 2, 3, 4, 5].map((s) => <span key={s} style={{ color: s <= rv.rating ? 'rgb(var(--dz-c-amber-500))' : 'rgb(var(--dz-c-slate-600))' }}>★</span>)}</span></div><p className="text-gray-400 text-sm">{rv.text}</p></div>
        )) : <p className="text-gray-500 text-sm">{t('locality.reviewBeFirst', { name: activeName })}</p>}
      </div>
    </div>
  );
}
