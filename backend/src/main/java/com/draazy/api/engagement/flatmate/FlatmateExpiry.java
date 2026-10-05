package com.draazy.api.engagement.flatmate;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import lombok.Getter;

@Embeddable
@Getter
class FlatmateExpiry {

    static final int LIFETIME_DAYS = 30;
    static final int REMIND_DAYS_BEFORE = 3;

    @Column(name = "active_until", nullable = false)
    private Instant activeUntil = Instant.now().plus(LIFETIME_DAYS, ChronoUnit.DAYS);

    @Column(name = "expiry_reminded", nullable = false)
    private boolean reminded;

    @Column(name = "expired_from")
    private String expiredFrom;

    void restart() {
        activeUntil = Instant.now().plus(LIFETIME_DAYS, ChronoUnit.DAYS);
        reminded = false;
        expiredFrom = null;
    }

    String revive(String modStatus) {
        String back = FlatmateVocabulary.MOD_EXPIRED.equals(modStatus) ? expiredFrom : modStatus;
        restart();
        return back;
    }

    String expire(String modStatus) {
        expiredFrom = modStatus;
        return FlatmateVocabulary.MOD_EXPIRED;
    }

    void markReminded() {
        reminded = true;
    }
}
