package com.punenest.api.admin;

import java.time.LocalDate;

/**
 * Turns whatever the JDBC driver hands back for a {@code date_trunc} bucket into a {@link LocalDate}.
 *
 * <p>Its own type because both back-office read services need it and neither owns it. Postgres
 * returns {@code date_trunc} as a {@code timestamp}, but which Java type that surfaces as depends on
 * the driver's type mapping rather than on anything either service decides — so the knowledge
 * belongs beside neither of them. Copying it into both is the alternative, and a copied type switch
 * is one that gets a case added on one side only.
 *
 * <p>Every shape is accepted rather than assumed, and an unrecognised one throws instead of
 * returning a plausible date: a bucket silently coerced to the wrong day would move a row into a
 * neighbouring column of a chart, which is the kind of wrong that nobody reports as a bug.
 */
final class BucketDate {

    private BucketDate() {
    }

    static LocalDate of(Object bucket) {
        return switch (bucket) {
            case java.sql.Timestamp ts -> ts.toLocalDateTime().toLocalDate();
            case java.sql.Date date -> date.toLocalDate();
            case java.time.LocalDateTime dt -> dt.toLocalDate();
            case LocalDate date -> date;
            case java.time.OffsetDateTime odt -> odt.toLocalDate();
            case null, default -> throw new IllegalStateException(
                    "Unexpected bucket type from date_trunc: " + bucket);
        };
    }
}
