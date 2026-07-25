/* Rent agreement data helpers (mirrors the HTML's localStorage keys) */

import { rawDb, mutateDb } from '../mockApi.js';

const digits = (s) => String(s || '').replace(/\D/g, '');

// Owner KYC profile key (mirrors auth.js ownerKycKey)
const ownerKycKey = (mobile) => 'puneNestOwnerKYC:' + (digits(mobile) || 'anon');

// Get owner KYC
export const getOwnerKYC = (mobile) => {
  try {
    const k = ownerKycKey(mobile);
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
};

// Save owner KYC
export const saveOwnerKYC = (kyc, mobile) => {
  try {
    const k = ownerKycKey(mobile);
    localStorage.setItem(k, JSON.stringify({ ...kyc, at: Date.now() }));
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