package com.punenest.api.services.request;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.ForbiddenException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.Roles;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The deliberate hand-off of PAN and Aadhaar from the customer who typed them to the one operator
 * drafting from them (D151).
 *
 * <p><strong>What this replaces.</strong> The rent-agreement wizard used to post the owner's and
 * every tenant's identity numbers inside {@code service_requests.details}, which is plaintext
 * {@code jsonb} echoed verbatim by {@link ServiceRequestMapper} on every staff read — so the first
 * page of the ops queue was a bulk identity dump. The paid-L&amp;L security pass closed that in both
 * directions: the wizard redacts the numbers client-side and
 * {@code ServiceRequestService.rejectIdentityNumbers} refuses them if any future call site sends
 * them anyway. Both of those stay exactly as they are. This class is the channel that was missing —
 * the numbers still have to reach the desk, and until now nothing carried them.
 *
 * <p><strong>Why not the document vault, which is where the register pointed.</strong> The vault's
 * read model is {@code FileStorage.signedDownloadUrl(key)}: a URL that carries its own authority,
 * that nobody can be excluded from, and whose use never reaches our server. "Only the assigned
 * operator" and "every access is recorded" are the two requirements here and neither is expressible
 * against a bearer URL — {@code FileStorage} has no authenticated read at all, only a signer. Two
 * further facts settled it. {@code DocumentUploads.validate} accepts PDF, JPEG, PNG, HEIC and WebP
 * proved by magic bytes, so a set of numbers is not something the vault can hold without weakening
 * the allowlist that keeps non-documents out of it. And {@code DocumentService.delete} deliberately
 * leaves the stored object behind — a defensible trade for a sale deed, an indefensible one for an
 * Aadhaar number, which Aadhaar Act s.29 wants held deliberately, minimally and reversibly. The
 * vault would have made this a permanent, un-revocable, un-auditable copy of the most sensitive
 * field the platform touches. This table can be authorised, logged and blanked; that is the whole
 * argument, and it is a stronger outcome than the one the register sketched rather than a cheaper
 * one.
 *
 * <p><strong>Three guards, and they are the class.</strong>
 * <ol>
 *   <li><em>Only the requester writes.</em> These are their numbers and their counterparties'; a
 *       staff member who could write them could also invent them, and the agreement would then name
 *       somebody the customer never identified.</li>
 *   <li><em>Only the assignee reads.</em> Not "staff", not "admin" — the specific person the request
 *       is assigned to. An admin who needs them takes the request first, which is a timeline entry
 *       and an audit row, so the access has a name against it either way.</li>
 *   <li><em>Every read is recorded</em>, including every refused one. A refusal is the more
 *       interesting of the two: it is somebody reaching for a matter that is not theirs.</li>
 * </ol>
 *
 * <p><strong>And a fourth thing that is not a guard: the numbers stop existing.</strong>
 * {@link #purgeFor} runs on every terminal transition, so the retention window is exactly "while
 * somebody is drafting". Nothing else on the platform holds a raw Aadhaar — {@code identity.kyc}
 * stores masks by design — and this makes the exception time-boxed as well as narrow.
 */
@Service
public class ServiceRequestIdentityService {

    private static final Logger log = LoggerFactory.getLogger(ServiceRequestIdentityService.class);

    private final ServiceRequestIdentityRepository identities;
    private final ServiceRequestRepository requests;
    private final AuditService audit;

    public ServiceRequestIdentityService(ServiceRequestIdentityRepository identities,
            ServiceRequestRepository requests, AuditService audit) {
        this.identities = identities;
        this.requests = requests;
        this.audit = audit;
    }

    /**
     * Contract {@code putServiceRequestIdentities} — <strong>the requester, and nobody else</strong>.
     * 204.
     *
     * <p><strong>204 rather than the recorded set.</strong> Echoing what was just written would
     * re-transmit the numbers on a response nobody needs them on, and would hand a future client the
     * idea that this endpoint is a read. The customer already has these values; they typed them.
     *
     * <p><strong>Replace, not append.</strong> The wizard resubmits every party when the customer
     * corrects a typo, so the previous set is deleted first — otherwise a corrected tenant's old
     * number survives under a shifted index and the desk has two candidates for one person. The
     * delete and the insert are one transaction: a half-replaced set is worse than either end of it.
     *
     * <p><strong>Refused once the matter is closed.</strong> A completed or cancelled request has had
     * its numbers purged; accepting a write would re-create the retention this class exists to bound,
     * against a matter nobody is drafting.
     *
     * @throws NotFoundException  if the request is unknown, or is somebody else's (a stranger's
     *                            request is invisible, never forbidden — see
     *                            {@code ServiceRequestService.visible})
     * @throws ForbiddenException if a staff or admin caller tries to write the customer's identities
     * @throws ConflictException  if the request has reached a terminal status
     */
    @Transactional
    public void replace(AuthPrincipal caller, String id, ServiceRequestIdentitiesRequest body) {
        ServiceRequest request = visible(caller, id);
        if (!caller.userId().equals(request.getRequesterId())) {
            throw new ForbiddenException(
                    "Only the person who raised this request can record the parties' identity "
                            + "numbers.");
        }
        if (ServiceRequestStatuses.isTerminal(request.getStatus())) {
            throw new ConflictException("This request is " + request.getStatus()
                    + " — identity numbers cannot be recorded against it.");
        }

        // Flush the delete before the inserts: both hit uq_service_request_identity_party, and
        // Hibernate is free to order a delete after an insert within one flush, which would make a
        // resubmission of the same party collide with the row it is replacing.
        identities.deleteByServiceRequestId(request.getId());
        identities.flush();
        identities.saveAll(body.parties().stream()
                .map(party -> new ServiceRequestIdentity(request.getId(), party.partyRole(),
                        party.partyIndex(), party.normalisedName(), party.normalisedPan(),
                        party.normalisedAadhaar()))
                .toList());

        // Counts and roles only. The subject is identified by the request id, which is enough to
        // investigate an incident; putting the numbers themselves in audit_log would make the one
        // table that must be trusted the second place they are held.
        audit.record(caller, "service-request.identities-recorded", "service_request",
                request.getId().toString(), "parties", body.parties().size());
    }

    /**
     * Contract {@code getServiceRequestIdentities} — <strong>the assigned operator, and nobody
     * else</strong>.
     *
     * <p>The controller's {@code @PreAuthorize} keeps customers out; this method keeps out every
     * staff member except the one working the matter, <em>including an admin</em>. That is not an
     * oversight and it is not absolute: an admin who needs the numbers assigns the request to
     * themselves first, which writes a timeline entry the customer can read and an audit row naming
     * them. Taking one somebody else already holds costs two visible moves rather than one, because
     * the transition table has no {@code assigned → assigned} edge — the request goes back to
     * {@code in-progress} on the way. The control is accountability, not prohibition; it just has to
     * be crossed on purpose rather than by holding a role.
     *
     * <p>An unassigned request refuses everyone, for the same reason: "whoever asked first" is not a
     * name.
     *
     * @throws NotFoundException  if there is no such request
     * @throws ForbiddenException if the caller is not the assignee — recorded either way
     */
    @Transactional(readOnly = true)
    public List<ServiceRequestIdentityDto> forAssignee(AuthPrincipal caller, String id) {
        ServiceRequest request = Ids.parseUuid(id)
                .flatMap(requests::findById)
                .orElseThrow(() -> NotFoundException.of("Service request"));
        UUID assignee = request.getAssigneeId();
        if (assignee == null || !assignee.equals(caller.userId())) {
            // Recorded before the refusal, not after: an attempted read of somebody else's matter is
            // the entry worth having, and AuditService writes in REQUIRES_NEW so it survives this
            // method throwing.
            audit.record(caller, "service-request.identities-refused", "service_request",
                    request.getId().toString(),
                    "assignee", assignee == null ? null : assignee.toString());
            log.warn("Identity read refused on service request {} for {}: assigned to {}",
                    request.getId(), caller.userId(), assignee);
            throw new ForbiddenException(assignee == null
                    ? "This request is not assigned to anyone yet. Take it first — identity numbers "
                            + "are visible only to the person working the matter."
                    : "This request is assigned to somebody else. Identity numbers are visible only "
                            + "to the person working the matter.");
        }

        List<ServiceRequestIdentity> rows =
                identities.findByServiceRequestIdOrderByPartyRoleAscPartyIndexAsc(request.getId());
        audit.record(caller, "service-request.identities-viewed", "service_request",
                request.getId().toString(), "parties", rows.size());
        return rows.stream().map(ServiceRequestIdentityDto::of).toList();
    }

    /**
     * Blank the numbers held against a request that has finished, and say so on the timeline.
     *
     * <p>Called from {@code ServiceRequestService.transition} on every move into a terminal status,
     * so there is one site rather than one per ending. Both endings are real: {@code completed}
     * because the registered document now carries the numbers and we no longer need our own copy,
     * and {@code cancelled} because nothing will be drafted from them at all.
     *
     * <p>The rows survive with their names. "Recorded, and since discarded" and "never recorded" are
     * different facts about a matter, and a desk reopening a closed request should be able to see
     * that it once had what it needs rather than conclude the customer never supplied it.
     *
     * @return how many rows this call actually blanked — zero for a request that carried none, or
     *         one already purged
     */
    @Transactional
    public int purgeFor(UUID serviceRequestId) {
        List<ServiceRequestIdentity> rows =
                identities.findByServiceRequestIdOrderByPartyRoleAscPartyIndexAsc(serviceRequestId);
        int purged = 0;
        for (ServiceRequestIdentity row : rows) {
            if (row.purge()) {
                purged++;
            }
        }
        if (purged > 0) {
            log.info("Discarded identity numbers for {} parties on service request {}", purged,
                    serviceRequestId);
        }
        return purged;
    }

    /**
     * The requester's own request, or any request for ops — a stranger's is a 404, not a 403.
     *
     * <p>Deliberately the same two lines as {@code ServiceRequestService.visible} rather than a call
     * into it. Reaching across for a private helper would make this class's authorisation depend on a
     * method written for a different set of callers, and the one thing this class must not inherit is
     * somebody else's idea of who may see what.
     */
    private ServiceRequest visible(AuthPrincipal caller, String id) {
        ServiceRequest request = Ids.parseUuid(id)
                .flatMap(requests::findById)
                .orElseThrow(() -> NotFoundException.of("Service request"));
        boolean ops = Roles.Wire.STAFF.equals(caller.role()) || Roles.Wire.ADMIN.equals(caller.role());
        if (!ops && !caller.userId().equals(request.getRequesterId())) {
            throw NotFoundException.of("Service request");
        }
        return request;
    }
}
