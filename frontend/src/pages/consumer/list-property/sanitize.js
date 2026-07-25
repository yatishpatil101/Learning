/* ---------- input sanitizers ----------
   Keep form state free of garbage at the source. Every raw <input> that takes
   a number or free text runs its keystrokes through one of these, so the stored
   value is always clean regardless of paste, IME, or spinner tricks
   (no letters, no "e"/"+"/"-", no leading spaces, no control characters). */

/* Whole numbers only — counts like parking bays or CAM charges. */
export const toDigits = (v) => String(v ?? '').replace(/\D/g, '');

/* Positive decimals — areas and plot dimensions. Keeps the first dot, drops the
   rest, and strips every non-numeric character (so "-12e3" becomes "123"). */
export const toDecimal = (v) => {
  const cleaned = String(v ?? '').replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
};

/* Free text — strips control characters and any leading whitespace so a field
   can never hold a whitespace-only or newline-padded "value". Internal spaces
   between words are preserved; trailing space is trimmed at validation. */
export const cleanText = (v) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/^\s+/, '');
