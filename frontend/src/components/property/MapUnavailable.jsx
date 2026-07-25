import Icon from '../Icon.jsx';

/* Graceful fallback shown in place of a Google Map when no Maps API key is configured
   (VITE_GOOGLE_MAPS_API_KEY is empty). Keeps the surrounding layout intact instead of
   mounting a broken/blank <APIProvider>. Callers pass the same wrapper style/className
   they'd give the map so the placeholder occupies the identical footprint. */
export default function MapUnavailable({ style, className = '', note = 'Map unavailable' }) {
  return (
    <div
      className={'w-full rounded-2xl overflow-hidden border border-white/10 flex items-center justify-center bg-white/[0.02] ' + className}
      style={style}
    >
      <div className="text-center px-6 py-10">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10">
          <Icon name="map-pin" className="h-6 w-6 text-gray-500" />
        </div>
        <p className="text-sm font-semibold text-gray-300">{note}</p>
        <p className="mt-1 text-xs text-gray-500">The interactive map isn&rsquo;t configured right now.</p>
      </div>
    </div>
  );
}
