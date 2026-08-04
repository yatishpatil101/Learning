import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

// Rent/Buy intent switch. Buy and Rent are distinct journeys in Indian real estate
// (different filters, urgency and trust cues), so the switch is a first-class control
// rather than a URL-only param. Reuses the brand segmented-pill look (`.deal-seg`).
export default function DealToggle({ deal, onChange, className = '' }) {
  const { t } = useTranslation();
  const opts = [
    { key: 'buy', label: t('listings.forSale'), icon: 'home' },
    { key: 'rent', label: t('listings.forRent'), icon: 'key-round' },
  ];
  return (
    <div
      className={'deal-seg inline-flex w-auto p-[3px] sm:p-1 rounded-full glass border border-white/10 ' + className}
      role="radiogroup"
      aria-label={t('listings.dealToggleAria')}
    >
      {opts.map((o) => {
        const active = deal === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => { if (!active) onChange(o.key); }}
            /* Drawn at 36px so the whole capsule measures 44px on a phone — the same
               height as the sort dropdown and the query field it sits above. The finger
               target is restored by .tap-extend's transparent 44px ::before rather than
               by inflating the painted pill, which is the same trade the top-bar pills
               make. See the .tap-extend note in index.css. */
            className={'deal-seg-btn relative tap-extend inline-flex items-center justify-center gap-1 sm:gap-1.5 h-9 px-3 sm:px-5 rounded-full text-sm font-semibold t-all ' + (active ? 'is-active' : 'text-gray-400 hover:text-white')}
          >
            <Icon name={o.icon} className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> {o.label}
          </button>
        );
      })}
    </div>
  );
}
