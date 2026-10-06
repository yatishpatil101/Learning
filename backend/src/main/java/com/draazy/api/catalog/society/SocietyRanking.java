package com.draazy.api.catalog.society;

import java.math.BigDecimal;
import java.text.Collator;
import java.util.Comparator;
import java.util.Locale;

/** Computed orderings rank on read-time aggregates, so they cannot be a column {@code ORDER BY}. */
final class SocietyRanking {

    /** One society with the numbers its card shows, over the whole merge family. */
    record Row(Society society, boolean verified, long homes, BigDecimal average, long reviews) {

        private double stars() {
            return average == null ? 0 : average.doubleValue();
        }

        private double relevance() {
            return (verified ? 4 : 0) + Math.min(homes, 3) + stars() / 5;
        }
    }

    private static final Collator NAMES = Collator.getInstance(Locale.ENGLISH);

    private static final Comparator<Row> BY_NAME = Comparator
            .comparing((Row r) -> r.society().getName(), NAMES)
            .thenComparing(r -> r.society().getSlug());

    private SocietyRanking() {
    }

    /** {@code mode} is one of {@link SocietySort}'s ranked keys. */
    static Comparator<Row> by(String mode) {
        return switch (mode) {
            case SocietySort.RATING -> Comparator
                    .comparingDouble(Row::stars).reversed()
                    .thenComparing(Comparator.comparingLong(Row::reviews).reversed())
                    .thenComparing(BY_NAME);
            case SocietySort.HOMES -> Comparator
                    .comparingLong(Row::homes).reversed()
                    .thenComparing(Comparator.comparing(Row::verified).reversed())
                    .thenComparing(BY_NAME);
            default -> Comparator.comparingDouble(Row::relevance).reversed().thenComparing(BY_NAME);
        };
    }
}
