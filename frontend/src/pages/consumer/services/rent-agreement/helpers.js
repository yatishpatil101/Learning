// Helper to read a file as dataURL
export const readFileAsDataURL = (file) => {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }
    if (file.size > 2 * 1024 * 1024) { resolve({ fileName: file.name, tooLarge: true, mime: file.type, size: file.size }); return; }
    const reader = new FileReader();
    reader.onload = () => resolve({ fileName: file.name, dataUrl: reader.result, mime: file.type, size: file.size });
    reader.onerror = () => resolve({ fileName: file.name, dataUrl: '', mime: file.type, size: file.size });
    reader.readAsDataURL(file);
  });
};

export const fmt = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
export const digits = (s) => String(s || '').replace(/\D/g, '');
export const num = (s) => parseInt(digits(s), 10) || 0;

/*
   Blank-state factories for each slice of the wizard.

   Factories, not shared constants, so no two pieces of state can ever alias the same object. They
   live here because each shape is needed in two places — the `useState` initialiser and the
   "start a new agreement" reset — and when those were two copies of the same literal, adding a
   field to one and not the other left the reset carrying stale data from the previous agreement.
   For a form that ends in a payment and a legal document, that is not a cosmetic bug.
*/
/*
   ── The size the wizard's `details` payload has to fit in (D157) ──

   The server bounds `service_requests.details` at `ServiceRequestService.DETAILS_MAX_CHARS`,
   measured on the *serialized JSON* — `objectMapper.writeValueAsString(details).length()`, i.e.
   characters, not bytes. Devanagari sits in the BMP, so a Marathi address costs exactly what an
   English one of the same length costs against this limit even though it is three times the bytes
   on disk; there is nothing to compensate for here, and any attempt to would be wrong.

   `JSON.stringify` produces the same character count as Jackson for this payload: both emit
   non-ASCII literally rather than as `\uXXXX` escapes, and neither writes whitespace.

   **This number must track the server's.** It is duplicated because the alternative is discovering
   the limit as a 400 at the end of a six-step form, which is the whole defect. If the server's cap
   changes, change this with it — a client that believes in a larger cap than the server enforces is
   worse than no guard at all, because it promises the submit will work.

   16000 is measured, not guessed: the worst *realistic* state — four tenants, a 2000-character
   clauses field, 300-character addresses, a full furniture list — serializes to 7875 characters, so
   the old 8000 left 125 characters of headroom and D157 was not theoretical. Each extra tenant costs
   ~645 characters. The ceiling is twice the worst realistic case and clears the pathological one.
*/
export const DETAILS_MAX_CHARS = 16000;

/**
 * Serialized size of the `details` payload, in the characters the server counts.
 *
 * Returns `0` for anything that will not serialize: an unserializable payload is a different
 * failure (the server answers "details must be a serializable object") and reporting it as
 * "too long" would send the customer to shorten a field that is not the problem.
 */
export const detailsChars = (details) => {
  try {
    return JSON.stringify(details).length;
  } catch {
    return 0;
  }
};

/*
   Where the free text lives, and what to call it when it is the one that has to be shortened.

   Ordered by how much a customer can plausibly put in each, longest first, because ties go to the
   first match and the clauses box is the only genuinely unbounded field on the form. Reuses the
   labels the fields already carry, so the warning names the control the customer is looking at
   rather than a state key they have never seen.
*/
const FREE_TEXT_FIELDS = [
  { get: (s) => s.clauses, label: 'services.ra.terms.specialClauses', step: 3 },
  { get: (s) => s.owner?.oAddr, label: 'services.ra.owner.address', step: 1 },
  { get: (s) => (s.tenants || []).map((t) => t.addr).join(''), label: 'services.ra.tenant.address', step: 2 },
  { get: (s) => (s.wit?.w1Addr || '') + (s.wit?.w2Addr || ''), label: 'services.ra.witnesses.address', step: 4 },
  { get: (s) => (s.furnItems || []).map((f) => f.name).join(''), label: 'services.ra.terms.furniture', step: 3 },
];

/**
 * The field carrying the most text, so an over-length warning can name it.
 *
 * "Your form is too long" is not an actionable message on a form with sixty inputs; the customer
 * has no way to guess which one to cut. This picks the biggest contributor and hands back both its
 * label key and the step it lives on, so the warning can say what to shorten and the wizard can go
 * there. Falls back to the clauses box — the only field with no length limit of its own, and so the
 * only one that can be over-long without any other field being unusual.
 */
export const largestFreeTextField = (state) => {
  let worst = null;
  FREE_TEXT_FIELDS.forEach((f) => {
    const len = String(f.get(state) || '').length;
    if (!worst || len > worst.len) worst = { len, label: f.label, step: f.step };
  });
  return worst && worst.len > 0 ? worst : { len: 0, label: FREE_TEXT_FIELDS[0].label, step: FREE_TEXT_FIELDS[0].step };
};

