import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import PropertyMap from '../../../components/property/PropertyMap.jsx';
import { useNearViewport } from '../../../lib/useNearViewport.js';
import { listProperties } from '../../../services/propertyService.js';

/** Keyed by locality slug: the viewport observer only attaches to the element of the first render. */
export default function MapCard({ slug, activeName, activeCoords }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const near = useNearViewport(ref, '600px');
  const [locProps, setLocProps] = useState([]);
  useEffect(() => {
    if (!near) return undefined;
    let alive = true;
    listProperties({ locality: slug, includeAllStatuses: false }, 'newest')
      .then((ps) => { if (alive) setLocProps(ps); })
      .catch(() => {});
    return () => { alive = false; };
  }, [near, slug]);
  if (!activeCoords) return null;
  return (
    <div ref={ref}>
      <h2 className="reveal text-lg font-bold text-white flex items-center gap-2 mb-3"><Icon name="map-pinned" className="w-5 h-5 text-teal-400" /> {t('locality.mapTitle', { name: activeName })}{locProps.length ? <span className="text-gray-500 text-sm font-normal">· {t('locality.mapPlotted', { count: locProps.length })}</span> : null}</h2>
      <PropertyMap properties={locProps} focus={[activeCoords]} wrapStyle={{ height: 380 }} />
    </div>
  );
}
