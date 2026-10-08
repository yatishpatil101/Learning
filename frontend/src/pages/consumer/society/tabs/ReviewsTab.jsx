import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import ReportModal from '../../../../components/ReportModal.jsx';
import { REVIEW_REPORT_REASONS } from '../../../../lib/reportReasons.js';
import { Stars } from '../../property/Stars.jsx';

export default function ReviewsTab({ ctx }) {
  const { t } = useTranslation();
  const { rating, overall, bars, reviews, openReport, reportFor, closeReport, toast } = ctx;
  /** Three outcomes: an unreadable `rating` must not collapse into "no reviews yet"; the aspect grid is gated on `bars.length`,
   * because a review may rate the society overall and skip every aspect. */
  const showAggregate = !rating.loading && !rating.failed && rating.count > 0;
  return (
    <>
      <section className="reveal">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold flex items-center gap-2"><Icon name="star" className="w-5 h-5 text-amber-400" /> {t('society.residentRatings')}</h2>
          {rating.loading ? <span className="skeleton inline-block h-4 w-12 rounded" data-testid="society-rating-skeleton" /> : null}
          {showAggregate ? <span className="text-sm"><span className="text-white font-bold">{overall}</span><span className="text-gray-500">/5</span></span> : null}
        </div>
        {rating.failed ? (
          <p className="text-amber-300/80 text-sm mb-4 flex items-center gap-1.5" data-testid="society-rating-unavailable"><Icon name="alert-triangle" className="w-4 h-4 flex-shrink-0" /> {t('society.ratingUnavailable')}</p>
        ) : null}
        {showAggregate && bars.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 mb-4">
            {bars.map((b) => (
              <div key={b.id} className="rd-cell">
                <div className="flex items-center justify-between mb-1.5"><span className="text-xs font-medium text-slate-300">{t(b.labelKey)}</span><span className="text-xs font-bold text-white" data-testid={`society-bar-${b.id}`}>{b.value}</span></div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-brand-teal-2" style={{ width: `${(b.value / 5) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        ) : null}
        {reviews.length ? (
          <div className="space-y-3">
            {reviews.slice(0, 5).map((r) => (
              <div key={r.id} className="glass rounded-xl p-4"><div className="flex items-center justify-between mb-1"><span className="font-semibold text-sm flex items-center gap-1.5">{r.user}</span><span className="flex items-center gap-2"><Stars value={r.rating} size={14} /><button onClick={() => openReport(r)} aria-label={t('society.reportReview')} className="text-gray-500 hover:text-amber-300"><Icon name="flag" className="w-3.5 h-3.5" /></button></span></div>{r.text ? <p className="text-gray-400 text-sm">{r.text}</p> : null}</div>
            ))}
          </div>
        ) : <p className="text-gray-500 text-sm"><Trans i18nKey="society.noReviewsYet" components={{ 1: <b /> }} /></p>}
      </section>

      {reportFor ? (
        <ReportModal
          target={{ id: String(reportFor.id) }}
          kind="review"
          reasons={REVIEW_REPORT_REASONS}
          title={t('society.reportReview')}
          success={t('society.reportThanks')}
          onClose={closeReport}
          toast={toast}
        />
      ) : null}
    </>
  );
}
