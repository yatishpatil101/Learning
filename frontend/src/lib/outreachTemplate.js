/* Must stay in step with the server's own substitution (`OwnerOutreachService.variables` + the
   message renderer), or a staff member previews a message the owner will not receive.

   **An unknown key is left standing as literal text, not blanked** — the server's behaviour, so a
   typo surfaces in the preview instead of deleting a sentence from a public message. */
export function interpolateOutreachTemplate(body, variables) {
  return String(body || '').replace(/\{(\w+)\}/g, (whole, key) => {
    const value = variables?.[key];
    return value == null || value === '' ? whole : String(value);
  });
}
