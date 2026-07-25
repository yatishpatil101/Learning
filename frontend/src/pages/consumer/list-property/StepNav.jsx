import { Home, MapPin, Images, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/* Steps for the whole-place listing flow. Icons make each phase scannable
   at a glance and keep the row on-brand with the gamified momentum meter. */
const STEPS = [
  { icon: Home, labelKey: 'listProperty.stepNav.details' },
  { icon: MapPin, labelKey: 'listProperty.stepNav.locationPrice' },
  { icon: Images, labelKey: 'listProperty.stepNav.photosDocs' },
];

/**
 * StepNav — a segmented, gamified step indicator for the listing wizard.
 *
 * Unlike the continuous % momentum meter above it, this shows the THREE
 * discrete phases as labelled segments with their own status, so the two
 * read as complementary (granular progress vs. where-am-I) rather than as
 * two duplicate progress rails. Completed steps are clickable to jump back.
 *
 * @param {number} current - 1-based active step.
 * @param {(step: number) => void} onJump - Navigate to an earlier step.
 */
export default function StepNav({ current, onJump }) {
  const { t } = useTranslation();
  return (
    <div className="lp-steps mb-8" role="list" aria-label={t('listProperty.stepNav.ariaLabel')}>
      {STEPS.map((s, idx) => {
        const stepNum = idx + 1;
        const state = current === stepNum ? 'active' : current > stepNum ? 'done' : 'todo';
        const done = state === 'done';
        const Tag = done ? 'button' : 'div';
        const status = done ? t('listProperty.stepNav.done') : state === 'active' ? t('listProperty.stepNav.inProgress') : t('listProperty.stepNav.upNext');
        return (
          <Tag
            key={s.labelKey}
            type={done ? 'button' : undefined}
            onClick={done ? () => onJump(stepNum) : undefined}
            className={`lp-steps__item is-${state}`}
            role="listitem"
            aria-current={state === 'active' ? 'step' : undefined}
          >
            <span className="lp-steps__rail" aria-hidden="true" />
            <span className="lp-steps__row">
              <span className="lp-steps__badge">
                {done ? <Check className="w-4 h-4" /> : <s.icon className="w-4 h-4" />}
              </span>
              <span className="lp-steps__text">
                <span className="lp-steps__label">
                  <span className="lp-steps__num">{t('listProperty.stepNav.stepNum', { n: stepNum })}</span>
                  {t(s.labelKey)}
                </span>
                <span className="lp-steps__status">{status}</span>
              </span>
            </span>
          </Tag>
        );
      })}
    </div>
  );
}
