/* Single control point for the app's two navigation bars.

   The chrome is split across three components by necessity — Navbar renders the top
   bar, BottomNav the tab bar, ConsumerLayout decides what mounts — but the *policy*
   should not be. Before this module, "does /reels get a tab bar?" was answered by a
   boolean expression inside ConsumerLayout's JSX, "when does the top bar hide?" by
   two constants inside a useEffect in Navbar, and neither knew the other existed.
   Changing a route's chrome meant finding all of them.

   Division of labour, so this file does not quietly become a second stylesheet:

     - Dimensions and appearance live in styles/index.css, under the chrome-token
       block: --pn-nav-h, --pn-bottom-nav-h, --pn-bottom-nav-gap and the insets
       derived from them, plus the z-index ladder. CSS owns anything a media query
       needs to change per breakpoint, because JS cannot see breakpoints without
       re-implementing them.
     - Behaviour lives here: which bar appears on which route, and the scroll
       thresholds that hide the top bar.

   Both bars are responsive by CSS, not by JS: BottomNav is `lg:hidden` and every
   hide-on-scroll rule sits inside a `max-width` query. So the policy below is
   width-agnostic on purpose — it says *whether* a bar is mounted, and the stylesheet
   says how it behaves at a given width. Adding a width test here would put the
   breakpoint in two places, which is the bug this module exists to prevent. */

/** Routes that render their own top offset for the fixed navbar, so ConsumerLayout
    must not add a second one. Each reserves --pn-nav-h itself. */
const SELF_PADDED = ['/', '/listings', '/property', '/signin', '/signup'];

/** Full-screen experiences: no marketing footer, no floating assistant. */
const FULL_BLEED = ['/reels'];

/** App-native chat. Goes full-screen below md and pins its composer to the viewport
    bottom, so a tab bar would fight it for the same edge. */
const CHAT = ['/messages'];

/** Focused conversion funnels. The long footer and the assistant bubble are noise
    here, and the bubble can overlap the form's actions. */
const AUTH = ['/signin', '/signup', '/staff-login'];

const matches = (path, routes) =>
  routes.some((r) => (r === '/' ? path === '/' : path.startsWith(r)));

/**
 * Resolve the chrome policy for a pathname. One call, one object, so a component
 * never re-derives a flag another component already owns.
 *
 * @param {string} pathname
 */
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
       so stripping the bar stranded the user inside a destination with no route back
       to the other four. Only the two routes that need the bottom edge lose it. */
    showBottomNav: !chatRoute && !authRoute,
    showFooter: !fullBleed,
    showAssistant: !fullBleed,
  };
}

/* Hide-on-scroll thresholds for the top bar.

   hideAfter  Only start hiding once the user is genuinely reading, rather than on
              the first pixel of an accidental scroll.
   delta      Require a real move in one direction, so scroll jitter and rubber-band
              overscroll cannot make the bar flicker. */
export const TOPBAR_SCROLL = { hideAfter: 96, delta: 6 };
