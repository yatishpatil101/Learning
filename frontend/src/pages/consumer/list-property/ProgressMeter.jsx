import { Sparkles, TrendingUp, Flame, Rocket, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MILESTONES } from './progress.js';

const TIER_ICON = {
  warmup: Sparkles,
  momentum: TrendingUp,
  half: Flame,
  almost: Rocket,
  ready: Trophy,
};

/* Sticky "Momentum meter" — the gamified signature of the flow.
   Shows live completion %, an encouraging tier label, and milestone nodes
   (20/40/60/80/100) that light up as the owner crosses each threshold. */
const ProgressMeter = ({ pct, tierKey, label, cheer }) => {
  const { t } = useTranslation();
  const Icon = TIER_ICON[tierKey] || Sparkles;
  return (
    <div className="lp-meter glass-card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 mb-8">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className={`lp-meter__badge ${tierKey === 'ready' ? 'is-ready' : ''}`}>
            <Icon className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm sm:text-base leading-tight">{label}</p>
            <p className="text-gray-400 text-xs sm:text-sm truncate">{cheer}</p>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <span key={pct} className="lp-meter__pct">{pct}<span className="lp-meter__pct-sign">%</span></span>
          <p className="text-gray-500 text-[11px] leading-none">{t('listProperty.meter.complete')}</p>
        </div>
      </div>

      <div className="lp-meter__track">
        <div className="lp-meter__fill" style={{ width: `${pct}%` }} />
        {MILESTONES.map((m) => (
          <span key={m} className={`lp-meter__node ${pct >= m ? 'reached' : ''}`} style={{ left: `${m}%` }} />
        ))}
      </div>
      <div className="lp-meter__scale">
        {MILESTONES.map((m) => (
          <span key={m} className={pct >= m ? 'reached' : ''} style={{ left: `${m}%` }}>{m}%</span>
        ))}
      </div>
    </div>
  );
};

export default ProgressMeter;
