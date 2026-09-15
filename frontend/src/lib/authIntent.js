/* Contextual auth intent + shared post-auth destination: why a gate sent the user here, so the
   copy matches the action. Resolves to i18n keys, never copy — docs/flows/consumer/auth.md. */

/** Reason keys. `inferReason` below tries a subset, in its own order. Copy lives in auth.json. */
export const AUTH_REASONS = [
  'save', 'contact', 'alerts', 'schedule', 'checkout', 'services', 'invite',
  'saved', 'notifications', 'messages', 'community', 'listproperty', 'dashboard',
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
  if (p.startsWith('/society')) return 'community';
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

/**
 * The one place deciding whether a `?next=` is in this app and is worth landing on; `null` for
 * "not ours". The four rejections and why origin needs three: docs/flows/consumer/auth.md
 */
const AUTH_SCREENS = ['/signin', '/signup', '/staff-login'];
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
    /* Take the parser's verdict on the ORIGIN, not just its pathname: `/%09/evil.example` decodes
       to a tab the parser strips, reads the rest as protocol-relative, and hands back
       `pathname === '/'` — which every path check waves through. Asking the sentinel origin covers
       every control character the parser strips rather than encodes, so it needs no list. */
    const parsed = new URL(path, SENTINEL_ORIGIN);
    if (parsed.origin !== SENTINEL_ORIGIN) return null;
    path = parsed.pathname;
  } catch {
    return null;
  }
  if (!isSingleSafePath(path)) return null;
  path = path.replace(/\/+$/, '').toLowerCase() || '/';
  if (AUTH_SCREENS.includes(path)) return null;
  /* The RAW value comes back, not the normalized one: normalization dropped the query and
     lower-cased the path to make the comparisons fair, and both corrupt a genuine destination.
     Safe only because the checks above RESOLVED the value — decoded to a fixed point, then parsed —
     rather than pattern-matching it, so no second reading of `next` is left for the sink. */
  return next;
}

// Single post-auth destination shared by Sign In and Sign Up, so one authentication never lands
// users in two different places. `fallback` is validated too — docs/flows/consumer/auth.md.
export function postAuthDest(params, fallback = '/dashboard') {
  return safeInAppPath(params.get('next')) || safeInAppPath(fallback) || '/dashboard';
}

/** The reason a gate will actually be answered with, which is not always the one it asked for. */
export const gateReason = (reason) => (AUTH_REASONS.includes(reason) ? reason : 'default');

/**
 * The destination a gate sends a signed-out visitor to. `next` defaults to the page they acted
 * from and is always validated, so an attacker-supplied value cannot become an off-site redirect.
 */
export function signInPath(reason, next) {
  const dest = safeInAppPath(next ?? window.location.pathname + window.location.search);
  return `/signin?reason=${gateReason(reason)}${dest ? `&next=${encodeURIComponent(dest)}` : ''}`;
}
