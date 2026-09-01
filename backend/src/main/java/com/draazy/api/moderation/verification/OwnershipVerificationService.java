package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.VerificationAnnouncer;
import com.draazy.api.common.web.Ids;
import com.draazy.api.documents.vault.Document;
import com.draazy.api.documents.vault.DocumentRepository;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The ownership gate (D190/Q15): how the <strong>Ownership Verified</strong> badge is earned, and
 * how it lapses.
 *
 * <p>Before this existed {@code properties.ownership_verified} was written by the demo seed and by
 * nothing else — the strongest trust signal the product sells on could not be earned, only asserted.
 * Here it is earned by recording evidence and clearing a gate of three independent facts
 * ({@link OwnershipEvidenceTypes}), all of which must be established by a document that is still
 * current.
 *
 * <p><strong>Why this lives in {@code moderation} rather than {@code catalog}.</strong> Accepting
 * evidence is an ops decision with a maker and a checker, which is what this package is; the
 * neighbouring {@link PropertyVerificationService} already owns the owner&lt;-&gt;ops half of the
 * same workflow. It also has to read the documents vault, which {@code catalog} ranks below and may
 * not import.
 *
 * <p><strong>Why the announcement goes through a port.</strong> The referral credit in
 * {@code billing} is downstream of verification, and {@link VerificationAnnouncer} is how it is
 * told. From {@code moderation} a direct call would in fact compile — {@code moderation} ranks
 * above {@code billing} — but the port is still the right seam: it keeps the announcement
 * independent of where verification happens to be written today, and it is what the contract for
 * that credit is expressed in. The call is made inside this transaction on purpose, so a rollback
 * takes the credit with it.
 *
 * <p><strong>Nobody verifies their own listing.</strong> Roles here are additive — a staff member
 * is also somebody's landlord — so holding the staff role is not on its own enough to write on a
 * listing. Every write below refuses the owner, the same rule and for the same reason as
 * {@code verificationDecision}: the maker and the checker have to be different people, or the badge
 * is self-service.
 *
 * <p>Reads are participant-or-staff and answer <strong>404, not 403</strong>, matching
 * {@link PropertyVerificationService}: a 403 would confirm to a stranger that a listing with that
 * id exists.
 */
@Service
public class OwnershipVerificationService {

    private final OwnershipEvidenceRepository evidence;
    private final PropertyRepository properties;
    private final DocumentRepository documents;
    private final AuditService audit;
    private final VerificationAnnouncer announcer;

    public OwnershipVerificationService(OwnershipEvidenceRepository evidence,
            PropertyRepository properties, DocumentRepository documents, AuditService audit,
            VerificationAnnouncer announcer) {
        this.evidence = evidence;
        this.properties = properties;
        this.documents = documents;
        this.audit = audit;
        this.announcer = announcer;
    }

    /**
     * {@code GET /properties/{id}/verification/ownership} — the case file. Participant-or-staff, so
     * an owner can see which of the three facts their listing is still waiting on.
     */
    @Transactional(readOnly = true)
    public OwnershipVerificationResponse get(AuthPrincipal actor, String propertyId) {
        Property property = participantProperty(actor, propertyId);
        return toResponse(property, evidence.findByPropertyIdOrderByIssuedAtDesc(property.getId()),
                Instant.now(), isStaff(actor));
    }

