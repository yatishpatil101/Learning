package com.punenest.api.catalog.society;

import jakarta.validation.constraints.NotBlank;

/**
 * "These two rows are the same building; keep this one."
 *
 * <p><strong>Why slugs and not ids.</strong> Every other society route on the back office is
 * addressed by slug — {@code /admin/society-candidates/{slug}/verify}, {@code /societies/{slug}} —
 * and the operator making this call is looking at two society cards, whose links carry slugs. An id
 * body would make this the one action they cannot construct from what is in front of them.
 *
 * @param from the duplicate that stops standing on its own. It is not deleted and nothing is moved
 *             off it; see {@link Society#getMergedInto()}
 * @param into the society that survives and absorbs the other's listings, followers and reviews on
 *             read. Naming it {@code into} rather than {@code to} because the direction is the one
 *             thing an operator can get backwards, and "merge A into B" is the sentence they are
 *             already saying out loud
 */
public record SocietyMergeRequest(
        @NotBlank(message = "Say which society is the duplicate.") String from,
        @NotBlank(message = "Say which society survives the merge.") String into) {
}
