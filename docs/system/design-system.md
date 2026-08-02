# PuneNest Design System

## Control Sizing Scale

All interactive controls share **one height token, `--control-h`** — 40px on desktop and **44px
below 640px**. The mobile value is not decoration: 40px fails the WCAG 2.5.8 / platform 44px touch
floor, and ramping the variable fixes every dropdown trigger, dropdown option and shared field height
at once instead of per component. Quote sizes as **tokens**, never as literals.

### CSS Tokens (defined in `:root` of `src/styles/index.css`)

```css
--control-h: 40px;              /* Universal control height (44px below 640px) */
--control-font: 0.875rem;       /* 14px (text-sm) */
--control-weight: 400;          /* Regular for inputs/dropdowns */
--control-weight-action: 600;   /* Semibold for action buttons */
--control-radius: 10px;         /* Rounded square — the default for controls */
--control-radius-pill: 9999px;  /* Pill — hero search tabs, locality chips, BHK pills only */
--control-px: 1rem;             /* 16px horizontal padding */
--control-border: 1px solid rgba(255, 255, 255, 0.1);
--control-bg: rgba(255, 255, 255, 0.05);
--control-bg-hover: rgba(255, 255, 255, 0.08);
--control-bg-active: rgba(20, 184, 166, 0.15);
--control-border-active: #14b8a6;
--control-text: #e5e7eb;        /* Selected value text */
--control-placeholder: #9ca3af; /* Placeholder text */

/* Buttons — three tiers, three sizes */
--btn-h: 40px;                  /* default (44px below 640px) */
--btn-h-sm: 32px;               /* .btn-sm (36px below 640px) */
--btn-h-lg: 48px;               /* .btn-lg */
--btn-radius, --btn-primary-grad, --btn-primary-shadow;
```

### Element Heights

Everything below derives from `--control-h` / `--btn-h`, so all of them are 40px on desktop and
44px below 640px unless stated otherwise.

| Element | Height | Class/Token | Example |
|---------|--------|-------------|---------|
| Dropdown trigger | `--control-h` | `.pn-dropdown__trigger` | "Any locality" pill |
| Dropdown option | `--control-h` | `.pn-dropdown__option` | Menu item row |
| Filter pill | `--control-h` | `.seg` or `.pn-control` | "Everyone", "Women", "Verified only" |
| Text / search input | `--control-h` | `.pn-input`, `input.form-input` | Smart search bar |
| Button (default) | `--btn-h` | `.btn` / `<Button>` | "Post", "Save search" |
| Button (small / large) | `--btn-h-sm` / `--btn-h-lg` | `.btn-sm` / `.btn-lg` | Inline action / hero CTA |
| Navbar pills | `--pn-nav-pill-h` | `.pn-topbar__pill` + `.tap-extend` | "Post Property", "Sign In" |
| Range slider | grows on touch | `.rng-wrap` / `.rng` | Budget slider (thumb 16px -> 28px) |

### Utility Classes

```
Buttons (canonical — use <Button/> from components/ui/Button.jsx)
.btn                — base (height --btn-h, radius --btn-radius, semibold)
.btn-primary        — tier 1, teal gradient. One per view.
.btn-secondary      — tier 2, outline/ghost
.btn-icon           — tier 3, square icon-only (width = height)
.btn-sm / .btn-lg   — 32px / 48px (36px / 48px below 640px)
.btn-success / .btn-danger — colour modifiers on primary
.btn-teal / .btn-outline / .pn-btn* — legacy aliases, folded into the above

Non-button controls
.pn-control{,.active,--action,--ghost} — legacy control shell, still used in the dashboard
.seg / .seg.active  — toggle/filter pill shell (height + border only)
.pn-input           — single-line text input
```

The button system in `index.css` declares itself the single source of truth for buttons; `.pn-control*`
is now the minority pattern and should not be used in new code.

### Usage in JSX

```jsx
// Primary CTA — use the component, not the classes
<Button variant="primary" icon="plus" onClick={onPost}>Post</Button>

// Secondary
<Button variant="secondary" icon="shield-check" onClick={openVerify}>Get verified</Button>

// Icon-only — `aria-label` is mandatory (see "Icon-only controls")
<Button variant="icon" iconOnly icon="rotate-ccw" aria-label="Reset filters" />

// Toggle/filter pill
<button aria-pressed={on} className={'seg px-4 h-10 rounded-full text-sm font-semibold' + (on ? ' active' : '')}>Women</button>

// Dropdown (automatic via NativeSelect/Select component)
<NativeSelect className="...">...</NativeSelect>
// Trigger height comes from --dd-trigger-height: var(--control-h).
// Below 640px Select/MultiSelect stop writing inline anchor geometry and render as bottom sheets.
```

