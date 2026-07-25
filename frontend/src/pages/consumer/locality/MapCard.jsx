import Icon from '../../../components/Icon.jsx';
import PropertyMap from '../../../components/property/PropertyMap.jsx';

export default function MapCard({ activeName, activeCoords, locProps }) {
  if (!activeCoords) return null;
  return (
    <div>
      <h2 className="reveal text-lg font-bold text-white flex items-center gap-2 mb-3"><Icon name="map-pinned" className="w-5 h-5 text-teal-400" /> {activeName} on the map{locProps.length ? <span className="text-gray-500 text-sm font-normal">· {locProps.length} {locProps.length > 1 ? 'homes' : 'home'} plotted</span> : null}</h2>
      <PropertyMap properties={locProps} focus={[activeCoords]} wrapStyle={{ height: 380 }} />
    </div>
  );
}
