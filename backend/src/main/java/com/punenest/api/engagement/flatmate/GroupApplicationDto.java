package com.punenest.api.engagement.flatmate;

import java.time.Instant;
import java.util.UUID;

/**
 * Contract schema {@code GroupApplication}.
 *
 * <p>Most of this is derived by joining the listing and the group: an application row itself holds
 * only the two keys, the two statuses and the timestamps. Denormalising the titles and the rent onto
 * the row would mean an admin screen rendering a price that stopped being true the moment the owner
 * edited their listing.
 *
 * @param status    the OWNER's decision — admin may never write it
 * @param modStatus the ADMIN's moderation axis, independent of the above
 */
public record GroupApplicationDto(
        UUID id,
        UUID listingId,
        String listingTitle,
        String locality,
        Long rent,
        Long perHead,
        String groupTitle,
        String applicantName,
        int members,
        int seatsTotal,
        String status,
        String modStatus,
        Instant at) {

    static GroupApplicationDto of(FlatmateGroupApplication application, String listingTitle,
            String locality, Long rent, String groupTitle, String applicantName,
            int members, int seatsTotal) {
        return new GroupApplicationDto(
                application.getId(),
                application.getListingId(),
                listingTitle,
                locality,
                rent,
                // Per head is what each applicant actually pays, computed on read so it can never
                // disagree with the listing's rent.
                rent == null || seatsTotal <= 0 ? rent : rent / seatsTotal,
                groupTitle,
                applicantName,
                members,
                seatsTotal,
                application.getStatus(),
                application.getModStatus(),
                application.getCreatedAt());
    }
}
