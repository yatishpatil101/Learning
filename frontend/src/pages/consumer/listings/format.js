// fmtMoney alias removed — using fmtINR directly
export const fmtRent = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN');
// The filter slider's own bounds, which are a sq.ft. scale by construction. Named for that, so an
// auto-import cannot put it where `lib/format.js`'s unit-aware `fmtArea` belongs.
export const fmtAreaSqft = (n) => (Number(n) || 0).toLocaleString('en-IN') + ' sq.ft';
