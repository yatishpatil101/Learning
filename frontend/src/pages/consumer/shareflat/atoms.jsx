import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { isFresh } from './helpers.js';

const Chip = ({ children }) => <span className="chip px-2 py-0.5 rounded-md text-[10px] text-gray-300">{children}</span>;
const SaveBtn = ({ k, saved, onSave, small, data }) => {
  const { t } = useTranslation();
  return (
    <button onClick={() => onSave(k, data)} className={'save-btn seg p-' + (small ? '1.5' : '2') + ' rounded-lg text-gray-400' + (saved ? ' saved' : '')} aria-pressed={saved} aria-label={saved ? t('shareFlat.saved') : t('shareFlat.save')}><Icon name="bookmark" className={small ? 'w-3.5 h-3.5' : 'w-4 h-4'} /></button>
  );
};

// Shown only when the viewer has a live request to compare against — makes the
// otherwise-invisible "Best match" ranking legible right on the card.
const MatchPill = ({ tier }) => {
  const { t } = useTranslation();
  if (!tier) return null;
  const great = tier === 'great';
  return (
    <span
      className={'sf-match inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ' + (great ? 'sf-match-great text-white' : 'sf-match-good')}
      title={t('shareFlat.matchPillTitle')}
    >
      <Icon name="sparkles" className="w-2.5 h-2.5" /> {great ? t('shareFlat.matchGreat') : t('shareFlat.matchGood')}
    </span>
  );
};

// Honest freshness flag: shown only for posts created in the last 24h so seekers
// can spot the newest, most-likely-still-available requests at a glance.
const Fresh = ({ item }) => {
  const { t } = useTranslation();
  return (isFresh(item)
    ? <span className="sf-fresh inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider" title={t('shareFlat.freshTitle')}><Icon name="zap" className="w-2.5 h-2.5" /> {t('shareFlat.freshNew')}</span>
    : null);
};

export { Chip, SaveBtn, MatchPill, Fresh };
