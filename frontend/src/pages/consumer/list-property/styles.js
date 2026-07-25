/* ---------- shared class-string helpers ---------- */
export const fld = 'form-input w-full px-4 py-3.5 rounded-xl text-white text-sm';
export const lbl = 'block text-sm font-medium text-gray-300 mb-2';
export const lbl3 = 'block text-sm font-medium text-gray-300 mb-3';

/* A standalone dropdown (one that doesn't share a grid row) shouldn't stretch
   the full form width — a short option list reads as a control, not a page-wide
   bar. Cap it to roughly a half-row on desktop while staying full-width on
   mobile for easy tapping. Grid-paired dropdowns keep w-full to fill their cell. */
export const ddSolo = 'sm:max-w-xs';
