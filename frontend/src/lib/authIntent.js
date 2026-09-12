/* Contextual auth intent + shared post-auth destination: why a gate sent the user here, so the
   copy matches the action. Resolves to i18n keys, never copy — docs/flows/consumer/auth.md. */

/** Reason keys, in the order inferReason tries them. Copy lives in auth.json. */
export const AUTH_REASONS = [
  'save', 'contact', 'alerts', 'schedule', 'checkout', 'services', 'invite',
  'saved', 'notifications', 'messages', 'community', 'listproperty', 'dashboard',
  'default',
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
    path = new URL(path, 'https://draazy.invalid').pathname;
  } catch {
    return null;
  }
  if (!isSingleSafePath(path)) return null;
  path = path.replace(/\/+$/, '').toLowerCase() || '/';
  if (AUTH_SCREENS.includes(path)) return null;
  return next;
}

// Single post-auth destination shared by Sign In and Sign Up, so one authentication never lands
// users in two different places. `fallback` is validated too — docs/flows/consumer/auth.md.
export function postAuthDest(params, fallback = '/dashboard') {
  return safeInAppPath(params.get('next')) || safeInAppPath(fallback) || '/dashboard';
}
