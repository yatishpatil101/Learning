/* The three specs whose subject *is* the absence of a server: client-side identity and draft rules
   that never cross the wire, plus fault-injected connectivity. Shared so the two configs partition
   the suite between them — a spec in neither runs nowhere and reports nothing. */
export const NO_BACKEND = [
  '**/consumer/connectivity.spec.js',
  '**/consumer/services/rent-agreement.spec.js',
  '**/contact-identity-masking.spec.js',
];
