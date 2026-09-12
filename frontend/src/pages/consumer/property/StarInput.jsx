import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

/**
 * The property review composer's rating control (D198).
 *
 * Each star is a `<button>` whose only child is an SVG, so without a label its accessible name is
 * the empty string. `ReviewModal` mounts six of these — one overall plus one per aspect — which is
 * thirty unlabelled buttons in a dialog, announced as "button" thirty times over with nothing to
 * distinguish a one-star from a five-star, or Value from Condition. That is not a degraded
 * experience but an unusable one: no reading order recovers the meaning.
 *
 * `aspect` is what keeps the six strips apart. Without it every row answers to the same "3 star" —
 * for a screen reader and for `getByRole`, whose name match is a substring one. The society
 * composer (`Society.jsx`) already settled this shape and its e2e specs depend on it, so the
 * wording here is deliberately identical: "3 star" for the overall strip, "3 star for Value" for an
 * aspect row. Any caller mounting more than one strip must pass `aspect`.
 */
export function StarInput({ value, onChange, size = 24, aspect }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          className="p-0.5 leading-none"
          aria-label={aspect ? t('property.starAriaCat', { count: i, aspect }) : t('property.starAria', { count: i })}
        >
          <Icon name="star" style={{ width: size, height: size }} className={i <= value ? 'fill-amber-400 text-amber-400' : 'text-slate-600'} />
        </button>
      ))}
    </span>
  );
}
