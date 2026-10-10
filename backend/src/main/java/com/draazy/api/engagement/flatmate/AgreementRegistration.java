package com.draazy.api.engagement.flatmate;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.time.LocalDate;
import lombok.Getter;

/** Validity of a Leave &amp; License agreement. Nullable: pre- rows and owner-tier reviews have none. */
@Embeddable
@Getter
class AgreementRegistration {

    @Column(name = "agreement_valid_till")
    private LocalDate validTill;

    protected AgreementRegistration() {
    }

    AgreementRegistration(LocalDate validTill) {
        this.validTill = validTill;
    }

    /** A missing end date is not an expiry: pre- rows carry no dates, and treating "we never
     * asked" as "it ran out" would strip the badge from every approved agreement on deploy. */
    boolean expiredOn(LocalDate on) {
        return validTill != null && validTill.isBefore(on);
    }
}
