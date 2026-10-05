package com.draazy.api.services.request;

import java.time.LocalDate;

public record RentAgreementOverlapDto(
        String requestId,
        String status,
        String match,
        LocalDate startDate,
        LocalDate endDate,
        String licensor,
        boolean licensorDiffers) {
}
