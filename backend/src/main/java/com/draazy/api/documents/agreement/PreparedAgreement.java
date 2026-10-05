package com.draazy.api.documents.agreement;

import java.time.LocalDate;
import java.util.UUID;

/** What the final-document upload of a paid rent-agreement request knows about the agreement. */
public record PreparedAgreement(
        UUID serviceRequestId,
        UUID propertyId,
        UUID ownerId,
        UUID finalDocumentId,
        UUID preparedBy,
        Long rent,
        Long deposit,
        LocalDate startDate,
        Integer durationMonths) {
}
