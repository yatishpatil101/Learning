package com.punenest.api.engagement.society;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One question and its answers.
 *
 * <p><strong>{@code authorName} and no mobile.</strong> A society hub is a public page and a
 * question is not a transaction — there is nobody here for a reader to contact. That makes this a
 * different case from the residency queue, which publishes a mobile precisely because the reviewer's
 * job is to ring the applicant.
 *
 * <p><strong>{@code authorIsResident} is computed per request.</strong> It answers "is this person a
 * verified resident of this society <em>now</em>", not "were they when they typed this". The
 * distinction is the whole value of the badge.
 *
 * @param answers always present, possibly empty — never null, so the client renders one shape
 */
public record SocietyQuestionResponse(
        UUID id,
        String societySlug,
        String authorName,
        boolean authorIsResident,
        String body,
        Instant createdAt,
        List<SocietyAnswerResponse> answers) {
}
