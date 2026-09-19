import { Home, MapPin, IndianRupee, Images, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/* Locating a property and pricing it are two different jobs, so the whole-place flow asks them on their
   own screens; a room host answers both on one short screen and keeps a three-phase rail. */
export const WHOLE_STEPS = [
  { icon: Home, labelKey: 'listProperty.stepNav.details' },
  { icon: MapPin, labelKey: 'listProperty.stepNav.location' },
  { icon: IndianRupee, labelKey: 'listProperty.stepNav.pricing' },
  { icon: Images, labelKey: 'listProperty.stepNav.photosDocs' },
];

export const FLATMATE_STEPS = [
  { icon: Home, labelKey: 'listProperty.stepNav.details' },
  { icon: MapPin, labelKey: 'listProperty.stepNav.locationPrice' },
  { icon: Images, labelKey: 'listProperty.stepNav.photosDocs' },
];

/* Discrete labelled phases, complementary to the continuous momentum meter above rather than a second
   copy of it. Completed steps are clickable to jump back. */
export default function StepNav({ current, steps, onJump }) {
  const { t } = useTranslation();
  return (
    <div className="lp-steps mb-8" role="list" aria-label={t('listProperty.stepNav.ariaLabel')}>
      {steps.map((s, idx) => {
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
