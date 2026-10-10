/* Navigation-bar policy lives here; dimensions and per-breakpoint behaviour live in the CSS chrome tokens.
   Both bars are responsive by CSS, so a width test here would put the breakpoint in two places. */

/** Routes that render their own top offset for the fixed navbar, so ConsumerLayout
    must not add a second one. Each reserves --dz-nav-h itself. */
const SELF_PADDED = ['/', '/listings', '/property', '/signin', '/signup', '/staff-login', '/staff-invite'];

/** Full-screen experiences: no marketing footer, no floating assistant. */
const FULL_BLEED = ['/reels'];

/** App-native chat. Goes full-screen below md and pins its composer to the viewport
    bottom, so a tab bar would fight it for the same edge. */
const CHAT = ['/messages'];

/** Focused conversion funnels. The long footer and the assistant bubble are noise
    here, and the bubble can overlap the form's actions. */
const AUTH = ['/signin', '/signup', '/staff-login', '/staff-invite'];

const matches = (path, routes) =>
  routes.some((r) => (r === '/' ? path === '/' : path.startsWith(r)));

export function chromeFor(pathname) {
  const path = (pathname || '/').toLowerCase();

  const fullBleed = matches(path, FULL_BLEED);
  const chatRoute = matches(path, CHAT);
  const authRoute = matches(path, AUTH);

  return {
    selfPadded: matches(path, SELF_PADDED),
    fullBleed,
    chatRoute,
    authRoute,
    /* Reels keeps the tab bar despite being full-bleed: it is one of the five tabs,
       so removing it would strand the user with no route to the other four. */
    showBottomNav: !chatRoute && !authRoute,
    showFooter: !fullBleed,
    showAssistant: !fullBleed,
  };
}

/* hideAfter: only hide once the user is genuinely reading. delta: require a real move in one direction,
   so scroll jitter and rubber-band overscroll cannot flicker the bar. */
export const TOPBAR_SCROLL = { hideAfter: 96, delta: 6 };
