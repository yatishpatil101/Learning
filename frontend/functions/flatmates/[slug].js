import { flatmateRoute } from '../../edge/landing-pages.mjs';

export const onRequestGet = ({ request, env, params }) => flatmateRoute({ request, env, slug: params.slug });

export const onRequestHead = onRequestGet;
