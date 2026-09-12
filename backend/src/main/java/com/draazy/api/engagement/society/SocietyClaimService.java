package com.draazy.api.engagement.society;

import com.draazy.api.catalog.society.Society;
import com.draazy.api.catalog.society.SocietyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.PersonalDocumentLookup;
import com.draazy.api.common.trust.PersonalDocumentView;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Who runs a society's page: claiming it, reviewing the claim, and reading the proof.
 *
 * <p>Split out of {@link SocietyMembershipService} when that service crossed the 450-line trigger in
 * {@code package-structure.md} §4.1. The split is by use-case rather than by layer, and the line it
 * follows was already drawn: <strong>residency answers "does this person live here", a claim answers
 * "does this person speak for the building"</strong>. Those are decided by different people (a
 * committee reviews residents; only ops review claims), on different evidence (a flat number versus
 * a registration certificate), with different consequences — a verified resident gets a badge, an
 * approved claimant gets authority over everybody else's. They were together because a claim is what
 * decides who reviews a residency, but that is one read, not a shared responsibility.
 *
 * <p><strong>Approving a claim still re-homes the residency queue</strong>, which is why this
 * service holds {@link SocietyResidentRepository}. That direction is deliberate: handing a society
 * to its committee is a claim decision that has an effect on residencies, not a residency operation.
 * The dependency runs one way — {@link SocietyMembershipService} asks this service what a claim looks
 * like on the wire, and this service never asks it anything — so there is no cycle to break later.
 */
@Service
public class SocietyClaimService {

    private final SocietyClaimRepository claims;
    private final SocietyResidentRepository residents;
    private final SocietyRepository societies;
    private final UserRepository users;
    private final PersonalDocumentLookup vault;
    private final AuditService audit;

    public SocietyClaimService(SocietyClaimRepository claims, SocietyResidentRepository residents,
            SocietyRepository societies, UserRepository users, PersonalDocumentLookup vault,
            AuditService audit) {
        this.claims = claims;
        this.residents = residents;
        this.societies = societies;
        this.users = users;
        this.vault = vault;
        this.audit = audit;
    }

    /**
     * Claim a society on behalf of its committee.
     *
     * <p>A society that already has a live claim is refused rather than queued behind it — two
     * committees for one building is a data problem, not a backlog — except when the caller is
     * amending their own pending claim, which is a correction.
     */
    @Transactional
    public SocietyClaimResponse claim(String slug, UUID userId, SocietyClaimRequest body) {
        Society society = society(slug);
        Optional<SocietyClaim> live = claims.findLiveClaim(society.getId());
        if (live.isPresent()) {
            SocietyClaim existing = live.get();
            if (!existing.getClaimedBy().equals(userId)) {
                throw new ConflictException(existing.isApproved()
                        ? "This society is already managed by its committee."
                        : "Someone has already claimed this society and is waiting on review.");
            }
            if (existing.isApproved()) {
                throw new ConflictException("You already manage this society.");
            }
            existing.amend(body.name(), body.role(), body.email(), body.note(),
                    body.registrationNo(), certificate(userId, body.certificateDocumentId()));
            return toResponse(claims.save(existing), society);
        }
        SocietyClaim row = new SocietyClaim(society.getId(), userId, body.name(), body.role(),
                body.email(), body.note(), body.registrationNo(),
                certificate(userId, body.certificateDocumentId()));
        try {
            SocietyClaim saved = claims.saveAndFlush(row);
            // The society's own claim_status moves in the same transaction. Two records of one fact
            // that can disagree is worse than one record in the wrong place: the hub reads the
            // society's badge, ops read the claim, and a society still showing "unclaimed" while a
            // committee waits on review is how a claim gets worked twice.
            societies.updateClaimStatus(society.getId(),
                    com.draazy.api.catalog.society.SocietyClaimStatus.PENDING);
            return toResponse(saved, society);
        } catch (DataIntegrityViolationException race) {
            throw new ConflictException("Someone claimed this society a moment ago.");
        }
    }

    /* ------------------------------------------------------------------- ops */