    /**
     * {@code POST /properties/{id}/verification/ownership/evidence} — staff/admin record one
     * document they have sighted or received.
     *
     * <p>Recording evidence never grants the badge. That is a separate call by design: the gate is
     * a judgement about a set of documents taken together, and a system where uploading the third
     * file silently promotes a listing is one where nobody decided anything.
     *
     * @param issuedAt when the document was issued or the photographs taken — the caller supplies
     *                 it because only the caller can read it off the document, and deriving it from
     *                 the clock would let a decade-old receipt mint a fresh badge
     * @param subjectName whose identity the document is, for the two doc types whose purpose is to
     *                    name a person (D202). Required there and refused as blank: an
     *                    {@code owner_identity} row that does not say whose identity was sighted
     *                    cannot be contradicted by anything, and an assertion nobody can contradict
     *                    is not evidence
     */
    @Transactional
    public OwnershipVerificationResponse recordEvidence(AuthPrincipal actor, String propertyId,
            String docType, String documentId, Instant issuedAt, String subjectName) {
        Property property = otherPersonsProperty(actor, propertyId);
        Instant now = Instant.now();
        if (!OwnershipEvidenceTypes.isKnown(docType)) {
            throw new BadRequestException("docType must be one of " + OwnershipEvidenceTypes.DOC_TYPES);
        }
        if (issuedAt == null) {
            throw new BadRequestException("issuedAt is required");
        }
        if (issuedAt.isAfter(now)) {
            throw new BadRequestException("issuedAt cannot be in the future");
        }
        String subject = subjectName == null || subjectName.isBlank() ? null : subjectName.strip();
        if (subject == null && OwnershipEvidenceTypes.namesASubject(docType)) {
            throw new BadRequestException(
                    "subjectName is required for " + docType + ": an identity document is evidence "
                            + "of whose identity it is, and a row that does not say cannot be checked");
        }

        OwnershipEvidence saved = evidence.saveAndFlush(new OwnershipEvidence(property.getId(),
                docType, vaultDocument(property, documentId), issuedAt, actor.userId(), subject));
        // The row id and the vault reference, not just the type: an investigation into a badge
        // granted on a forgery needs to reach the artefact, and `document_id` is SET NULL on a vault
        // delete — after which the audit entry is the only surviving pointer.
        //
        // `subjectName` is deliberately NOT among them. It is a name off a government ID, the
        // audit log has no retention window, and `ErasureRetention` tells the subject in as many
        // words that they appear there "as an entity id, not as a name or a number" — a promise
        // that copying it here would quietly break. The evidence row is the record; the log points
        // at it.
        audit.record(actor, "property.ownership.evidence", "property", propertyId,
                "evidenceId", saved.getId().toString(), "docType", docType,
                "documentId", saved.getDocumentId() == null ? null : saved.getDocumentId().toString(),
                "issuedAt", issuedAt.toString());
        return toResponse(property, evidence.findByPropertyIdOrderByIssuedAtDesc(property.getId()),
                now, true);
    }

    /**
     * {@code POST /properties/{id}/verification/ownership} — staff/admin grant the badge.
     *
     * <p>Rejects with the missing facts named rather than a bare "not eligible", because an ops
     * screen that cannot say what is missing sends the operator to the database.
     *
     * <p>The announcement fires only on a transition <em>into</em> the verified state. Re-running
     * this on an already-verified listing extends the expiry without announcing again; running it
     * after a lapse does announce, which is the legitimate second transition
     * {@link VerificationAnnouncer} says implementations must tolerate.
     */
    @Transactional
    public OwnershipVerificationResponse verify(AuthPrincipal actor, String propertyId) {
        Property property = otherPersonsProperty(actor, propertyId);
        Instant now = Instant.now();
        List<OwnershipEvidence> rows = evidence.findByPropertyIdOrderByIssuedAtDesc(property.getId());
        Gate gate = gate(rows, now);
        if (!gate.missing().isEmpty()) {
            throw new BadRequestException("ownership evidence is incomplete: missing "
                    + String.join(", ", gate.missing()));
        }

        boolean wasVerified = property.isOwnershipVerifiedAt(now);
        property.verifyOwnership(now, gate.until());
        audit.record(actor, "property.ownership.verified", "property", propertyId,
                "until", gate.until() == null ? null : gate.until().toString(),
                "owner", String.valueOf(property.getOwner().getId()));
        if (!wasVerified) {
            announcer.announceOwnershipVerified(property.getOwner().getId(), property.getId(), now);
        }
        return toResponse(property, rows, now, true);
    }

