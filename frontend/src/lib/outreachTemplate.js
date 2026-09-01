/**
 * The outreach template substitution rule, written down once.
 *
 * Pure: no imports, no session, no request. It lives in `lib/` rather than in `outreachService.js`
 * because both the mock provider and the console's live preview need it, and reaching it through
 * the service would mean a provider importing the module that loads providers — a real edge through
 * `services/config.js`, added for a regex.
 *
 * The server runs this same substitution over the same string at send time
 * (`OwnerOutreachService.variables` + the message renderer). The two are only guaranteed to agree
 * while there is one rule; a component that rolls its own shows a staff member a preview of a
 * message the owner will not receive.
 */

/**
 * Replace `{placeholder}` keys from `variables`.
 *
 * **An unknown key is left standing as literal text, not blanked.** That is the server's behaviour
 * and the reason for it: a typo surfaces in the preview a staff member reads, instead of silently
 * deleting a sentence from a message that then goes to a member of the public.
 *
 * Two of the library's keys resolve to nothing server-side and so always render literally.
 * `{market_rate}` was the hard-coded string `9,500` — the same figure for every locality in Pune,
 * quoted to an owner deciding what to charge. `{claim_link}` pointed at `/claim/{id}`, a route this
 * application has never had; the server resolves it to the sign-in page, because the account is
 * provisioned against the owner's own mobile, so signing in *is* the claim. Neither is a gap for a
 * caller to fill in.
 *
 * An empty string counts as absent, so a listing with no locality renders `{locality}` rather than
 * a sentence with a hole in it — visible to the person about to press send, which is the only
 * moment it can still be fixed.
 */
export function interpolateOutreachTemplate(body, variables) {
  return String(body || '').replace(/\{(\w+)\}/g, (whole, key) => {
    const value = variables?.[key];
    return value == null || value === '' ? whole : String(value);
  });
}
