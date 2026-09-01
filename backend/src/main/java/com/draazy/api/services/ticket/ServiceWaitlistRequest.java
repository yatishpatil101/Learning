package com.draazy.api.services.ticket;

import com.draazy.api.common.validation.IndianMobile;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code POST /service-waitlist} — "tell me when this launches" (D4).
 *
 * <p><strong>Every field is bounded because none of them has an authenticated caller behind it.</strong>
 * This is the platform's third unauthenticated body-write, after {@code /cities/waitlist} and
 * {@code /society-leads}, and it follows the same rule those two set: a ceiling on every string, and
 * an unbounded one accepted nowhere.
 *
 * <p><strong>{@code name} is optional, and the mobile is not.</strong> That is the opposite way round
 * from most forms, and it is the right way round here: the platform needs a way to call somebody back
 * and does not need to know what to call them. A missing name costs the desk a slightly colder
 * opening line; a missing number costs it the lead entirely.
 *
 * <p><strong>There is no {@code detail} or free-text field, deliberately.</strong> The form does not
 * offer one, and adding one "for completeness" would be the only place on this endpoint where a
 * stranger's prose reached a screen a person reads and acts on — {@code service} is a slug checked
 * against {@link ServiceWaitlists}, and the subject and team are derived from it server-side.
 *
 * @param service a slug from {@link ServiceWaitlists}. Rejected with a 400 naming the value rather
 *                than stored, so an unknown service cannot quietly become a ticket on no desk.
 * @param name    what to call them, if they said. Trimmed and capped; blank becomes a fixed
 *                placeholder at the persist edge rather than a null the board renders as a gap.
 * @param mobile  ten digits. {@link IndianMobile} checks the shape here; {@code MobileMask.normalise}
 *                canonicalises at the persist edge, so the rate-limit key and the stored row agree.
 */
public record ServiceWaitlistRequest(
        @NotBlank @Size(max = 40) String service,
        @Size(max = 120) String name,
        @NotBlank @IndianMobile String mobile) {
}
