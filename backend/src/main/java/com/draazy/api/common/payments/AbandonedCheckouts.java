package com.draazy.api.common.payments;

import java.time.Instant;

public interface AbandonedCheckouts {

    // Unbounded, the first run after an outage would pull every stranded row in the table into one transaction.
    int MAX_PER_SWEEP = 500;

    // Named families make sweep counts operational; "expired 3" alone is useless.
    String family();

    int expireAbandonedCheckouts(Instant cutoff);
}
