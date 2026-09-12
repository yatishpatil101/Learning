/* The Draazy brand mark — an OUTLINED rounded "D" with a door panel standing open
 * inside its counter.
 *
 * This replaced an earlier mark that was a SOLID D with the door cut into the stem:
 * a 2.4-unit gap split the stem into a jamb and a leaf. That drawing was correct at
 * 64px and illegible below 36px. The stem is 11 units, so it had to carry jamb + gap
 * + leaf out of a 5.5px budget at 32px — the gap landed at 1.2px, under the ~1.5px
 * floor where a feature stops resolving, and the mark collapsed into a plain "D".
 * The current construction fixes that by accident rather than by compromise: the
 * door now floats in the COUNTER, which is 35 units wide, so every element has room.
 *
 * Construction (64x64 grid, art box x 12..56, y 8..56 — the same box
 * e2e/scripts/gen-app-icons.mjs centres its tiles on):
 *
 *   - profile  = a rounded-D drawn as an OUTLINE, not a solid letter. Two subpaths
 *                in one <path>, knocked out by fill-rule=evenodd:
 *                  outer — left edge x=12 with r5 corners top and bottom, flat top
 *                          and bottom runs to x=32, then ONE continuous r24 arc down
 *                          the whole right side. A true semicircle: its 48-unit
 *                          chord is the full cap height, so there is no flat segment
 *                          mid-edge. That flat run is what made an earlier draft read
 *                          as a rounded rectangle rather than a letter.
 *                  inner — the same construction offset inward by the 4.5-unit
 *                          stroke: x 16.5..51.5, y 12.5..51.5, bowl r19.5, corner r1.
 *
 *   - door     = a trapezoid floating clear of the inner wall, hinged on the LEFT.
 *                Visible edges: hinge 31.5 units, free edge 20.1, both centred on
 *                y=32 (the counter's true middle). That 11.4-unit difference is a
 *                steep foreshortening, and it is the whole perspective cue — it
 *                reads as "swung open". Because the free edge is the SHORTER one
 *                the door opens inward, drawing the eye into the counter.
 *
 * The door is drawn inset by 2 and then stroked at 4 with a round line join. That
 * is an exact way to round the corners of a trapezoid — offsetting four
 * non-perpendicular corners by hand needs trigonometry and lands on numbers nobody
 * can later verify, whereas a round join is correct by construction.
 *
 * The consequence to remember when editing: the `d` below is the INSET outline, so
 * its numbers are NOT the visible edges. The visible trapezoid is this path pushed
 * outward by 2 along each edge normal — x 21.2..32.7, hinge y 16.23..47.77, free
 * edge y 21.93..42.07. Resize by picking the visible shape first and re-deriving
 * the inset; scaling these numbers directly changes the corner radius too and
 * silently distorts the proportions.
 *
 * No <mask> and no useId(). The previous mark needed both to cut its door gap out of
 * the stem without painting it in a page colour. A counter is knocked out by
 * fill-rule instead, so there is no per-instance state and nothing that can collide
 * when the navbar, the footer and the install prompt render at the same time.
 *
 * Colour comes from `currentColor`, so one asset serves teal-on-dark,
 * charcoal-on-light, black-on-white and white-on-teal unchanged.
 *
 * Mirrored in three other places — frontend/index.html (inline favicon),
 * e2e/scripts/gen-app-icons.mjs (PWA PNGs) and frontend/scripts/logo-preview.html.
 * If you change one, change all four.
 */
export default function LogoMark({ className = '', title }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      // Decorative by default: every call site already sits inside a link or
      // heading that carries the accessible name, so announcing the mark too
      // would double up. Pass `title` only where the mark stands alone.
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      aria-label={title || undefined}
      focusable="false"
    >
      {/* Rounded-D profile. Outer contour then counter, knocked out by evenodd. */}
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M17 8 H32 A24 24 0 0 1 32 56 H17 A5 5 0 0 1 12 51 V13 A5 5 0 0 1 17 8 Z
           M17.5 12.5 H32 A19.5 19.5 0 0 1 32 51.5 H17.5 A1 1 0 0 1 16.5 50.5 V13.5 A1 1 0 0 1 17.5 12.5 Z"
      />
      {/* The door. Inset by 2 and stroked at 4 to round its corners — see above:
          these are not the visible edges. */}
      <path
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
        d="M23.2 19.45 L30.7 23.17 V40.83 L23.2 44.55 Z"
      />
    </svg>
  );
}
