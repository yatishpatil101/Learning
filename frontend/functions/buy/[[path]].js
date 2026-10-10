import { landingRoute } from '../../edge/landing-pages.mjs';

export const onRequestGet = ({ request, env, params }) => landingRoute({ request, env, deal: 'buy', segments: params.path });

export const onRequestHead = onRequestGet;
