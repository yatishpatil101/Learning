import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { STATS } from '../../../data/homeData.js';

/* One component for both surfaces because no CSS `order` moves a block across a section boundary, and these
   sit in the hero on desktop but below the Featured rail on mobile. Only one instance shows at any width. */

const CHIPS = [
  { icon: 'phone-off', key: 'trustNoSpam', tone: 'bg-teal-500/10 border-teal-500/25 text-teal-300', ink: 'text-teal-300', dot: 'bg-teal-400/15 text-teal-300' },
  { icon: 'user-check', key: 'trustOwners', tone: 'bg-teal-500/10 border-teal-500/25 text-teal-300', ink: 'text-teal-300', dot: 'bg-teal-400/15 text-teal-300' },
  { icon: 'hand-coins', key: 'trustZeroBrokerage', tone: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300', ink: 'text-emerald-300', dot: 'bg-emerald-400/15 text-emerald-300' },
  { icon: 'badge-check', key: 'trustAssured', to: '/how-verification-works', tone: 'bg-amber-500/10 border-amber-500/25 text-amber-300', ink: 'text-amber-300', dot: 'bg-amber-400/15 text-amber-300' },
];

/* The extension keeps the link's 44px target without growing the chip row, which is budgeted to the fold. */
function Label({ to, children }) {
  const cls = 'text-[12px] font-semibold leading-tight text-gray-200';
  return to
    ? <Link to={to} className={'relative tap-extend ' + cls}>{children}</Link>
    : <span className={cls}>{children}</span>;
}

/* `compact` is the mobile hero layout: a checklist, not boxes, because pills read as scatter and a ruled
   2x2 as a heavy table. Colour lives only in the icon discs so the four labels read as one list. */
export function TrustChips({ className = '', compact = false }) {
  const { t } = useTranslation();
  if (compact) {
    return (
      <ul className={'hero-trust grid grid-cols-2 gap-x-3 gap-y-3 max-w-[20rem] mx-auto text-left ' + className}>
        {CHIPS.map((c) => (
          <li key={c.key} className="flex items-center gap-2">
            <span className={'grid place-items-center w-6 h-6 rounded-full shrink-0 ' + c.dot}>
              <Icon name={c.icon} className="w-3.5 h-3.5" />
            </span>
            <Label to={c.to}>{t('home.hero.' + c.key + 'Short')}</Label>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className={'hero-trust flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 ' + className}>
      {CHIPS.map((c) => {
        const Tag = c.to ? Link : 'span';
        return (
          <Tag key={c.key} to={c.to} className={'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs sm:text-sm font-semibold ' + c.tone}>
            <Icon name={c.icon} className="w-4 h-4" /> {t('home.hero.' + c.key)}
          </Tag>
        );
      })}
    </div>
  );
}

export function HeroStats({ className = '' }) {
  const { t } = useTranslation();
  const stat = (value, label) => (
    <div className="text-center">
      <div className="text-2xl sm:text-3xl font-extrabold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div className="text-xs sm:text-sm text-gray-400 mt-1">{label}</div>
    </div>
  );
  return (
    <div className={'hero-stats flex items-center justify-center flex-wrap gap-6 sm:gap-12 ' + className}>
      {stat(STATS.brokerage, t('home.hero.statBrokerage'))}
      <div className="w-px h-10 bg-white/10 hidden sm:block" />
      {stat(STATS.otpVerified, t('home.hero.statOtpVerified'))}
      <div className="w-px h-10 bg-white/10 hidden sm:block" />
      {stat(STATS.localityGuides, t('home.hero.statLocalityGuides'))}
    </div>
  );
}

/* The stats stay under the Featured rail because on a phone "how big is this?" only lands once real stock
   has been seen. The trust chips are excluded: the hero carries them, and a second copy duplicates the a11y tree. */
export default function MobileTrustProof() {
  return (
    <section className="lg:hidden relative section-pb">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <HeroStats />
      </div>
    </section>
  );
}
