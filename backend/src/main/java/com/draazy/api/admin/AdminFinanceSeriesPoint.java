package com.draazy.api.admin;

import java.time.LocalDate;

public record AdminFinanceSeriesPoint(
        LocalDate month,
        long subscriptions,
        long services) {

    /** The three bands added up, which is what the console's total row and its doughnut both read. */
    public long total() {
        return subscriptions + services;
    }
}

