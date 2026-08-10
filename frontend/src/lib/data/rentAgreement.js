/* Rent agreement data helpers (mirrors the HTML's localStorage keys) */

import { rawDb, mutateDb } from '../mockApi.js';

const digits = (s) => String(s || '').replace(/\D/g, '');

// Owner KYC profile key (mirrors auth.js ownerKycKey)
const ownerKycKey = (mobile) => 'puneNestOwnerKYC:' + (digits(mobile) || 'anon');

/*
   The two fields that must never live in this record.

   This key is plain JSON on `localStorage`, keyed by mobile number and never expired: any XSS on
   this origin reads it, and so does the next person to use a shared, borrowed or resold device. A
   PAN plus an Aadhaar plus a name and a permanent address is a complete identity set, and Aadhaar
   in particular is not ours to retain at all (Aadhaar Act s.29).

   They are stripped on the way in *and* on the way out. Stripping on write alone would leave every
   owner who used the rent-agreement wizard before this change carrying both numbers in their
   browser forever, since nothing else revisits the key — so a read purges what it finds, which is
   the only moment the app is guaranteed to touch an existing record.

   If retention is ever wanted back it belongs behind the access-controlled vault
   (`/me/owner-kyc`), not here. Do not reintroduce them to restore a prefill.
*/
const IDENTITY_FIELDS = ['pan', 'aadhaar'];

const withoutIdentityNumbers = (kyc) => {
  const clean = { ...kyc };
  IDENTITY_FIELDS.forEach((f) => delete clean[f]);
  return clean;
};

// Get owner KYC — purging any identity numbers a pre-fix version of the app left behind.
export const getOwnerKYC = (mobile) => {
  try {
    const k = ownerKycKey(mobile);
    const v = localStorage.getItem(k);
    if (!v) return null;
    const kyc = JSON.parse(v);
    if (!kyc || typeof kyc !== 'object') return null;
    if (!IDENTITY_FIELDS.some((f) => f in kyc)) return kyc;
    const clean = withoutIdentityNumbers(kyc);
    try { localStorage.setItem(k, JSON.stringify(clean)); } catch { /* quota — the caller still only sees the cleaned copy */ }
    return clean;
  } catch {
    return null;
  }
};

// Save owner KYC (identity numbers dropped — see above).
export const saveOwnerKYC = (kyc, mobile) => {
  try {
    const k = ownerKycKey(mobile);
    localStorage.setItem(k, JSON.stringify({ ...withoutIdentityNumbers(kyc), at: Date.now() }));
  } catch {
    /* quota */
  }
};

// Rent agreements list key
const raKey = (mobile) => 'puneNestRentAgreements:' + (digits(mobile) || 'anon');

// Get rent agreements for a user
export const getRentAgreements = (mobile) => {
  try {
    const k = raKey(mobile);
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : [];
  } catch {
    return [];
  }
};

// Add a rent agreement
export const addRentAgreement = (mobile, ra) => {
  try {
    const arr = getRentAgreements(mobile);
    arr.unshift({ ...ra, id: 'ra' + Date.now(), at: Date.now() });
    localStorage.setItem(raKey(mobile), JSON.stringify(arr));
  } catch {
    /* quota */
  }
};