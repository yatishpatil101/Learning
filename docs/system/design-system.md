# PuneNest Design System

## Control Sizing Scale

All interactive controls share a **single height: 40px** for visual rhythm and consistency.

### CSS Tokens (defined in `:root` of `src/styles/index.css`)

```css
--control-h: 40px;              /* Universal control height */
--control-font: 0.875rem;       /* 14px (text-sm) */
--control-weight: 400;          /* Regular for inputs/dropdowns */
--control-weight-action: 600;   /* Semibold for action buttons */
--control-radius: 9999px;       /* Fully rounded (pill shape) */
--control-px: 1rem;             /* 16px horizontal padding */
--control-border: 1px solid rgba(255, 255, 255, 0.1);
--control-bg: rgba(255, 255, 255, 0.05);
--control-bg-hover: rgba(255, 255, 255, 0.08);
--control-bg-active: rgba(20, 184, 166, 0.15);
--control-border-active: #14b8a6;
--control-text: #e5e7eb;        /* Selected value text */
--control-placeholder: #9ca3af; /* Placeholder text */
```

### Element Heights

| Element | Height | Class/Token | Example |
|---------|--------|-------------|---------|
| Dropdown trigger | 40px | `.pn-dropdown__trigger` | "Any locality" pill |
| Dropdown option | 40px | `.pn-dropdown__option` | Menu item row |
| Filter pill | 40px | `.seg` or `.pn-control` | "Everyone", "Women", "Verified only" |
| Search input | 40px | `py-[9px]` in `rounded-full` | Smart search bar |
| CTA button | 40px | `.pn-control--action` or `h-10` | "List your room", "Create group" |
| Ghost button | 40px | `.pn-control--ghost` | "Reset" button |
| Navbar pills | 40px | `px-5 py-2.5 rounded-full` | "Post Property", "Sign In" |
| Range slider wrap | 40px | `h-10 flex items-center` | Budget slider in pill |

### Utility Classes

```css
.pn-control         — Base control (40px, pill, bg, border)
.pn-control.active  — Active/selected state (teal bg + border)
.pn-control--action — Primary CTA (teal gradient, semibold, white text)
.pn-control--ghost  — Ghost/outline button (transparent bg, muted text)
.seg                — Legacy alias (same height/border, add your own padding/text via Tailwind)
.seg.active         — Legacy active state
```

### Usage in JSX

```jsx
// Filter pill (toggleable)
<button className="pn-control px-4 text-sm font-semibold">Everyone</button>

// Active filter pill
<button className="pn-control active px-4 text-sm font-semibold">Women</button>

// CTA button
<button className="pn-control pn-control--action px-5 text-sm font-semibold gap-2">
  <Icon name="plus" className="w-4 h-4" /> Create group
</button>

// Ghost button
<button className="pn-control pn-control--ghost px-4 text-sm gap-1.5">
  <Icon name="rotate-ccw" className="w-3.5 h-3.5" /> Reset
</button>

// Dropdown (automatic via NativeSelect/Select component)
<NativeSelect className="...">...</NativeSelect>
// Trigger automatically gets 40px from --dd-trigger-height: var(--control-h)
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
| Controls (pills, dropdowns, inputs) | `9999px` (fully rounded) | `--control-radius` |
| Cards | `1rem` (16px) | `rounded-2xl` |
| Dropdown menu | `1rem` | `--dd-menu-radius` |
| Menu options | `0.6rem` | `--dd-option-radius` |

### When NOT to use 40px

- **Tab navigation** (Flatmates/Rooms/Groups): These are page-level navigation, not filters. They use `py-2.5 px-4 rounded-xl` (~40-42px) which is intentionally slightly different to distinguish from filter controls.
- **Hero CTA** ("Post a request"): Uses `py-3 px-5 rounded-xl` (44px) — larger to draw attention.
- **Modal buttons**: Follow standard button sizing in the modal footer.

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
- [ ] Every interactive control keeps the 40px height (`--control-h`).
- [ ] Grid-paired controls share the row evenly (`sm:grid-cols-2`), no lone stretched cell.

---

## How to Apply to a New Page

1. Use `<NativeSelect>` or `<Select>` for dropdowns — they automatically get 40px height
2. Use the `seg()` helper or `.pn-control` class for filter pills
3. Use `h-10 rounded-full` + `text-sm font-semibold` for CTAs
4. Use `field rounded-full py-[9px] text-sm` for search/text inputs
5. Wrap sliders in `h-10 flex items-center rounded-full bg-white/5 border border-white/10 px-4`
