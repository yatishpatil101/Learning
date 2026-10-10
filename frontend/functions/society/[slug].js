import { edgePage, societyPage } from '../../edge/seo-pages.mjs';

export function onRequestGet({ request, env, params }) {
  return edgePage({
    request,
    env,
    apiPath: `/societies/${encodeURIComponent(params.slug)}`,
    render: (shell, s, url) => societyPage(shell, s, { slug: url.pathname.split('/')[2], search: url.search }),
  });
}

export const onRequestHead = onRequestGet;
