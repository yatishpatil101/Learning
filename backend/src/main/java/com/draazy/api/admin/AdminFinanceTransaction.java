package com.draazy.api.admin;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalDate;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record AdminFinanceTransaction(
        UUID id,
        LocalDate date,
        String party,
        String kind,
        long amount,
        String status) {
}

