import { Link } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import { fmtRs } from './helpers.js';

export default function InventoryBar({ inv, activeName }) {
  const { t } = useTranslation();
  return inv && inv.count ? (
    <Link to={`/listings?q=${encodeURIComponent(activeName)}`} className="glass-card rounded-2xl px-5 py-3.5 flex items-center justify-between gap-3 hover:border-teal-400/30 transition-all group">
      <span className="flex items-center gap-2.5 text-sm text-gray-200">
        <Icon name="home" className="w-4.5 h-4.5 text-teal-400" />
        <span><Trans i18nKey="locality.invHomes" count={inv.count} values={{ count: inv.count, name: activeName }} components={{ 1: <span className="font-bold text-white" /> }} />{inv.from < Infinity ? <> · {t('locality.invFrom')} <span className="font-semibold text-white">{fmtRs(inv.from)}</span></> : null}</span>
      </span>
      <span className="text-teal-400 text-sm font-semibold inline-flex items-center gap-1 flex-shrink-0">{t('locality.invView')} <Icon name="arrow-right" className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" /></span>
    </Link>
  ) : (
    <Link to="/list-property" className="glass-card rounded-2xl px-5 py-3.5 flex items-center justify-between gap-3 hover:border-teal-400/30 transition-all group">
      <span className="flex items-center gap-2.5 text-sm text-gray-300"><Icon name="plus-circle" className="w-4.5 h-4.5 text-teal-400" /> {t('locality.invNone', { name: activeName })}</span>
      <span className="text-teal-400 text-sm font-semibold inline-flex items-center gap-1 flex-shrink-0">{t('locality.invListFree')} <Icon name="arrow-right" className="w-4 h-4" /></span>
    </Link>
  );
}
