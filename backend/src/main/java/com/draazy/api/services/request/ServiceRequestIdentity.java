package com.draazy.api.services.request;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

// Only service requests hold raw Aadhaar; owner KYC stores masks because masks suffice.
@Entity
@Table(name = "service_request_identities")
@Getter
public class ServiceRequestIdentity extends BaseEntity {

    public static final String OWNER = "owner";

    public static final String TENANT = "tenant";

    public static final String WITNESS = "witness";

    @Column(name = "service_request_id", nullable = false, updatable = false)
    private UUID serviceRequestId;

    // #OWNER, #TENANT or #WITNESS; the CHECK rejects anything else.
    @Column(name = "party_role", nullable = false, updatable = false)
    private String partyRole;

    @Column(name = "party_index", nullable = false, updatable = false)
    private int partyIndex;

    // Keep the name after purge so a retained row still tells the desk who it was.
    @Column(name = "party_name", updatable = false)
    private String partyName;

    @Column(name = "pan")
    @Convert(converter = IdentityNumberConverter.class)
    private String pan;

    @Column(name = "aadhaar")
    @Convert(converter = IdentityNumberConverter.class)
    private String aadhaar;

    @Column(name = "purged_at")
    private Instant purgedAt;

    protected ServiceRequestIdentity() {

    }

    public ServiceRequestIdentity(UUID serviceRequestId, String partyRole, int partyIndex,
            String partyName, String pan, String aadhaar) {
        this.serviceRequestId = serviceRequestId;
        this.partyRole = partyRole;
        this.partyIndex = partyIndex;
        this.partyName = partyName;
        this.pan = pan;
        this.aadhaar = aadhaar;
    }

    // Idempotent purge preserves the first timestamp: when numbers stopped being held.
    boolean purge() {
        if (purgedAt != null) {
            return false;
        }
        this.pan = null;
        this.aadhaar = null;
        this.purgedAt = Instant.now();
        return true;
    }

    public boolean isHeld() {
        return purgedAt == null;
    }
}
