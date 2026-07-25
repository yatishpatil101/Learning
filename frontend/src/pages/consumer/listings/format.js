// fmtMoney alias removed — using fmtINR directly
export const fmtRent = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN');
export const fmtArea = (n) => (Number(n) || 0).toLocaleString('en-IN') + ' sq.ft';
