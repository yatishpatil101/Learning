package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.persistence.AuditedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * A flat owner's OTP-confirmed acknowledgement that a sitting tenant is seeking a replacement
 * (V27 {@code flatmate_owner_consents}).
 *
 * <p><strong>Keyed on the owner's mobile, not a user id</strong>, because the owner very often has
 * no Draazy account — they are a landlord, not a user of the product. Requiring them to sign up
 * before they could say "yes, I know about this" would mean the consent was never recorded at all,
 * and the feature's entire purpose is to turn a tenant's claim into something auditable.
 */
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

    @Column(name = "granted_at", nullable = false)
    private Instant grantedAt = Instant.now();

    protected FlatmateOwnerConsent() {
    }

    FlatmateOwnerConsent(String ownerMobile, UUID grantedBy, UUID groupId) {
        this.ownerMobile = ownerMobile;
        this.grantedBy = grantedBy;
        this.groupId = groupId;
    }
}
