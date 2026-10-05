package com.draazy.api.moderation.verification;

import com.draazy.api.catalog.property.Property;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

// Pure function so a lapsed badge needs no sweep job.
final class OwnershipGate {

    private OwnershipGate() {
    }

    // until is null when the whole set never expires.
    record State(List<String> missing, Instant until) {
    }

    // Strongest current document wins per fact; earliest expiry wins across facts.
    static State evaluate(Property property, List<OwnershipEvidence> rows, Instant now) {
        List<String> missing = new ArrayList<>();
        Instant until = null;
        for (var alternatives : OwnershipEvidenceTypes.requiredKindAlternatives(property.getDeal())) {
            Alternative best = bestCurrent(rows, alternatives, now);
            if (!best.satisfied()) {
                missing.add(OwnershipEvidenceTypes.missingLabel(alternatives));
            } else if (best.expiresAt() != null && (until == null || best.expiresAt().isBefore(until))) {
                until = best.expiresAt();
            }
        }
        return new State(List.copyOf(missing), until);
    }

    private record Alternative(boolean satisfied, Instant expiresAt) {
    }

    private static Alternative bestCurrent(List<OwnershipEvidence> rows, java.util.Set<String> alternatives,
            Instant now) {
        Instant strongest = null;
        boolean satisfied = false;
        for (OwnershipEvidence row : rows) {
            if (!alternatives.contains(row.kind()) || !satisfies(row, row.kind(), now)) {
                continue;
            }
            satisfied = true;
            if (row.getExpiresAt() == null) {
                return new Alternative(true, null);
            }
            if (strongest == null || row.getExpiresAt().isAfter(strongest)) {
                strongest = row.getExpiresAt();
            }
        }
        return new Alternative(satisfied, strongest);
    }

    private static boolean satisfies(OwnershipEvidence row, String kind, Instant now) {
        if (!kind.equals(row.kind()) || !row.isCurrentAt(now)) {
            return false;
        }
        return !OwnershipEvidenceTypes.namesASubject(row.getDocType()) || row.getSubjectName() != null;
    }

    // Owners see facts and currency only; doc ids and subject names are staff-only DPDP data.
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
                wire,
                property.getOwnershipRequestedAt(),
                property.getOwnershipDeclinedAt(),
                property.getOwnershipDeclinedReason());
    }
}
