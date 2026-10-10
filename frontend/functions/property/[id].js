import { edgePage, propertyPage } from '../../edge/seo-pages.mjs';
import { propertyKey } from '../../src/lib/listingSeo.js';

export function onRequestGet({ request, env, params }) {
  return edgePage({
    request,
    env,
    apiPath: `/properties/${encodeURIComponent(propertyKey(params.id))}`,
    render: (shell, p, url) => propertyPage(shell, p, { pathname: url.pathname, search: url.search }),
  });
}

export const onRequestHead = onRequestGet;
