package com.draazy.api.services.request;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * The PAN and Aadhaar of one party named in a service request. Maps
 * {@code service_request_identities} (V47, D151).
 *
 * <p><strong>This is the only place on the platform that holds a raw Aadhaar number.</strong>
 * {@code identity.kyc.OwnerKyc} deliberately stores masks and nothing else, because everything the
 * product does with owner KYC is satisfied by a mask. Drafting a Leave &amp; License is the one job
 * that is not: the agreement prints the full number, so the desk needs the full number. Everything
 * about this class exists to make that exception narrow — the row is per request, it is readable by
 * exactly one person, every read is recorded, and it is blanked the moment the drafting is over.
 *
 * <p><strong>It is not on {@link ServiceRequestDto} and must never be.</strong> That DTO is
 * projected onto the paged ops queue, which is precisely the surface that made the numbers a leak
 * when they lived in {@code details}. The only way to these values is
 * {@code GET /service-requests/{id}/identities}, one request at a time.
 *
 * <p><strong>Ids, not associations</strong> — {@code serviceRequestId} is a plain UUID rather than a
 * {@code @ManyToOne}, matching {@code documents.Document}: an object reference would make it
 * possible to reach these rows by navigating from a request that was loaded for some other reason,
 * and the entire design here is that they are reachable only on purpose.
 */
@Entity
@Table(name = "service_request_identities")
@Getter
public class ServiceRequestIdentity extends BaseEntity {

    /** The owner's side of the agreement. */
    public static final String OWNER = "owner";

    /** A tenant. There may be several; {@link #partyIndex} orders them as the wizard collected them. */
    public static final String TENANT = "tenant";

    @Column(name = "service_request_id", nullable = false, updatable = false)
    private UUID serviceRequestId;

    /** {@link #OWNER} or {@link #TENANT}; the V47 CHECK rejects anything else. */
    @Column(name = "party_role", nullable = false, updatable = false)
    private String partyRole;

    /** Zero for the owner; the tenant's position in the wizard's list otherwise. */
    @Column(name = "party_index", nullable = false, updatable = false)
    private int partyIndex;

    /**
     * Who this is, so the desk can tell two tenants apart.
     *
     * <p>Survives {@link #purge()}: a name is not the field Aadhaar Act s.29 is about, and a purged
     * row identifying nobody reads like data loss rather than like a retention decision.
     */
    @Column(name = "party_name", updatable = false)
    private String partyName;

    /** {@code ABCDE1234F}, or null — a tenant may genuinely not have one. Blanked by {@link #purge()}. */
    @Column(name = "pan")
    private String pan;

    /** Twelve digits, or null. Blanked by {@link #purge()}. */
    @Column(name = "aadhaar")
    private String aadhaar;

    /** When the two numbers above were blanked, or null while they are still held. */
    @Column(name = "purged_at")
    private Instant purgedAt;

    protected ServiceRequestIdentity() {
        // JPA
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

    /**
     * Blank the two numbers and record that it happened.
     *
     * <p>Called when the request reaches a terminal status. Idempotent — a second call on an already
     * purged row leaves the first {@code purgedAt} standing, so the timestamp always says when the
     * numbers actually stopped being held rather than when someone last swept.
     *
     * @return whether this call is the one that blanked them
     */
    boolean purge() {
        if (purgedAt != null) {
            return false;
        }
        this.pan = null;
        this.aadhaar = null;
        this.purgedAt = Instant.now();
        return true;
    }

    /** Whether the numbers are still held. False once {@link #purge()} has run. */
    public boolean isHeld() {
        return purgedAt == null;
    }
}
