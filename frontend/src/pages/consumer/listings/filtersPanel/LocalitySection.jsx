import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import LocalitySearchInput from '../../../../components/search/LocalitySearchInput.jsx';
import { FilterGroup, Divider } from '../FilterControls.jsx';

export default function LocalitySection({ f, set, localities, onAddLocality }) {
  const { t } = useTranslation();
  const picked = [...f.localities].map((slug) => ({ slug, name: localities.find((l) => l.slug === slug)?.name || slug }));
  const add = (loc) => {
    onAddLocality(loc);
    set((prev) => ({ localities: new Set([...prev.localities, loc.slug]) }));
  };
  const remove = (slug) => set((prev) => ({ localities: new Set([...prev.localities].filter((s) => s !== slug)) }));

  return (
    <>
      <FilterGroup icon="map-pin" title={t('listings.localities')} summary={f.localities.size ? t('listings.selectedCount', { count: f.localities.size }) : ''}>
        <div className="space-y-2.5">
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {picked.map((l) => (
                <button
                  key={l.slug}
                  type="button"
                  onClick={() => remove(l.slug)}
                  aria-label={t('ui.removeItem', { label: l.name })}
                  className="flex items-center gap-1 rounded-lg bg-teal-500/15 px-2.5 py-1 text-[11px] font-semibold text-teal-200 hover:bg-teal-500/25"
                >
                  {l.name} <Icon name="x" className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}
          <LocalitySearchInput
            onPick={add}
            clearOnPick
            placeholder={t('listings.searchLocalityPlaceholder')}
            ariaLabel={t('listings.localities')}
          />
        </div>
      </FilterGroup>
      <Divider />
    </>
  );
}
