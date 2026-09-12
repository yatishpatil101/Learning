package com.draazy.api.services.request;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Reads and writes over {@code service_request_identities} (D151).
 *
 * <p><strong>Every method takes a service-request id, and that is deliberate.</strong> There is no
 * {@code findAll}, no {@code findByPan}, no paged read and no query keyed on anything but one
 * matter — because a query that can return identity numbers for more than one request at a time is
 * exactly the ops-queue disclosure this table was built to replace. If a future reader needs "every
 * request with identities recorded", it wants a count, not these rows.
 */
public interface ServiceRequestIdentityRepository extends JpaRepository<ServiceRequestIdentity, UUID> {

    /** The parties on one request, in drafting order (owner before tenants, then by index). */
    List<ServiceRequestIdentity> findByServiceRequestIdOrderByPartyRoleAscPartyIndexAsc(
            UUID serviceRequestId);

    /**
     * Drop every party recorded against one request.
     *
     * <p>Used by the replace-the-whole-set write: the wizard resubmits all parties when the customer
     * corrects a typo, and a delete-then-insert is what stops a corrected tenant from leaving their
     * previous number behind under a shifted index.
     */
    void deleteByServiceRequestId(UUID serviceRequestId);
}
