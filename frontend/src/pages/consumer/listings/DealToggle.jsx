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
      className={'deal-seg flex w-full sm:inline-flex sm:w-auto p-1 rounded-full glass border border-white/10 ' + className}
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
            className={'deal-seg-btn flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 h-9 px-4 sm:px-5 rounded-full text-sm font-semibold t-all ' + (active ? 'is-active' : 'text-gray-400 hover:text-white')}
          >
            <Icon name={o.icon} className="w-4 h-4" /> {o.label}
          </button>
        );
      })}
    </div>
  );
}
