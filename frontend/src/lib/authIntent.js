/* Contextual auth intent + shared post-auth destination.
   Gates across the app bounce signed-out users to /signin (and sometimes on to
   /signup). This module lets the auth screens explain *why* the user landed there
   so the copy matches the action they were attempting — a measurable lift over a
   generic "Welcome Back". An explicit `?reason=` wins; otherwise we infer from the
   `next` path so most gates need no change.

   This resolves to i18n *keys*, not copy. The strings live in
   i18n/locales/<lang>/auth.json under `auth.intent.*`, so a Marathi visitor sent
   here by a gate reads the reason in Marathi. Keeping English text here would
   have made this module a second, untranslated copy deck. */

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

// Single post-auth destination shared by Sign In and Sign Up so the same
// authentication never lands users in two different places. Honours an explicit
// `next` (the gated flow) and otherwise sends everyone to their dashboard hub.
// `next` is restricted to a single-slash in-app path: a protocol-relative
// "//evil.com" is a same-looking string that must never become a destination.
// Mirrors StaffLogin's safeNext so the two entry points can't drift.
export function postAuthDest(params) {
  const next = params.get('next') || '';
  return /^\/(?!\/)/.test(next) ? next : '/dashboard';
}
