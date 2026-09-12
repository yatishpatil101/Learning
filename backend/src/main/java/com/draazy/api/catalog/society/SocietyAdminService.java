package com.draazy.api.catalog.society;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.security.AuthPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The back office editing a society's own facts, on the server, once, for everybody.
 *
 * <p><strong>What this replaces.</strong> {@code AdminSocieties.jsx} has always had this form, and
 * {@code saveEdit} has always written it into {@code dzSocietyOverlay} in the operator's own
 * localStorage. The same failure as the candidates queue before V105 and the merges before V111,
 * with the sharpest consequence of the three: four of these five fields are what a buyer reads to
 * decide whether a building's paperwork is in order. An operator who checked a conveyance deed,
 * ticked the box and was told it saved changed nothing anyone would ever see, and the next operator
 * opening the same society found it exactly as before.
 *
 * <p><strong>Why a service and not a controller with a repository in it.</strong> {@code
 * MovePackController} makes the opposite call and is right to: there is no decision between its row
 * and the wire. Here there are three — the claim vocabulary, the note's blank-versus-absent
 * distinction, and the audit entry — and the last of those is the one that would rot fastest if it
 * lived beside the request mapping.
 *
 * <p><strong>Why it is audited when the sibling ops actions are not.</strong> Same test {@link
 * SocietyMergeService} applies: an action is audited when performing it destroys the evidence of
 * what was there before. Verification and claim decisions stamp their own row and are their own
 * record; this one overwrites four columns in place, so after the write nothing in the database says
 * what the maintenance figure used to be or that anybody changed it. The entry therefore carries the
 * <em>old</em> values — the new ones are in the row.
 *
 * <p><strong>{@code claimStatus} overlaps the claim desk, deliberately.</strong> The proper way for
 * a society to become {@code claimed} is a resident proving it and an operator approving the proof
 * in {@code engagement.society}, which records who decided and when. This route sets the column
 * directly, because the console has always offered it and an operator does occasionally have to
 * correct a status that a withdrawn or mistaken claim left wrong. It is the one field here whose
 * every use is worth reading in the audit log.
 */
@Service
@Transactional
public class SocietyAdminService {

    private final SocietyRepository societies;
    private final AuditService audit;

    public SocietyAdminService(SocietyRepository societies, AuditService audit) {
        this.societies = societies;
        this.audit = audit;
    }

    /**
     * One society as the back-office editor needs it.
     *
     * <p>Read-only, so no audit entry: reading a note destroys no evidence, and an audit log that
     * records every glance is one nobody reads when it matters.
     */
    @Transactional(readOnly = true)
    public SocietyAdminResponse get(String slug) {
        return SocietyAdminResponse.of(
                societies.findBySlug(slug).orElseThrow(() -> NotFoundException.of("Society")));
    }

    /**
     * Apply an operator's edit to one society and hand back the row as it now stands.
     *
     * <p>The society is read before the write and again after it. The first read is what the audit
     * entry needs and what a 404 comes out of; the second is because the update is coalesced, so the
     * effective value of a field the request omitted is whatever was already there rather than
     * anything the caller said. Echoing the request back would be a guess that is wrong precisely
     * when somebody is debugging why their edit did not take.
     */
    public SocietyAdminResponse edit(String slug, SocietyAdminEditRequest request, AuthPrincipal operator) {
        String claimStatus = request.claimStatus();
        if (claimStatus != null && !SocietyClaimStatus.ALL.contains(claimStatus)) {
            throw new ValidationException("Claim status must be unclaimed, pending or claimed.");
        }
        Society before = societies.findBySlug(slug).orElseThrow(() -> NotFoundException.of("Society"));

        // A note that arrived blank is stored as null: "no note" has one representation, so the
        // console cannot render a cleared note differently from one that never existed.
        boolean noteGiven = request.adminNote() != null;
        String note = noteGiven && !request.adminNote().isBlank() ? request.adminNote().trim() : null;

        societies.applyAdminEdit(before.getId(), request.registration(), request.conveyance(),
                request.maintenancePerSqft(), claimStatus, noteGiven, note);

        audit.record(operator, "society.edit", "society", slug,
                "wasRegistration", before.isRegistration(),
                "wasConveyance", before.isConveyance(),
                "wasMaintenancePerSqft", before.getMaintenancePerSqft(),
                "wasClaimStatus", before.getClaimStatus(),
                "hadNote", before.getAdminNote() != null);

        return SocietyAdminResponse.of(
                societies.findBySlug(slug).orElseThrow(() -> NotFoundException.of("Society")));
    }
}
