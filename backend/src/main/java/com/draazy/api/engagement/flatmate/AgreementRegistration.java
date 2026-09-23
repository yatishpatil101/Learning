package com.draazy.api.engagement.flatmate;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.time.LocalDate;
import lombok.Getter;

/** Registration particulars of a Leave &amp; License agreement (V28), compulsory under Maharashtra
 * Rent Control Act 1999 §55. Every field is nullable: pre-V28 rows and owner-tier reviews have none. */
@Embeddable
@Getter
class AgreementRegistration {

    /** Free text: the format varies by sub-registrar office and by year, nothing downstream parses
     * it, and a human checks it against the IGR portal. */
    @Column(name = "agreement_reg_no")
    private String regNo;

    @Column(name = "agreement_registered_on")
    private LocalDate registeredOn;

    /** When the licence period ends — the date {@link #expiredOn} measures the badge against. */
    @Column(name = "agreement_valid_till")
    private LocalDate validTill;

    protected AgreementRegistration() {
    }

    AgreementRegistration(String regNo, LocalDate registeredOn, LocalDate validTill) {
        this.regNo = FlatmateVocabulary.blankToNull(regNo);
        this.registeredOn = registeredOn;
        this.validTill = validTill;
    }

    /** Whether the host supplied anything to check. Used to decide if a tenant claim is checkable. */
    boolean complete() {
        return regNo != null && registeredOn != null && validTill != null
            && validTill.isAfter(registeredOn) && !expiredOn(LocalDate.now());
    }

    /** A missing end date is not an expiry: pre-V28 rows carry no dates, and treating "we never
     * asked" as "it ran out" would strip the badge from every approved agreement on deploy. */
    boolean expiredOn(LocalDate on) {
        return validTill != null && validTill.isBefore(on);
    }
}
