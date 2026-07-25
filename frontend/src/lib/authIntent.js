/* Contextual auth intent + shared post-auth destination.
   Gates across the app bounce signed-out users to /signin (and sometimes on to
   /signup). This module lets the auth screens explain *why* the user landed there
   so the copy matches the action they were attempting — a measurable lift over a
   generic "Welcome Back". An explicit `?reason=` wins; otherwise we infer from the
   `next` path so most gates need no change. */

// reason key → { heading, sub }. `default` is the plain sign-in copy.
export const AUTH_INTENTS = {
  save: {
    heading: 'Sign in to save this home',
    sub: 'Keep your favourite properties in one place and pick up right where you left off.',
  },
  contact: {
    heading: 'Sign in to contact the owner',
    sub: 'Get owner phone numbers and message them directly — zero brokerage, no middlemen.',
  },
  alerts: {
    heading: 'Sign in to save this search',
    sub: "We'll alert you the moment a matching home is listed.",
  },
  schedule: {
    heading: 'Sign in to book your visit',
    sub: 'Schedule site visits and manage them from your dashboard.',
  },
  checkout: {
    heading: 'Sign in to complete your purchase',
    sub: 'Securely upgrade your plan and manage billing in one place.',
  },
  services: {
    heading: 'Sign in to book services',
    sub: 'Packers, legal, interiors, valuation and more — managed end to end.',
  },
  invite: {
    heading: 'Sign in to complete your Rent Agreement',
    sub: 'You were invited to add your details & documents. Sign in with the invited number to continue.',
  },
  saved: {
    heading: 'Sign in to see your saved homes',
    sub: 'Your shortlisted properties, synced across devices.',
  },
  notifications: {
    heading: 'Sign in to view notifications',
    sub: 'Never miss a price drop or a matching new listing.',
  },
  messages: {
    heading: 'Sign in to open your inbox',
    sub: 'Chat with owners and our service teams in one place.',
  },
  community: {
    heading: 'Sign in to join the community',
    sub: 'Connect with residents and explore verified society insights.',
  },
  listproperty: {
    heading: 'Sign in to list your property',
    sub: 'Reach thousands of verified buyers and tenants — free to post.',
  },
  dashboard: {
    heading: 'Sign in to open your dashboard',
    sub: 'Your saved homes, visits, alerts and enquiries in one place.',
  },
  default: {
    heading: 'Welcome Back',
    sub: 'Sign in with your mobile number to access your saved properties',
  },
};

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
// Returns { key, heading, sub, isDefault }.
export function resolveAuthIntent(params) {
  const explicit = params.get('reason');
  const key = (explicit && AUTH_INTENTS[explicit] && explicit) || inferReason(params.get('next')) || 'default';
  return { key, ...AUTH_INTENTS[key], isDefault: key === 'default' };
}

// Single post-auth destination shared by Sign In and Sign Up so the same
// authentication never lands users in two different places. Honours an explicit
// `next` (the gated flow) and otherwise sends everyone to their dashboard hub.
export function postAuthDest(params) {
  return params.get('next') || '/dashboard';
}
