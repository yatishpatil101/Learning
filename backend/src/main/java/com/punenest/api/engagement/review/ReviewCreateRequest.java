package com.punenest.api.engagement.review;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.Map;

/**
 * The contract's {@code ReviewCreate}.
 *
 * <p><strong>There is deliberately no {@code context} field.</strong> The badge is derived from the
 * author's visit and tenancy history, never supplied — spec fix S26 marks it {@code readOnly} for
 * exactly this reason. Accepting it here would make "Verified resident" claimable by anyone able to
 * send a POST, which is the entire internet, and the badge is the one thing that makes a review
 * worth reading.
 *
 * <p>{@code targetType} and {@code targetId} are likewise absent: both routes take them from the
 * path. A body that could name its own target would let a caller review property B through
 * property A's endpoint, side-stepping the eligibility check that the path drives.
 *
 * @param rating     required, 1–5; the one field a review cannot omit
 * @param categories optional sub-ratings, validated against the closed key set in
 *                   {@link ReviewCategories} — Bean Validation cannot express
 *                   {@code additionalProperties: false} over a map, so it is enforced in the service
 * @param recommend  optional and nullable; omitting it means "did not say", not "no"
 */
public record ReviewCreateRequest(
        @NotNull @Min(1) @Max(5) Integer rating,
        @Size(max = 160) String title,
        @Size(max = 4000) String body,
        Map<String, Integer> categories,
        Boolean recommend) {
}
