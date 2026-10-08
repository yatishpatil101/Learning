package com.draazy.api.catalog.society;

import java.math.BigDecimal;

/** Not {@link SocietyResponse}: {@code adminNote} is moderator prose, and separate records make publishing it a compile error. */
public record SocietyAdminResponse(
        String slug,
        String name,
        boolean registration,
        boolean conveyance,
        BigDecimal maintenancePerSqft,
        String adminNote) {

    static SocietyAdminResponse of(Society society) {
        return new SocietyAdminResponse(
                society.getSlug(),
                society.getName(),
                society.isRegistration(),
                society.isConveyance(),
                society.getMaintenancePerSqft(),
                society.getAdminNote());
    }
}
