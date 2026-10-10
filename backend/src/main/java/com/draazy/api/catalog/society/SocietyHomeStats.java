package com.draazy.api.catalog.society;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** Live homes over a merge family. Row layout is fixed by {@code PropertyRepository#societyHomeStats}. */
record SocietyHomeStats(long live, long forSale, long forRent, Long psf, Long rentAvg) {

    static SocietyHomeStats of(Object[] r) {
        return new SocietyHomeStats(((Number) r[0]).longValue(), ((Number) r[1]).longValue(),
                ((Number) r[2]).longValue(), rounded(r[3]), rounded(r[4]));
    }

    private static Long rounded(Object mean) {
        return mean == null ? null : new BigDecimal(mean.toString()).setScale(0, RoundingMode.HALF_UP).longValue();
    }
}