package com.punenest.api.catalog.society;

import java.math.BigDecimal;

/**
 * A society as the back office sees it: the five editable facts, plus enough to know which row.
 *
 * <p>Deliberately not {@link SocietyResponse}. That record is the anonymous directory's payload and
 * carries thirty-odd fields nobody editing a conveyance box is looking at; more to the point, this
 * one carries {@code adminNote}, which is moderator prose about a named building and often about the
 * people in it. Keeping the two records apart is what makes publishing the note by accident a
 * compile error rather than a review catch.
 *
 * @param slug               the society's public alias, and what addressed this request
 * @param name               for the toast and the audit trail; not editable here
 * @param registration       whether the society's registration is on file
 * @param conveyance         whether conveyance has been completed
 * @param maintenancePerSqft monthly maintenance in rupees per square foot, null if unrecorded
 * @param claimStatus        one of {@link SocietyClaimStatus}
 * @param adminNote          the internal note, null when there is none
 */
public record SocietyAdminResponse(
        String slug,
        String name,
        boolean registration,
        boolean conveyance,
        BigDecimal maintenancePerSqft,
        String claimStatus,
        String adminNote) {

    static SocietyAdminResponse of(Society society) {
        return new SocietyAdminResponse(
                society.getSlug(),
                society.getName(),
                society.isRegistration(),
                society.isConveyance(),
                society.getMaintenancePerSqft(),
                society.getClaimStatus(),
                society.getAdminNote());
    }
}
