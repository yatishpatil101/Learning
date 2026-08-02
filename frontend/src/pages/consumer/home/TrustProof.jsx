import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { STATS } from '../../../data/homeData.js';

/* Trust chips + headline stats.

   Extracted from Home because these two blocks sit in the hero on desktop but
   below the Featured rail on mobile — no CSS `order` can move a block across a
   section boundary, so both surfaces render this one component instead of
   keeping two copies of the markup in sync. Exactly one instance is displayed
   at any width, so the accessibility tree never sees a duplicate. */

const CHIPS = [
  { icon: 'shield-check', key: 'trustAadhaar', tone: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300', ink: 'text-emerald-300', dot: 'bg-emerald-400/15 text-emerald-300' },
  { icon: 'hand-coins', key: 'trustZeroBrokerage', tone: 'bg-teal-500/10 border-teal-500/25 text-teal-300', ink: 'text-teal-300', dot: 'bg-teal-400/15 text-teal-300' },
  { icon: 'phone-off', key: 'trustNoSpam', tone: 'bg-teal-500/10 border-teal-500/25 text-teal-300', ink: 'text-teal-300', dot: 'bg-teal-400/15 text-teal-300' },
  { icon: 'badge-check', key: 'trustAssured', tone: 'bg-amber-500/10 border-amber-500/25 text-amber-300', ink: 'text-amber-300', dot: 'bg-amber-400/15 text-amber-300' },
];

/* `compact` is the mobile hero layout.

   Two earlier attempts failed for the same reason: they drew boxes. Four pills
   sized to their own labels read as scattered debris, and boxing them into a
   ruled 2x2 panel just traded scatter for a heavy table sitting under the
   headline. Both spent chrome on the container rather than on the claims.

   This is a checklist instead — no border, no fill, no rules. Each claim is a
   tinted icon disc plus a label, laid out 2x2 so the four sit in two lines, and
   the block is width-capped and centred so the two columns align optically
   under the headline. The only colour left is in the discs, which gives the
   group rhythm while the four labels read as one list.

   `*Short` labels keep every item on a single line at 360px. Only the mobile
   instance passes `compact`; the desktop instance renders the original pills. */
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
            <span className="text-[12px] font-semibold leading-tight text-gray-200">{t('home.hero.' + c.key + 'Short')}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className={'hero-trust flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 ' + className}>
      {CHIPS.map((c) => (
        <span key={c.key} className={'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs sm:text-sm font-semibold ' + c.tone}>
          <Icon name={c.icon} className="w-4 h-4" /> {t('home.hero.' + c.key)}
        </span>
      ))}
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
      {stat(STATS.properties, t('home.hero.statProperties'))}
      <div className="w-px h-10 bg-white/10 hidden sm:block" />
      {stat(STATS.verifiedOwners, t('home.hero.statVerifiedOwners'))}
      <div className="w-px h-10 bg-white/10 hidden sm:block" />
      {stat(STATS.localities, t('home.hero.statLocalities'))}
    </div>
  );
}

/* Mobile-only proof strip. The headline stats stay below the Featured rail —
   on a phone the "how big is this?" question only lands once real stock has
   been seen. The trust chips used to live here too, but they now replace the
   hero's marketing sentence at the top of the screen, so rendering them here
   as well would duplicate them in the accessibility tree. Rendered only below
   lg; the hero keeps its own copy at lg and up, unchanged. */
export default function MobileTrustProof() {
  return (
    <section className="lg:hidden relative section-pb">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <HeroStats />
      </div>
    </section>
  );
}