export const emptyTenant = () => ({ name: '', age: '', gender: 'Male', occupation: '', relation: '', pan: '', aadhaar: '', mobile: '', email: '', addr: '' });
export const emptyProp = () => ({ propType: 'Flat / Apartment', furnish: 'Unfurnished', flatNo: '', society: '', locality: '', city: 'Pune', pincode: '', area: '' });
export const emptyOwner = (isIn, user) => ({ oName: isIn ? user?.name || '' : '', oAge: '', oGender: 'Male', oPan: '', oAadhaar: '', oMobile: isIn ? user?.mobile || '' : '', oEmail: '', oAddr: '' });
export const emptyInvite = () => ({ invMobile: '', invName: '', invMessage: '' });
export const emptyTerms = () => ({ startDate: '', months: '11', rent: '', deposit: '', nrDeposit: '', increment: '5', lockin: '6', notice: '2', dueDay: '5', payMode: 'Bank Transfer / NEFT' });
export const emptyWit = () => ({ w1Name: '', w1Addr: '', w2Name: '', w2Addr: '' });

/*
   ── The four fields that never leave this tab's memory ──

   PAN and Aadhaar — the owner's and every tenant's — are collected because the agreement needs them,
   and they leave this tab exactly once, on their own call: `identityParties` below feeds
   `PUT /service-requests/{id}/identities`, which the assigned operator alone can read back.
   Everything else gets this treatment first: the `details` payload that call sits beside, the
   co-fill payload an invited tenant opens, and the `dzDraft:rentAgreement` autosave. Same reasoning
   in all three. A PAN plus an Aadhaar plus a name and a permanent address is a complete identity
   set; `localStorage` is plain JSON that any XSS on this origin can read and that the next person on
   a shared, borrowed or resold device inherits; and Aadhaar in particular is not ours to retain or
   spread at all (Aadhaar Act s.29).

   Blanked rather than deleted, deliberately: `applyFormState` restores each slice wholesale
   (`setOwner(s.owner)`), so a missing key would make a controlled input uncontrolled and hand
   `undefined` to the validators that call `.trim()` on it.
*/
export const redactIdentityNumbers = (state) => ({
  ...state,
  owner: { ...(state?.owner || {}), oPan: '', oAadhaar: '' },
  tenants: (Array.isArray(state?.tenants) ? state.tenants : []).map((t) => ({ ...t, pan: '', aadhaar: '' })),
});

/**
 * True if a stored wizard state still carries either identity number.
 *
 * Only used to decide whether a rewrite is worth doing — the redaction itself is unconditional and
 * idempotent, so a false negative here costs nothing beyond leaving an already-clean entry alone.
 */
export const hasIdentityNumbers = (state) => {
  if (!state || typeof state !== 'object') return false;
  if (state.owner?.oPan || state.owner?.oAadhaar) return true;
  return (Array.isArray(state.tenants) ? state.tenants : []).some((t) => t?.pan || t?.aadhaar);
};

/*
   ── The one thing built from the *unredacted* state (D151) ──

   Everything else the wizard emits goes through `redactIdentityNumbers` first, because everything
   else is either written to disk or echoed to a reader who has no business with these numbers. This
   is the exception, and it is deliberately shaped so it cannot become one of those: the result is
   handed straight to `PUT /service-requests/{id}/identities`, which answers 204, and is never held
   in state, never serialized into `details`, and never written to `localStorage`.

   Read this together with `redactIdentityNumbers` above — the pair is the whole design. The numbers
   are collected once, travel once, on a route only the operator the request is assigned to can read,
   and are blanked by the server the moment the request reaches a terminal status.

   Normalisation mirrors the server's `ServiceRequestIdentitiesRequest`: PAN upper-cased (the field
   accepts either case and the agreement prints upper), Aadhaar reduced to its twelve digits (the
   input allows the conventional 1234 5678 9012 spacing, which the server's `^[0-9]{12}$` refuses).
   A party carrying neither number is dropped rather than sent, because the server refuses it with a
   422 that would cost the whole set — and "no numbers for this person" is what an absent row already
   says.
*/
export const identityParties = (owner, tenants) => {
  const party = (partyRole, partyIndex, name, rawPan, rawAadhaar) => {
    const pan = String(rawPan || '').trim().toUpperCase();
    const aadhaar = digits(rawAadhaar);
    if (!pan && !aadhaar) return null;
    return { partyRole, partyIndex, partyName: String(name || '').trim().slice(0, 120), pan, aadhaar };
  };
  return [
    party('owner', 0, owner?.oName, owner?.oPan, owner?.oAadhaar),
    ...(Array.isArray(tenants) ? tenants : []).map((t, i) => party('tenant', i, t?.name, t?.pan, t?.aadhaar)),
  ].filter(Boolean);
};
