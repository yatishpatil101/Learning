/* Contextual auth intent + shared post-auth destination: why a gate sent the user here, so the
   copy matches the action. Resolves to i18n keys, never copy — docs/flows/consumer/auth.md. */

/** Reason keys. `inferReason` below tries a subset, in its own order. Copy lives in auth.json. */
export const AUTH_REASONS = [
  'save', 'contact', 'alerts', 'schedule', 'checkout', 'services', 'invite',
  'saved', 'notifications', 'messages', 'community', 'society', 'listproperty', 'dashboard',
  'review', 'offer', 'docs', 'photos', 'verify', 'default',
];

// Map a `next` path to a reason key. Order matters (most specific first).
function inferReason(next) {
  if (!next) return null;
  const p = String(next).toLowerCase();
  if (p.includes('deal=') && p.startsWith('/listings')) return 'alerts';
  if (p.startsWith('/checkout')) return 'checkout';
  if (p.startsWith('/services') || p.startsWith('/home-loans')) return 'services';
  if (p.startsWith('/schedule-visit')) return 'schedule';
  if (p.startsWith('/saved')) return 'saved';
  if (p.startsWith('/notifications')) return 'notifications';
  if (p.startsWith('/messages')) return 'messages';
  if (p.startsWith('/society')) return 'society';
  if (p.startsWith('/list-property')) return 'listproperty';
  if (p.startsWith('/dashboard')) return 'dashboard';
  return null;
}

// Resolve the intent for the auth screen from URLSearchParams.
// Returns { key, headingKey, subKey, isDefault } — the caller translates.
export function resolveAuthIntent(params) {
  const explicit = params.get('reason');
  const key = (explicit && AUTH_REASONS.includes(explicit) && explicit) || inferReason(params.get('next')) || 'default';
  return {
    key,
    headingKey: `auth.intent.${key}Heading`,
    subKey: `auth.intent.${key}Sub`,
    isDefault: key === 'default',
  };
}

/** Decides whether a `?next=` is in-app and worth landing on,
 * else null. Rejection rationale: docs/flows/consumer/auth.md */
const AUTH_SCREENS = ['/signin', '/signup', '/staff-login', '/staff-invite'];
// A host this app can never legitimately be served from, so any payload the URL parser resolves
// away from it has named an origin of its own and is not ours.
const SENTINEL_ORIGIN = 'https://draazy.invalid';
const isSingleSafePath = (path) =>
  path.startsWith('/')
  && !path.startsWith('//')
  && !path.includes('\\')
  && !/[\u0000-\u001F\u007F]/.test(path);

export function safeInAppPath(raw) {
  const next = raw || '';
  if (!isSingleSafePath(next)) return null;
  // Compare the path alone: `/signin?reason=save` is the same dead end as `/signin`.
  let path = next.split(/[?#]/)[0];
  try {
    while (path.includes('%')) {
      const decoded = decodeURIComponent(path);
      if (decoded === path) break;
      path = decoded;
    }
    /* Check the parser's verdict on the ORIGIN: `/%09/evil.example`
       parses to pathname '/' and passes path checks. / */
    const parsed = new URL(path, SENTINEL_ORIGIN);
    if (parsed.origin !== SENTINEL_ORIGIN) return null;
    path = parsed.pathname;
  } catch {
    return null;
  }
  if (!isSingleSafePath(path)) return null;
  path = path.replace(/\/+$/, '').toLowerCase() || '/';
  if (AUTH_SCREENS.includes(path)) return null;
  /* Return the RAW value: normalizing drops the query and lowercases the path. Safe since the checks above
     resolved it rather than pattern-matching. */
  return next;
}

// Single post-auth destination shared by Sign In and Sign Up, so one authentication never lands
// users in two different places. `fallback` is validated too — docs/flows/consumer/auth.md.
export function postAuthDest(params, fallback = '/dashboard') {
  return safeInAppPath(params.get('next')) || safeInAppPath(fallback) || '/dashboard';
}

/** The reason a gate will actually be answered with, which is not always the one it asked for. */
export const gateReason = (reason) => (AUTH_REASONS.includes(reason) ? reason : 'default');

/** `next` defaults to the originating page and is always validated, so it can't become an off-site redirect. */
export function signInPath(reason, next) {
  const dest = safeInAppPath(next ?? window.location.pathname + window.location.search);
  return `/signin?reason=${gateReason(reason)}${dest ? `&next=${encodeURIComponent(dest)}` : ''}`;
}
