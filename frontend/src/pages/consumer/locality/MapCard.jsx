import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import PropertyMap from '../../../components/property/PropertyMap.jsx';

export default function MapCard({ activeName, activeCoords, locProps }) {
  const { t } = useTranslation();
  if (!activeCoords) return null;
  return (
    <div>
      <h2 className="reveal text-lg font-bold text-white flex items-center gap-2 mb-3"><Icon name="map-pinned" className="w-5 h-5 text-teal-400" /> {t('locality.mapTitle', { name: activeName })}{locProps.length ? <span className="text-gray-500 text-sm font-normal">· {t('locality.mapPlotted', { count: locProps.length })}</span> : null}</h2>
      <PropertyMap properties={locProps} focus={[activeCoords]} wrapStyle={{ height: 380 }} />
    </div>
  );
}
