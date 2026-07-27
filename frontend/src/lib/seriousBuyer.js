/* B3 (ADR-019): a "Serious Buyer" is a seeker who has earned the Verified badge. Owners see
   this on incoming enquiries so verification pays off for buyers too (2× faster responses).

   In the localStorage-mock phase we don't have a per-enquirer KYC store — only the current
   user's own badge. So for OTHER people's enquiries we stand in a deterministic mock derived
   from their mobile (stable across renders, ~half flagged) purely so the badge is demoable.
   When the backend lands, replace `isSeriousBuyer` with the real per-user verified flag on the
   enquiry payload — every call site stays the same. */
export function isSeriousBuyer(mobile) {
  const d = String(mobile || '').replace(/\D/g, '');
  if (d.length < 4) return false;
  // Deterministic mock: last two digits divisible by 3 → ~1 in 3 enquirers verified.
  return Number(d.slice(-2)) % 3 === 0;
}
