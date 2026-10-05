
/** Search engines execute JS, so this works — but it is worth being explicit that a prerender or SSR step would make
 * the help centre index far more reliably, and this is the seam where that would plug in. */
import { useEffect } from 'react';

const MANAGED = 'data-help-seo';

export function useHelpSeo(path, opts = {}) {
  const index = opts.index !== false;

  useEffect(() => {
    if (typeof document === 'undefined' || !path) return undefined;

    // Staff runbooks are reachable by URL but must never be indexed — they are
    // internal procedure, and a crawler has no staff session to be filtered by.
    if (!index) {
      const robots = document.createElement('meta');
      robots.setAttribute(MANAGED, '');
      robots.setAttribute('name', 'robots');
      robots.setAttribute('content', 'noindex, nofollow');
      document.head.appendChild(robots);
    }

    const canonical = document.createElement('link');
    canonical.setAttribute(MANAGED, '');
    canonical.setAttribute('rel', 'canonical');
    canonical.setAttribute('href', `${window.location.origin}${path}`);
    document.head.appendChild(canonical);

    return () => {
      document.head.querySelectorAll(`[${MANAGED}]`).forEach((el) => el.remove());
    };
  }, [path, index]);
}