    /** The claim queue, oldest first. Staff-only; guarded at the controller. */
    @Transactional(readOnly = true)
    public Page<SocietyClaimResponse> claimQueue(String status, Pageable pageable) {
        Page<SocietyClaim> page = claims.queue(blankToNull(status), pageable);
        Map<UUID, Society> bySociety = societiesOf(page.getContent().stream()
                .map(SocietyClaim::getSocietyId).toList());
        return page.map(c -> toResponse(c, bySociety.get(c.getSocietyId())));
    }

    /**
     * Open the registration certificate attached to one claim. Staff-only; guarded at the controller.
     *
     * <p><strong>Resolved from the claim, never from a document id the caller supplies.</strong>
     * That is the whole security design and it is worth being blunt about why. The certificate sits
     * in the claimant's personal vault, which is the same table that holds their Aadhaar, their PAN
     * and their salary slips. A route that took a document id would let any account with
     * {@code societies:read} — a permission handed out to work a queue — read any of those for any
     * user on the platform. So the only input is a claim id; the document id is read off the row,
     * and the set of documents this endpoint can reach is exactly the set somebody attached to a
     * claim.
     *
     * <p><strong>And then checked again.</strong> The vault is asked for a document that is both the
     * one on the row <em>and</em> owned by the person who filed the claim. That second half is
     * redundant today, because {@link #certificate} verified ownership when the claim was written —
     * which is the point: the two checks fail independently. If a future write path forgets the
     * first, or a row is edited by hand, this still cannot return a stranger's file. A claim whose
     * pointer no longer resolves reads as "no certificate" rather than as somebody else's document.
     *
     * <p><strong>404 for all three failures</strong> — unknown claim, no certificate offered, and a
     * pointer that does not resolve. Distinguishing them would tell an operator that a document
     * exists and is being withheld, which is the oracle {@code DocumentService.deletePersonal} and
     * {@link PersonalDocumentLookup} both refuse to be.
     *
     * <p><strong>Audited as a reveal.</strong> This is a staff account opening one identified
     * person's uploaded paperwork, which is the same class of action as
     * {@code enquiry.contact.reveal} and {@code user.contact.reveal}, and it is recorded the same
     * way. The document id goes in the metadata rather than the URL: the URL is a live capability
     * and the audit log is not a place to store one.
     */
    @Transactional(readOnly = true)
    public SocietyClaimCertificateResponse claimCertificate(UUID claimId, AuthPrincipal actor) {
        SocietyClaim claim = claims.findById(claimId)
                .orElseThrow(() -> NotFoundException.of("Society claim"));
        UUID documentId = claim.getCertificateDocumentId();
        if (documentId == null) {
            throw NotFoundException.of("Certificate");
        }
        PersonalDocumentView doc = vault.viewOwnedBy(documentId, claim.getClaimedBy())
                .orElseThrow(() -> NotFoundException.of("Certificate"));

        audit.record(actor, "societyClaim.certificate.reveal", "societyClaim", claimId.toString(),
                "documentId", documentId.toString(), "claimant", claim.getClaimedBy().toString());

        return new SocietyClaimCertificateResponse(
                doc.url(), doc.fileName(), doc.mimeType(), doc.sizeBytes());
    }

    /**
     * Approve or reject a claim, and move the society's own {@code claim_status} with it.
     *
     * <p>The two writes are one transaction on purpose. A society whose claim says approved while
     * its own record still says unclaimed is a society whose committee holds a permission the hub
     * will not render a control for, and that state is unrecoverable without a manual fix.
     *
     * <p><strong>Approving also re-homes the residency queue.</strong> Requests filed while nobody
     * ran the society were assigned to ops; on approval the ones still pending move to the committee
     * that now exists, because ops reviewing a claimed society's residents is exactly the work the
     * claim was meant to hand over. Already-decided rows keep their queue — the record of who
     * decided must not be rewritten.
     */
    @Transactional
    public SocietyClaimResponse decideClaim(UUID claimId, UUID decidedBy,
            SocietyClaimDecisionRequest body) {
        if (!SocietyClaimStatuses.isDecision(body.status())) {
            throw new BadRequestException("status must be approved or rejected");
        }
        SocietyClaim row = claims.findForDecision(claimId)
                .orElseThrow(() -> NotFoundException.of("Society claim"));
        if (!SocietyClaimStatuses.PENDING.equals(row.getStatus())) {
            // Re-deciding rewrites decidedBy/decidedAt, so the record of who handed this society
            // over is lost. Worse, re-approving a rejected claim silently transfers the residency
            // register to someone an operator already turned down. The row lock above is what makes
            // this check hold under two simultaneous operators; without it both read `pending`.
            throw new ConflictException("This claim has already been decided.");
        }
        Society society = societies.findById(row.getSocietyId())
                .orElseThrow(() -> NotFoundException.of("Society"));

        row.decide(body.status(), decidedBy, body.note());
        claims.save(row);
        societies.updateClaimStatus(society.getId(), row.isApproved()
                ? com.draazy.api.catalog.society.SocietyClaimStatus.CLAIMED
                : com.draazy.api.catalog.society.SocietyClaimStatus.UNCLAIMED);
        if (row.isApproved()) {
            residents.reassignPendingQueue(society.getId(), SocietyResidentQueues.COMMITTEE);
        }
        return toResponse(row, society);
    }

