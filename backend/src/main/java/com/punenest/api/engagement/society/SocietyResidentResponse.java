package com.punenest.api.engagement.society;

import java.time.Instant;
import java.util.UUID;

/**
 * One residency request as the applicant and the reviewer see it (contract {@code SocietyResident}).
 *
 * <p><strong>Why the reviewer sees a name and a mobile.</strong> Everywhere else on this platform an
 * identity is withheld until a deal exists, and this is a deliberate exception. The question a
 * reviewer is answering is "does this person live in B/704", and it is answered against a members'
 * register that has names in it; a queue of anonymous unit numbers is one nobody can decide. The
 * reviewer is either platform staff or a claimant ops have themselves verified, so the disclosure
 * runs to a vetted party about somebody who volunteered the information in order to be recognised.
 *
 * <p>The applicant's own read goes through the same record and sees their own details, which is the
 * one case where none of the above needs arguing.
 */
public record SocietyResidentResponse(
        UUID id,
        String societySlug,
        String name,
        String mobile,
        String wing,
        String flat,
        String unitKey,
        String relation,
        String status,
        String assignedTo,
        String flagged,
        String note,
        Instant createdAt,
        Instant decidedAt) {
}