    /**
     * {@code DELETE /properties/{id}/verification/ownership} — staff/admin withdraw the badge.
     *
     * <p>Distinct from a lapse, which needs no write at all. This is the path for evidence that
     * turns out to be forged, or to belong to a different flat. Without it a badge granted in error
     * could only be taken back with hand-written SQL, and a trust signal nobody can withdraw is
     * worse than one that was never granted.
     *
     * <p>The evidence rows are left in place. They are the record of what was accepted and by whom,
     * which is exactly what an investigation into a wrongly granted badge needs to read; deleting
     * them would erase the case at the moment it started to matter. Re-verifying afterwards is
     * therefore a second, deliberate judgement rather than an accident.
     *
     * <p>A reason is required, as it is for every other reversal in the product, and the audit entry
     * is written only when a badge was actually withdrawn — a log that records revocations of things
     * that were never granted is a log an investigator has to second-guess.
     */
    @Transactional
    public OwnershipVerificationResponse revoke(AuthPrincipal actor, String propertyId, String reason) {
        // Before the row lock, not after: a malformed request should not queue behind a concurrent
        // decision on the same listing only to be rejected on a field it could have been rejected
        // on immediately.
        if (reason == null || reason.isBlank()) {
            throw new BadRequestException("reason is required");
        }
        Property property = otherPersonsProperty(actor, propertyId);
        Instant now = Instant.now();
        if (property.isOwnershipVerifiedAt(now)) {
            property.revokeOwnershipVerification();
            audit.record(actor, "property.ownership.revoked", "property", propertyId,
                    "reason", reason, "owner", String.valueOf(property.getOwner().getId()));
        }
        return toResponse(property, evidence.findByPropertyIdOrderByIssuedAtDesc(property.getId()),
                now, true);
    }

    /**
     * The gate, evaluated against a moment: which of the three facts have no current document, and
     * when the whole set first stops holding.
     *
     * <p>Per fact, the <em>strongest</em> current document wins — a second, newer electricity bill
     * extends the badge rather than being averaged with the old one, and one never-expiring
     * registry document settles that fact permanently. Across facts the <em>earliest</em> expiry
     * wins, because the badge is only as good as its weakest leg.
     *
     * @param until {@code null} when no fact lapses. Not reachable with today's vocabulary, since
     *              site presence can only be established by photographs and those always expire.
     *              Kept because which documents expire is a product decision that will change, and
     *              a gate that assumed everything expires would be wrong the day it does
     */
    private record Gate(List<String> missing, Instant until) {
    }

    private static Gate gate(List<OwnershipEvidence> rows, Instant now) {
        List<String> missing = new ArrayList<>();
        Instant until = null;
        for (String kind : OwnershipEvidenceTypes.KINDS) {
            boolean satisfied = false;
            Instant strongest = null;
            for (OwnershipEvidence row : rows) {
                if (!kind.equals(row.kind()) || !row.isCurrentAt(now)) {
                    continue;
                }
                // A row written before V66 can be an identity document with no subject_name: the
                // constraint binds writes from V66 onward and cannot retrofit a name nobody
                // recorded. Such a row says an identity document was seen without saying whose,
                // which is precisely the assertion D202 exists to stop the badge resting on, so it
                // does not satisfy its fact. The listing simply stays unverified until ops re-sight
                // the document — which is the honest outcome, and cheap while the table is new.
                if (OwnershipEvidenceTypes.namesASubject(row.getDocType()) && row.getSubjectName() == null) {
                    continue;
                }
                satisfied = true;
                if (row.getExpiresAt() == null) {
                    strongest = null;
                    break;
                }
                if (strongest == null || row.getExpiresAt().isAfter(strongest)) {
                    strongest = row.getExpiresAt();
                }
            }
            if (!satisfied) {
                missing.add(kind);
            } else if (strongest != null && (until == null || strongest.isBefore(until))) {
                until = strongest;
            }
        }
        return new Gate(List.copyOf(missing), until);
    }