    /* -------------------------------------------------------------- internals */

    /**
     * The public face of a claim: no contact details, no proof.
     *
     * <p>Package-private and called by {@link SocietyMembershipService#membership}, which is the one
     * place outside this service that has to render a claim. It lives here rather than there because
     * <em>what a claim discloses to whom</em> is this service's rule to keep — a second copy beside
     * the caller is how a field gets added in one and forgotten in the other.
     *
     * <p>The proof goes with the mobile and the email rather than staying on: an unreviewed claim is
     * an assertion, and publishing a registration number nobody has checked yet states it as the
     * building's on a page a stranger can load. The certificate reference is withheld for the
     * sharper version of the same reason — it points into the claimant's private vault.
     */
    SocietyClaimResponse publicView(SocietyClaim claim, Society society) {
        SocietyClaimResponse c = toResponse(claim, society);
        return new SocietyClaimResponse(c.id(), c.societySlug(), c.societyName(), c.claimantName(),
                null, c.role(), null, c.note(), null, null, c.status(), c.createdAt(),
                c.decidedAt());
    }

    /**
     * Resolve the optional certificate reference against the claimant's own document vault.
     *
     * <p>Checked here rather than left to the foreign key, on two counts. An id that is in no vault
     * would otherwise surface as a generic conflict naming no field; and — the count that matters —
     * an id belonging to <em>somebody else</em> would satisfy the constraint perfectly, so a
     * claimant could aim an operator at a stranger's Aadhaar scan and have it opened as evidence.
     *
     * <p>One message for both failures. Saying "that document exists but is not yours" would make
     * this endpoint an oracle for the existence of other people's files, which is the same reason
     * the vault's own delete answers 404 and never 403.
     */
    private UUID certificate(UUID claimantId, String documentId) {
        if (documentId == null || documentId.isBlank()) {
            return null;
        }
        return Ids.parseUuid(documentId)
                .filter(id -> vault.isOwnedBy(id, claimantId))
                .orElseThrow(() -> new BadRequestException(
                        "certificateDocumentId is not a document in your vault"));
    }

    private SocietyClaimResponse toResponse(SocietyClaim c, Society society) {
        User claimant = users.findById(c.getClaimedBy()).orElse(null);
        return new SocietyClaimResponse(c.getId(), society.getSlug(), society.getName(),
                c.getName(), claimant == null ? null : claimant.getMobile(), c.getRole(),
                c.getEmail(), c.getNote(), c.getRegistrationNo(),
                c.getCertificateDocumentId() == null ? null
                        : c.getCertificateDocumentId().toString(),
                c.getStatus(), c.getCreatedAt(), c.getDecidedAt());
    }

    /** One lookup for a whole page rather than one per row. */
    private Map<UUID, Society> societiesOf(List<UUID> ids) {
        Map<UUID, Society> byId = new LinkedHashMap<>();
        if (!ids.isEmpty()) {
            societies.findAllById(ids).forEach(s -> byId.put(s.getId(), s));
        }
        return byId;
    }

    private Society society(String slug) {
        return societies.findBySlug(slug).orElseThrow(() -> NotFoundException.of("Society"));
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }
}
