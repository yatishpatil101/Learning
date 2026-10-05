import { useEffect, useState } from 'react';
import { getListingPolicy } from '../../services/settingsService.js';
import { DEFAULT_MAX_PHOTOS } from './policy.js';

let cached = null;
let pending = null;

const load = () => {
  pending ??= getListingPolicy()
    .then((policy) => { cached = policy.maxPhotos; return cached; })
    .catch(() => DEFAULT_MAX_PHOTOS)
    .finally(() => { pending = null; });
  return pending;
};

/** The admin-configured photo ceiling. The server enforces the same number on every write. */
export default function usePhotoLimit() {
  const [maxPhotos, setMaxPhotos] = useState(cached ?? DEFAULT_MAX_PHOTOS);
  useEffect(() => {
    let live = true;
    const refresh = () => load().then((n) => { if (live) setMaxPhotos(n); });
    const onChange = () => { cached = null; refresh(); };
    refresh();
    window.addEventListener('draazy-settings-change', onChange);
    return () => { live = false; window.removeEventListener('draazy-settings-change', onChange); };
  }, []);
  return maxPhotos;
}
