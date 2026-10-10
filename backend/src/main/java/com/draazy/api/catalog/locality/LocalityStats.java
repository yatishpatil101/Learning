package com.draazy.api.catalog.locality;

import java.math.BigDecimal;

/** What live listings say about a locality; every average is null below {@link #MIN_SAMPLE} samples. */
record LocalityStats(long live, Long avgRent, Long ratePerSqft, Long fromPrice) {

    static final int MIN_SAMPLE = 3;

    static final LocalityStats NONE = new LocalityStats(0, null, null, null);

    boolean indexable() {
        return live >= MIN_SAMPLE;
    }

    /** Row layout is fixed by {@code PropertyRepository#liveLocalityStats}. */
    static LocalityStats of(Object[] r) {
        long live = ((Number) r[1]).longValue();
        return new LocalityStats(live,
                average(r[2], r[3]), average(r[4], r[5]), r[6] == null ? null : ((Number) r[6]).longValue());
    }

    private static Long average(Object sample, Object mean) {
        if (mean == null || ((Number) sample).longValue() < MIN_SAMPLE) {
            return null;
        }
        return new BigDecimal(mean.toString()).setScale(0, java.math.RoundingMode.HALF_UP).longValue();
    }
}
