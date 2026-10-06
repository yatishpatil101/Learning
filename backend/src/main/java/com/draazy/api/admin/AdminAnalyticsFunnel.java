package com.draazy.api.admin;

import java.time.LocalDate;
import java.util.List;

/** Each stage counts events in the week they happened, not a cohort, so stage ratios are throughput, not conversion. */
public record AdminAnalyticsFunnel(int days, LocalDate from, LocalDate to, List<Week> weeks) {

    public record Week(LocalDate week, long posted, long approved, long contacts, long visits, long deals) {
    }
}
