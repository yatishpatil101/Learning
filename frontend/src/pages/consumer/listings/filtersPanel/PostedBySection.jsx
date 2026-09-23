import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { FilterGroup, Divider } from '../FilterControls.jsx';

/* Deliberately not a row inside Verification: "the owner posted this" and "we checked the owner"
   are different claims, and a broker can perfectly well post a listing whose owner we verified.
   Open by default, unlike both neighbours, because no-brokerage is the promise people arrive for. */
export default function PostedBySection({ f, set, idp = '' }) {
  const { t } = useTranslation();
  const helpId = `${idp}posted-by-help`;
  return (
    <>
      <FilterGroup icon="handshake" title={t('listings.postedBy')} summary={f.ownerOnly ? t('listings.selectedCount', { count: 1 }) : ''}>
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm text-gray-300 flex items-center gap-2"><Icon name="user-check" className="w-4 h-4 text-emerald-400" /> {t('listings.ownerOnly')}</span>
          <input type="checkbox" className="toggle-cb sr-only peer" aria-describedby={helpId} checked={f.ownerOnly} onChange={() => set({ ownerOnly: !f.ownerOnly })} />
          <span className="toggle-ui" />
        </label>
        <p id={helpId} className="text-xs text-gray-500 mt-2">{t('listings.ownerOnlyHelp')}</p>
      </FilterGroup>
      <Divider />
    </>
  );
}
