package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.Property;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * The read half of the ownership badge: which required facts are unproven, when the set stops
 * holding, and what may be shown to whom. A pure function, so a lapse needs no sweep job.
 */
final class OwnershipGate {

    private OwnershipGate() {
    }

    /**
     * The gate, evaluated against a moment: which of the deal's required facts have no current
     * document, and when the whole set first stops holding ({@code until} null if never).
     */
    record State(List<String> missing, Instant until) {
    }

    /**
     * Per fact the <em>strongest</em> current document wins, so a newer bill extends the badge.
     * Across facts the <em>earliest</em> expiry wins — the badge is only as good as its weakest leg.
     */
    static State evaluate(Property property, List<OwnershipEvidence> rows, Instant now) {
        List<String> missing = new ArrayList<>();
        Instant until = null;
        for (String kind : OwnershipEvidenceTypes.requiredKinds(property.getDeal())) {
            boolean satisfied = false;
            Instant strongest = null;
            for (OwnershipEvidence row : rows) {
                if (!kind.equals(row.kind()) || !row.isCurrentAt(now)) {
                    continue;
                }
                // A pre-V66 identity row can carry no subject_name; it says a document was seen
                // without saying whose, so it cannot satisfy its fact.
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
        return new State(List.copyOf(missing), until);
    }

    /**
     * An owner sees which fact is missing and whether each document is current; doc type, vault id
     * and subject name are staff-only, being third-party personal data under the DPDP Act.
     */
    static OwnershipVerificationResponse toResponse(Property property,
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
                evaluate(property, rows, now).missing(),
                wire);
    }
}
