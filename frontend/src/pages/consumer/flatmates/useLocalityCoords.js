import { useEffect, useState } from 'react';
import { listLocalities } from '../../../services/localityService.js';

let cached = null;
let pending = null;

const load = () => {
  pending ??= listLocalities().then((rows) => {
    cached = Object.fromEntries(rows.filter((r) => r.lat != null && r.lng != null).map((r) => [r.name, [r.lat, r.lng]]));
    return cached;
  }).finally(() => { pending = null; });
  return pending;
};

export function useLocalityCoords() {
  const [coords, setCoords] = useState(cached || {});
  useEffect(() => {
    if (cached) return undefined;
    let live = true;
    load().then((map) => { if (live) setCoords(map); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return coords;
}
