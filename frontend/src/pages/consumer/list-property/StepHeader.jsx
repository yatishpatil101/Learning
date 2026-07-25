import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * StepHeader — the title block at the top of each listing step.
 *
 * Keeps the step's name and one-line intent on the left, and offers a quiet
 * "Start over" escape hatch on the right. The reset control stays deliberately
 * understated — grey until hover, then it warms to red to signal that it wipes
 * work — so it never competes with the step's primary actions.
 *
 * @param {string} title - Step name (e.g. "Property details").
 * @param {string} subtitle - One-line description of the step.
 * @param {() => void} [onReset] - Opens the start-over confirmation. Omit to hide.
 */
export default function StepHeader({ title, subtitle, onReset }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-4 mb-8">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">{title}</h2>
        <p className="text-gray-500 text-sm">{subtitle}</p>
      </div>
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="lp-reset group inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-gray-400 transition-all hover:border-red-400/40 hover:bg-red-500/5 hover:text-red-300"
          aria-label={t('listProperty.startOverAria')}
        >
          <RotateCcw className="w-3.5 h-3.5 transition-transform group-hover:-rotate-45" />
          <span className="hidden sm:inline">{t('listProperty.startOver')}</span>
        </button>
      )}
    </div>
  );
}