    /**
     * Resolve the optional vault reference.
     *
     * <p>Checked here rather than left to the foreign key, on two counts. An id that is not in the
     * vault would otherwise surface as a generic conflict naming no field; and — the count that
     * matters — an id belonging to a <em>different</em> listing would be accepted, letting one
     * flat's evidence cite another flat's title deed.
     */
    private UUID vaultDocument(Property property, String documentId) {
        if (documentId == null || documentId.isBlank()) {
            return null;
        }
        Document document = Ids.parseUuid(documentId)
                .flatMap(documents::findById)
                .orElseThrow(() -> new BadRequestException("documentId does not exist"));
        if (!property.getId().equals(document.getPropertyId())) {
            throw new BadRequestException("documentId belongs to a different listing");
        }
        return document.getId();
    }

    /**
     * @param staffView whether the caller is ops. An owner is shown <em>which fact</em> is missing
     *                  and whether each document is still current, and nothing else. The document
     *                  type is withheld because on an agent-posted or posted-on-behalf listing the
     *                  account that can read this is not necessarily the person whose identity
     *                  document was sighted, and "this individual produced an Aadhaar rather than a
     *                  PAN" is personal data under the DPDP Act. The vault id goes with it: an
     *                  identifier the owner cannot dereference is of no use to them and of some use
     *                  to an attacker who later can. {@code subjectName} is withheld for the
     *                  sharper version of the same reason — on those listings it is a third party's
     *                  name, and the owner is not the person it belongs to
     */
    private static OwnershipVerificationResponse toResponse(Property property,
            List<OwnershipEvidence> rows, Instant now, boolean staffView) {
        List<OwnershipVerificationResponse.Evidence> wire = rows.stream()
                .map(row -> new OwnershipVerificationResponse.Evidence(
                        row.getId().toString(),
                        staffView ? row.getDocType() : null,
                        row.kind(),
                        staffView && row.getDocumentId() != null ? row.getDocumentId().toString() : null,
                        staffView ? row.getSubjectName() : null,
                        row.getIssuedAt(),
                        row.getExpiresAt(),
                        row.isCurrentAt(now)))
                .toList();
        return new OwnershipVerificationResponse(
                property.getId().toString(),
                property.isOwnershipVerifiedAt(now),
                property.getOwnershipVerifiedAt(),
                property.getOwnershipVerifiedUntil(),
                gate(rows, now).missing(),
                wire);
    }

    private static boolean isStaff(AuthPrincipal actor) {
        return Roles.Wire.STAFF.equals(actor.role()) || Roles.Wire.ADMIN.equals(actor.role());
    }

    /** Load the listing and assert the caller is the owner or staff, else 404. */
    private Property participantProperty(AuthPrincipal actor, String propertyId) {
        Property property = load(propertyId);
        if (!isStaff(actor) && !actor.userId().equals(property.getOwner().getId())) {
            throw NotFoundException.of("Property");
        }
        return property;
    }

    /**
     * Load the listing for a write, under a row lock, and refuse its owner.
     *
     * <p>403 here rather than the read path's 404: the caller has already proved staff at the
     * annotation, so there is nothing left to conceal, and saying plainly that they may not check
     * their own listing is the difference between a rule and a bug.
     *
     * <p><strong>The lock (D202).</strong> All three writes are check-then-act on state this row
     * carries or the evidence hanging off it, and {@code verify} is the one that matters: two ops
     * users granting the badge at the same moment both read "not yet verified" and both announce,
     * which is a referral credit paid twice for one listing. Taken here rather than in
     * {@code verify} alone so that recording evidence serialises against a concurrent decision as
     * well — a gate evaluated against a half-written evidence set is the same bug one step earlier.
     */
    private Property otherPersonsProperty(AuthPrincipal actor, String propertyId) {
        Property property = Ids.parseUuid(propertyId)
                .flatMap(properties::findForVerificationDecision)
                .orElseThrow(() -> NotFoundException.of("Property"));
        if (actor.userId().equals(property.getOwner().getId())) {
            throw new ForbiddenException("You cannot verify the ownership of your own listing");
        }
        return property;
    }

    private Property load(String propertyId) {
        return Ids.parseUuid(propertyId)
                .flatMap(properties::findById)
                .orElseThrow(() -> NotFoundException.of("Property"));
    }
}
