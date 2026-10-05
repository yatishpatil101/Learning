import { Home, MapPin, IndianRupee, Images, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const LISTING_STEPS = [
  { icon: Home, labelKey: 'listProperty.stepNav.details' },
  { icon: MapPin, labelKey: 'listProperty.stepNav.location' },
  { icon: IndianRupee, labelKey: 'listProperty.stepNav.pricing' },
  { icon: Images, labelKey: 'listProperty.stepNav.photosDocs' },
];

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
