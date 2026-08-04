import { useTranslation } from 'react-i18next';
import { computeQualityScore, qualityColor } from '../../lib/qualityScore.js';
import { classNames } from '../../lib/format.js';

/**
 * Quality score badge — reusable across consumer and admin pages.
 * @param {'compact'|'full'|'tile'} variant - compact shows just the ring+number, full shows label too, tile matches the stat-tile grid
 */
export default function QualityScoreBadge({ listing, variant = 'compact' }) {
  const { t } = useTranslation();
  const score = computeQualityScore(listing);
  const c = qualityColor(score);

  if (variant === 'tile') {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3" title={t('ui.listingQuality', { score })}>
        <div className="flex items-center gap-1.5 text-slate-400 text-[11px] mb-1">
          <ScoreRing score={score} color={c.ring} size={14} /> {t('ui.qualityScore')}
        </div>
        <p className="text-white font-bold text-base tabular-nums">
          {score}/100 <span className={classNames('text-[11px] font-semibold', c.text)}>· {t(c.labelKey)}</span>
        </p>
      </div>
    );
  }

  if (variant === 'full') {
    return (
      <div className={classNames('inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5', c.bg)} title={t('ui.listingQuality', { score })}>
        <ScoreRing score={score} color={c.ring} size={24} />
        <div>
          <div className={classNames('text-xs font-bold tabular-nums', c.text)}>{score}/100</div>
          <div className="text-[10px] text-gray-500">{t(c.labelKey)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={classNames('inline-flex items-center gap-1 rounded-full px-2 py-0.5', c.bg, c.text)} title={t('ui.qualityShort', { score })}>
      <ScoreRing score={score} color={c.ring} size={12} />
      <span className="text-[10px] font-semibold tabular-nums">{score}</span>
    </div>
  );
}

function ScoreRing({ score, color, size }) {
  const r = size * 0.42;
  const circumference = 2 * Math.PI * r;
  const dashLength = (score / 100) * circumference;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={color}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={size * 0.15} opacity="0.2" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={size * 0.15} strokeDasharray={`${dashLength} ${circumference}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  );
}
