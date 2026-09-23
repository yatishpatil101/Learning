package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/** Keyed on the owner's mobile, not a user id: a landlord very often has no Draazy account, and
 * requiring one would mean no consent was ever recorded (V27 {@code flatmate_owner_consents}). */
@Entity
@Table(name = "flatmate_owner_consents")
@Getter
public class FlatmateOwnerConsent extends AuditedEntity {

    @Column(name = "owner_mobile", nullable = false, updatable = false)
    private String ownerMobile;

    /** The tenant who asked for it — the person the consent is granted <em>to</em>. */
    @Column(name = "granted_by", nullable = false, updatable = false)
    private UUID grantedBy;

    @Column(name = "group_id")
    private UUID groupId;

    /** Scopes the consent to one flat ({@link FlatmateGuardrails#fingerprint} form, V30). Without it
     * a single OTP would vouch for every post the tenant ever made. Null on pre-V30 rows. */
    @Column(name = "address_fingerprint", updatable = false)
    private String addressFingerprint;

    /** Today the column default fills this; the initializer stands by for the day a JPA {@code save}
     * path exists, since that would send an explicit null instead. */
    @Column(name = "granted_at", nullable = false)
    private Instant grantedAt = Instant.now();

    /** Hibernate's, and there is no other: rows are written only by
     * {@link FlatmateOwnerConsentRepository#insertIfAbsent}'s {@code ON CONFLICT DO NOTHING}. */
    protected FlatmateOwnerConsent() {
    }

    /** One-way on purpose: re-pointing an existing consent at a second group would reopen the
     * address-scoping hole V30 closed. */
    void adoptGroup(UUID groupId) {
        if (groupId != null && this.groupId == null) {
            this.groupId = groupId;
        }
    }
}