### Typography in Controls

| Context | Weight | Color |
|---------|--------|-------|
| Dropdown selected value | 400 (regular) | `--control-text` (#e5e7eb) |
| Dropdown placeholder | 400 (regular) | `--control-placeholder` (#9ca3af) |
| Filter pill label | 600 (semibold) | gray-300 default, #5eead4 when active |
| CTA button label | 600 (semibold) | white |
| Input text | 400 (regular) | white |
| Input placeholder | 400 (regular) | gray-500 |

### Spacing Rules

- Gap between inline controls: `gap-3` (12px) or `gap-2` (8px) for tight groups
- Filter section padding: `p-4 sm:p-5`
- Label above control: `text-xs font-medium text-gray-400 mb-1.5`
- Section spacing: `space-y-6` between major cards

### Border Radius

| Element | Radius | Token |
|---------|--------|-------|
| Controls (`.pn-control`, `.seg`, `.btn*`) | `10px` | `--control-radius` |
| Text inputs (`.pn-input`) | `0.75rem` | — (literal) |
| Dropdown trigger | `999px` (pill) | `--dd-trigger-radius` |
| Pill-only exceptions (search tabs, locality chips, BHK pills) | `9999px` | `--control-radius-pill` |
| Cards | `1rem` (16px) | `--radius` / `rounded-2xl` |
| Dropdown menu | `1.1rem` | `--dd-menu-radius` |
| Menu options | `0.8rem` | `--dd-option-radius` |
| Bottom sheets (top corners) | `1.25rem` | — (literal) |
| Badges | `6px` | — |

### When NOT to use the default height

- **Category tabs** (Flatmates "Move in now" / "Team up"): built on `.seg` with `py-2.5 rounded-xl`
  and `flex-1` below `sm`, so two tabs fill a 360px row. They carry a **rendered** count badge, not
  just an `aria-label` — stock a seeker cannot see is stock they never switch tabs for.
- **Prominent / hero CTAs:** use `size="lg"` (`--btn-h-lg`, 48px), never a hand-rolled `py-*`.
- **Compact inline actions:** `.btn-sm` (`--btn-h-sm`).
- Modal footers add `pb-[calc(0.75rem + var(--pn-safe-b))]` on mobile so the primary action clears
  the home indicator.


---

## Mobile-first system

The app is authored mobile-first. These are the rules the phone layout depends on; breaking one of
them usually breaks a different component than the one you edited.

### Bottom chrome: `--pn-bottom-inset` and the z-index ladder
Nothing bottom-anchored may hardcode a `bottom-*` value. `--pn-bottom-inset` reports how much of the
viewport bottom is already claimed by fixed chrome; `ConsumerLayout` sets `.has-bottom-nav` on routes
that mount the mobile tab bar, which expands the inset to
`--pn-bottom-nav-h + --pn-bottom-nav-gap + --pn-safe-b`. Above `lg` the variable collapses back to the
safe-area inset alone, so every `calc()` built on it resolves to the literal offset it had before the
system existed — desktop safety is structural, not a promise.

The ladder is written down once so bottom chrome never re-negotiates it:
**content 0-49 · sticky page CTA 60 · mobile bottom nav 70 · sheets 1000 · assistant 1300 ·
cookie consent 1400 · blocking modals 1500.**

A new `position: fixed` element must be checked against the existing bottom-chrome inventory (bottom
nav, assistant FAB, cookie bar, CityChrome, sticky CTA), not just against z-index — two floating
controls on the same corner intercept each other's taps.

### Top chrome: `--pn-nav-h`, `--pn-top-inset`, hide-on-scroll
`--pn-nav-h` is the only place the top bar's height is written down: the row, every page's top
padding, sticky sub-headers and full-height routes all derive from it (58px on phones, 72px from
768px up). `--pn-top-inset` is where a sticky sub-header docks; below `lg` the navbar slides away on
scroll-down (`.pn-nav-hidden` on `<html>`) and the inset drops to 0 so the sub-header rises to the
screen edge instead of leaving a hole. Opt a sub-header in with `.pn-docks-under-nav`. Every rule
that reacts to the class lives inside a `max-width: 1023.98px` block, so the class is inert on
desktop.

### Bottom sheets are the mobile overlay shape
Below 640px a centred dialog is the wrong shape: with the keyboard open the usable viewport is ~300px,
so a form modal's submit button leaves the screen. Every centred overlay therefore docks to the bottom
edge as a sheet — squared bottom corners, `1.25rem` top corners, `max-height` in `dvh`, a slide-in, a
36x4px grab handle, and bottom padding that adds `--pn-safe-b`. Four shells implement it and must not
diverge:

- `.pn-modal` / `.pn-modal-backdrop` — all legacy consumer overlays, converted by **one media query
  with zero markup edits**. Look for the shared class before editing a component.
- `.pn-modal-sheet` — the shared `<Modal>`.
- `.pn-dropdown__menu--sheet` + `.pn-dropdown__scrim` — `Select`/`MultiSelect` stop writing inline
  anchor geometry below `sm`.
- `.pn-action-sheet` — overflow menus.

`useSwipeDismiss` adds drag-to-dismiss; it arms only on the mobile media query, only inside the top
40px handle zone, and takes pointer capture on the first qualifying *move* — capturing on
`pointerdown` retargets the following click and breaks every button in the panel.

### Touch-target floor: `.tap-target` vs `.tap-extend`
Two classes, one rule (WCAG 2.5.8 / 44px). `.tap-target` grows the box
(`min-width`/`min-height: 44px`) and is for icon-only controls whose box is invisible chrome anyway.
`.tap-extend` keeps the drawn size and lays a transparent 44px `::before` under the finger — use it
wherever the *drawn* size is load-bearing (a close pill on a small bubble; the top-bar pills, which
drop to `--pn-nav-pill-h` / `--pn-nav-icon-box` below `sm` so four painted 44px boxes don't overflow a
360px bar). **Never pair the two on one element:** they set the same property and `.tap-target` is
declared later, so pairing silently reinstates the 44px box. A 32px box plus the row's 12px gap puts
adjacent centres exactly 44px apart — do not shrink the gap without shrinking the target.

### Icon-only controls must carry a real accessible name
`title=` is **not** a label on touch — it never surfaces on a phone, so an icon-only control named
only by `title` is unnamed. Every icon-only button takes `aria-label`, and toggles take
`aria-pressed`. Where a visible label is dropped for space (bottom-nav tabs in landscape), the
`aria-label` is set unconditionally so hiding the text costs a screen reader nothing. Grep for
`title=` on icon-only buttons during any mobile pass.

### Hover is not an affordance
Nothing may be reachable only via `:hover`; on a touch screen that state never fires and the content
is simply invisible. Mark any hover-revealed layer `.reveal-on-hover` and it becomes permanently
visible under `@media (hover: none)` — keyed on the *capability*, not the viewport, so touch laptops
are covered and mouse desktops keep the animation. The same block removes the browser's blue tap
flash and replaces it with an `:active` opacity dip: removing one without the other makes taps feel
broken.

### Sticky action rows (`position: sticky`, not `fixed`)
In-flow action rows use `sticky`: the row keeps its place in the flow, so it reserves its own space
and can never cover the last field — no per-step `padding-bottom` bookkeeping. Three consumers:
`.lp-step-actions` (listing wizard, below `lg`, primary flexed 1.6x so the target is unambiguous
under a thumb), `.pn-auth-submit` (sign-in/sign-up, where the keyboard would otherwise push the
primary action below the fold), and `.pn-sticky-cta`, which is genuinely `fixed` and docks at
`--pn-bottom-inset`.

### Mobile bottom nav + the floating-glass material
The primary wayfinding surface on phones is a floating capsule, not an edge-to-edge bar: an
edge-to-edge bar reads as a wall, a detached capsule reads as a control sitting on the page. The
material is one blur + one saturation boost + a light inset top edge, tinted with the app's own
indigo/teal — `saturate()` is what stops the blur turning the brand teal into grey mud. Alphas are set
by the worst case (near-white gallery imagery behind the bar), not the pretty one. Both users of the
material (`.pn-bottom-nav`, `.filter-fab`) share the same `left` inset so they sit on one vertical
edge, and both carry an opaque `@supports not (backdrop-filter)` fallback for Firefox Android and old
WebViews. Height is owned by `--pn-bottom-nav-h` **only** — an inline `style` on the element would
desync every widget that positions against `--pn-bottom-inset`.

### Landscape phones are a height budget, not a width one
A rotated handset is ~915x412, so a `min-width: 768px` breakpoint cannot tell it from a tablet and was
serving it desktop chrome on a 412px-tall screen. When a rule is really about available *height*, key
it off height and orientation. The landscape block is guarded three ways — `orientation: landscape`
**and** `max-height: 500px` **and** `max-width: 1023.98px` — so a 1440x900 desktop and a 1024x768
landscape tablet both fail it structurally. Inside it `--pn-nav-h` drops to 47px,
`--pn-bottom-nav-h` to 44px, and tab labels are hidden (the `aria-label` keeps the tab named).

### Safe areas and `dvh`
`viewport-fit=cover` is set on the document — the only thing that makes `env(safe-area-inset-*)`
resolve to real values. Bottom insets flow through `--pn-safe-b`, never through raw `env()` at call
sites. Horizontal insets are handled by `.pn-safe-x` (positioning, not padding, so the element's own
padding utilities survive); `env()` is `0px` everywhere else including desktop, so the class is inert
off-device.

Every viewport-height constraint uses **`dvh`**, so the mobile URL bar collapsing does not resize the
layout: dropdown/action sheets cap at `70dvh`, modals at `88dvh`, the app shell is `min-h-[100dvh]`.
Do not introduce `vh`.

### Responsive dual-render (mobile card / desktop table)
Data tables render twice: a stacked card list at `sm:hidden` and the real `<table>` at
`hidden sm:block`. `Table` takes an optional `mobileCard(row)` renderer and only splits when one is
supplied, so a table without one is unchanged. **Both copies exist in the DOM at all times** — any
assertion or query selector must scope to the visible copy (`getByRole('table')`, `:visible`), or it
hits the hidden one first.

### Mobile vertical rhythm and type
- The page rhythm was authored for a 1440px canvas, where 40px between sections reads as air; on a
  412px screen it is most of a fold. Two knobs, not per-component tuning: `--section-gap` (already
  behind every `.section-y/-pt/-pb/-mb`) drops to `1.75rem` below `sm`, and `--section-head-gap`
  standardises the gap under a section heading.
- `.consumer-main` headings scale down exactly 20% below 640px, scoped to `h1/h2/h3` so numeric price
  and stat spans reusing the same `text-*` utilities keep their emphasis.
- **Never let an editable field's font-size fall below 16px on touch.** Touch browsers zoom into any
  field under 16px on focus, forcing the user to pinch back out; our controls run 13-14px, so every
  `input`/`select`/`textarea` is lifted to `16px !important` under `pointer: coarse`. The
  `!important` is required to beat class-scoped rules.
- A `px` font-size is not "safe" from dynamic type — it *is* the accessibility failure. Labels that
  must scale are authored in `rem` with an overflow guard, and never with `leading-none` (line-height
  1 is shorter than ascent+descent and clips glyphs).

### Reduced motion is a first-class state
Decorative motion is cut under `prefers-reduced-motion: reduce`, and the app additionally honours a
user-toggled "Reduce motion" setting mirroring the OS one. What survives is the half that carries
information: the bottom-nav indicator keeps its opacity fade but loses its travel; the filter FAB
keeps its shadow drop but loses the press scale; sheets keep a short opacity transition instead of the
slide. When cutting motion, ask which half of the effect reports state.

### Devanagari / i18n typography
`--font-sans` lists `'Noto Sans Devanagari'` **after** `Outfit`, not instead of it: the browser falls
through per character, so Latin still renders in Outfit and only Devanagari codepoints reach Noto.
Putting Noto first would restyle the entire English site. Devanagari runs 15-30% longer than the same
English sentence and its taller line box changes how clamped text counts lines — budget for both when
sizing a button or a truncated row.

### Route-scoped stylesheets
Large per-route CSS is split out of `index.css` and ships with its route chunk instead of blocking
first paint everywhere: `styles/routes/{messages,reels,flatmates,rent-agreement,property-map,compare,services-hub}.css`.
`index.css` keeps a one-line pointer at each extraction site. New route-only styling belongs in a
route file, not in `index.css`.

### Shared primitives inventory
Reach for these before hand-rolling (`src/components/ui/`): `Button` (3 tiers, 3 sizes, `to`/`as`
polymorphism), `Modal` (portal, focus trap, stacked-dialog-aware Escape, sheet on mobile), `Table`
(pagination, selection, optional `mobileCard`), `Select` / `MultiSelect` / `NativeSelect` /
`LocalitySelect`, `DateField` / `TimeField` / `DatePickerDialog` / `TimePickerDialog` (all bottom
sheets on phones), `Menu` (action sheet on phones), `MobileCollapse` (collapsed below `lg`, always
open above — an overlay toggle, so existing heading markup is untouched), `HScroll` (horizontal rail
with edge fades; its arrow buttons are 36px and are *removed* under `pointer: coarse` rather than
grown), `Tabs`, `Switch`, `Badge`, `Tip`, `FieldError`, `DualRange`, `Stat`, `PageHeader`,
`PoweredByGoogle`.

---

## Control Width

A control's width should reflect the content it holds, not the width of the page.
A dropdown or text input that stretches edge-to-edge for a handful of short
options reads as a page-wide bar and makes the form feel unfinished.

**Rule:** dropdowns and short inputs must not span the full form width on desktop.

- **Grid-paired controls** — keep `w-full` so they fill their grid cell. Two
  half-width controls sharing a row (e.g. Facing + Age, Property Type + BHK) is
  the preferred layout: it fills the row without any single control stretching.
- **Standalone controls** — a control that is the only field in its row must be
  capped. In the Post-a-property flow use the `ddSolo` token
  (`sm:max-w-xs`, from `list-property/styles.js`); elsewhere apply an equivalent
  `sm:max-w-xs`/`sm:max-w-sm` cap. It stays full-width on mobile for easy tapping
  and caps to ~half a row on desktop.
- **Wide-content controls** — a searchable locality list or a free-text address
  legitimately needs more room; let those fill their cell. The cap is for short,
  fixed option sets (zone, water source, unit, tenure).

```jsx
// ✅ Standalone dropdown — capped so it doesn't span the page
<Select className={ddSolo} value={form.waterSource} onChange={...} options={waterSourceOptions} />

// ✅ Paired dropdowns — each fills half the row
<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
  <Select value={form.facing} ... />
  <Select value={form.age} ... />
</div>

// ❌ Standalone dropdown left full-width for a short option list
<Select value={form.waterSource} ... />
```

### Design validation checklist

Before shipping a form, confirm:

- [ ] No dropdown with a short, fixed option set spans the full form width on desktop.
- [ ] Standalone dropdowns/inputs are capped (`ddSolo` / `sm:max-w-xs`) or paired into a grid row.
- [ ] Every interactive control derives its height from a token (`--control-h`, `--btn-h`,
      `--btn-h-sm`, `--btn-h-lg`) — never a literal `h-*`.
- [ ] No control drops below 44px at <640px; verify at **360px**, not just at desktop width.
- [ ] Grid-paired controls share the row evenly (`sm:grid-cols-2`), no lone stretched cell.
- [ ] Every icon-only control has an `aria-label` (a `title` is not a label on touch).
- [ ] Nothing bottom-anchored hardcodes a `bottom-*` value — it docks at `--pn-bottom-inset` and was
      checked against the existing bottom-chrome inventory.
- [ ] Any new overlay uses one of the four sheet shells rather than a fifth.
- [ ] No `vh` — viewport heights are `dvh`.

---

## How to Apply to a New Page

1. Use `<Button>` for every button; pick the tier (`primary` / `secondary` / `icon`) and, if needed,
   the size (`sm` / `lg`). Do not hand-roll `py-*` heights.
2. Use `<NativeSelect>` or `<Select>` for dropdowns — they take their height from `--control-h` and
   become bottom sheets below 640px automatically.
3. Use the `seg()` helper or `.seg` for toggle/filter pills.
4. Use `.pn-input` or `input.form-input` for text/search inputs — both take their height from
   `--control-h`. Do not hand-tune vertical padding (`py-[9px]`); it desyncs from the mobile 44px ramp.
5. Wrap sliders in `.rng-wrap` / `.rng` rather than a bare `h-10` row. On `pointer: coarse` the thumb
   grows 16px -> 28px and the row grows with it, so a fixed `h-10` wrapper clips it.
6. Put route-only CSS in `styles/routes/<route>.css`, not in `index.css`.
7. Verify at 360px wide **and** in landscape (~915x412) before calling it done.
