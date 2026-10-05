package com.draazy.api.services.request;

import java.time.Instant;
import java.time.LocalDate;

public record PoliceIntimationDto(
        boolean confirmed,
        Instant confirmedAt,
        String confirmedBy,
        String reference,
        LocalDate submittedOn) {

    static PoliceIntimationDto pending() {
        return new PoliceIntimationDto(false, null, null, null, null);
    }
}
