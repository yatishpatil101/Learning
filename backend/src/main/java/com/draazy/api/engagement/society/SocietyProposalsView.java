package com.draazy.api.engagement.society;

import java.util.List;

/**
 * Everything the society hub needs to know about community proposals, in one read.
 *
 * <p>Three separate reads would be three chances for the page to render half a state — a banner
 * saying your pin correction is pending next to a map that has already been corrected — and three
 * round trips to learn what is mostly three booleans.
 *
 * @param pending           the caller-visible pending proposals, all kinds; the invite URL on a
 *                          pending WhatsApp proposal is present only for a verified resident
 * @param whatsappAvailable whether an ops-approved resident group exists at all. Deliberately a
 *                          bare boolean: a non-resident is told the group is there and nudged to
 *                          verify their flat, and learns nothing that would let them join it
 * @param whatsappJoinUrl   the invite itself, non-null only for a verified resident or staff
 */
public record SocietyProposalsView(
        List<SocietyProposalResponse> pending,
        boolean whatsappAvailable,
        String whatsappJoinUrl) {
}
