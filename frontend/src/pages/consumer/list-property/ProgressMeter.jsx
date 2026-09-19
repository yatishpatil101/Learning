import { Sparkles, TrendingUp, Flame, Rocket, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MILESTONES } from './progress.js';
import { STRONG_PHOTO_COUNT } from './constants.js';

const TIER_ICON = {
  warmup: Sparkles,
  momentum: TrendingUp,
  half: Flame,
  almost: Rocket,
  ready: Trophy,
};

/* Dynamic keys are invisible to `check:i18n`, so the mobile wizard spec asserts the
   rendered text instead — a missing key renders as the key itself and fails there. */
const TIER_CHEER = {
  warmup: 'listProperty.meter.cheer.warmup',
  momentum: 'listProperty.meter.cheer.momentum',
  half: 'listProperty.meter.cheer.half',
  almost: 'listProperty.meter.cheer.almost',
  ready: 'listProperty.meter.cheer.ready',
};

const NUDGE_TEXT = {
  photos: 'listProperty.meter.nudge.photos',
  evidence: 'listProperty.meter.nudge.evidence',
  description: 'listProperty.meter.nudge.description',
  amenities: 'listProperty.meter.nudge.amenities',
  documents: 'listProperty.meter.nudge.documents',
};

/* Milestone nodes light up as the owner crosses each threshold. It never gates publishing; `canPost` does. */
const ProgressMeter = ({ pct, tierKey, label, done, total, nudge }) => {
  const { t } = useTranslation();
  const Icon = TIER_ICON[tierKey] || Sparkles;
  return (
    <div className="lp-meter dz-docks-under-nav glass-card rounded-2xl px-5 py-4 sm:px-6 sm:py-5 mb-8">
      <div className="lp-meter__head flex items-center justify-between gap-4 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className={`lp-meter__badge ${tierKey === 'ready' ? 'is-ready' : ''}`}>
            <Icon className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm sm:text-base leading-tight">{label}</p>
            {/* One nudge, and only while it is still true — the tier cheer takes over once the
               highest-impact answers are in, so nothing keeps asking for what is already there. */}
            <p className="lp-meter__cheer text-gray-400 text-xs sm:text-sm truncate" data-nudge={nudge || ''} role="status" aria-live="polite" aria-atomic="true">
              {nudge
                ? t(NUDGE_TEXT[nudge], { count: STRONG_PHOTO_COUNT })
                : t(TIER_CHEER[tierKey] || TIER_CHEER.warmup, { done, total, remaining: total - done })}
            </p>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <span key={pct} className="lp-meter__pct">{pct}<span className="lp-meter__pct-sign">%</span></span>
          <p className="text-gray-500 text-[11px] leading-none">{t('listProperty.meter.strength')}</p>
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
