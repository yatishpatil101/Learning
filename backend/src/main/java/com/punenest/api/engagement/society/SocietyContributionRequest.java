package com.punenest.api.engagement.society;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Posting a tip, a trusted pick or a photo.
 *
 * <p>One request record for all three kinds, mirroring {@link SocietyContributionResponse}: the
 * composer is one dialog with a kind switcher at the top, and splitting this would produce three
 * schemas that differ by two fields each.
 *
 * <p>Bean validation can only police lengths here, because which fields are <em>required</em>
 * depends on {@code kind} — a rule the service states once and the database enforces again in
 * {@code ck_society_contrib_kind_shape}. The lengths match the composer's own {@code maxLength}
 * attributes, so a field that fits on screen fits in the request.
 *
 * @param kind one of {@code tip}, {@code pick}, {@code photo}. An unrecognised kind is a 400 rather
 *     than a row that renders as a blank card.
 * @param category free text. The composer offers a per-kind list as a convenience, but a society
 *     will always have a kind of tip nobody anticipated, so this is not a closed set.
 * @param photoUrl a URL from {@code POST /me/photos}, never a data URI — the browser build kept
 *     base64 in {@code localStorage}, which is exactly why a shared photo was invisible everywhere
 *     except the device that shared it.
 */
public record SocietyContributionRequest(
        @NotBlank @Size(max = 16) String kind,
        @Size(max = 40) String category,
        @Size(max = 600) String body,
        @Size(max = 80) String referralName,
        @Size(max = 20) String referralContact,
        @Size(max = 500) String photoUrl) {
}
