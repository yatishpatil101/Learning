/* One share path for the whole app.

   Three surfaces had already grown their own copy of this (Refer, Reels, the
   property compare bar) and they did NOT agree: only two of them treated a
   cancelled share sheet as a non-event, so the third reported "Couldn't copy
   link" for the single most common outcome of tapping Share on a phone — open
   it, change your mind, swipe it away.

   The status is returned rather than toasted here, because the wording is
   surface-specific and lives in i18n at the call site.

   @param {{title?: string, text?: string, url?: string}} payload
   @returns {Promise<'shared'|'cancelled'|'copied'|'failed'>}
*/
export async function shareOrCopy({ title, text, url = window.location.href } = {}) {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      // Dismissing the sheet is a decision, not an error.
      if (err?.name === 'AbortError') return 'cancelled';
      // Any other share failure is rare; fall through to the clipboard rather
      // than dead-ending, so the user still comes away with the link.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
