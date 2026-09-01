import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { FilterGroup } from '../FilterControls.jsx';
import { sectionVisible, VERIF_SECTIONS } from '../../../../lib/listings/filterRelevance.js';

export default function VerificationSection({ f, set }) {
  const { t } = useTranslation();
  const vis = (section) => sectionVisible(section, f.types);
  const verifShown = (k) => !VERIF_SECTIONS[k] || vis(VERIF_SECTIONS[k]);
  return (
    <FilterGroup icon="shield-check" title={t('listings.verification')} summary={Object.keys(f.verified).filter((k) => f.verified[k] && verifShown(k)).length ? t('listings.selectedCount', { count: Object.keys(f.verified).filter((k) => f.verified[k] && verifShown(k)).length }) : ''} defaultCollapsed>
      <div className="space-y-3">
        {[['owner', 'user-check', t('listings.verifOwner'), 'text-emerald-400'], ['ownership', 'file-check', t('listings.verifOwnership'), 'text-teal-400'], ['rera', 'badge-check', t('listings.verifRera'), 'text-teal-400'], ['society', 'building-2', t('listings.verifSociety'), 'text-emerald-400'], ['conveyance', 'scroll-text', t('listings.verifConveyance'), 'text-teal-300']]
          .filter(([k]) => verifShown(k))
          .map(([k, ic, label, col]) => (
          <label key={k} className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-gray-300 flex items-center gap-2"><Icon name={ic} className={`w-4 h-4 ${col}`} /> {label}</span>
            <input type="checkbox" className="toggle-cb sr-only peer" checked={!!f.verified[k]} onChange={() => set({ verified: { ...f.verified, [k]: !f.verified[k] } })} />
            <span className="toggle-ui" />
          </label>
        ))}
      </div>
    </FilterGroup>
  );
}
