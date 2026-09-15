/* ---------- shared class-string helpers ---------- */
export const fld = 'form-input w-full px-4 py-3.5 rounded-xl text-white text-sm';
export const lbl = 'block text-sm font-medium text-gray-300 mb-2';
export const lbl3 = 'block text-sm font-medium text-gray-300 mb-3';

/* A standalone dropdown (one that doesn't share a grid row) shouldn't stretch
   the full form width — a short option list reads as a control, not a page-wide
   bar. Cap it to roughly a half-row on desktop while staying full-width on
   mobile for easy tapping. Grid-paired dropdowns keep w-full to fill their cell. */
export const ddSolo = 'sm:max-w-xs';

/* The unit that trails a measurement input. Plain text rather than a chip: a boxed
   suffix reads as a second control inside the field, and on a 390px screen the box
   plus its reserved gutter clipped the placeholder it sat next to. Each input pairs
   this with a right padding sized to its own longest unit. */
export const unitSuffix = 'absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs font-medium';

