package com.punenest.api.engagement.society;

/**
 * Where the caller stands in one society (contract {@code SocietyMembership}).
 *
 * <p><strong>Why this is one endpoint and not three.</strong> The hub asks all of these on load, and
 * it has to: whether the notice-board composer renders, whether the "verify your flat" prompt
 * renders, whether the committee's resident queue renders and whether the "claim this society"
 * button renders are four decisions taken from the same three facts. Three round trips would render
 * the page in three stages, each one flickering a control into or out of existence, and the version
 * of that page that shipped in the browser had exactly that bug.
 *
 * @param societySlug the society this answer is about
 * @param resident the caller's standing residency request, or null if they have never asked
 * @param admin whether the caller's claim on this society has been approved
 * @param claim the society's one live claim, whoever made it — so a second committee is told the
 *              page is already spoken for rather than being invited to duplicate the request
 * @param verifiedResidents how many people are verified here; the hub's social-proof line, and the
 *                          reason a brand-new society reads as empty rather than as broken
 */
public record SocietyMembership(
        String societySlug,
        SocietyResidentResponse resident,
        boolean admin,
        SocietyClaimResponse claim,
        long verifiedResidents) {
}
