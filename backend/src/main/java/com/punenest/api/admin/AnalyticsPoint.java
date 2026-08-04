package com.punenest.api.admin;

import java.time.LocalDate;

/** Contract schema {@code AnalyticsPoint} — one bucket of a time series. */
public record AnalyticsPoint(LocalDate date, long value) {
}
