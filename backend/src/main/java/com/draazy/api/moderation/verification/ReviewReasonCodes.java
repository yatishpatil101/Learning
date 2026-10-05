package com.draazy.api.moderation.verification;

import com.draazy.api.common.error.BadRequestException;
import java.util.Set;

public final class ReviewReasonCodes {
    public static final Set<String> ALL = Set.of("photos_not_real", "duplicate", "broker",
            "wrong_details", "locality_unclear", "document_unreadable", "name_mismatch", "other");

    private ReviewReasonCodes() {
    }

    public static String require(String decision, String reasonCode, String note) {
        if (!"needs_info".equals(decision) && !"reject".equals(decision)) {
            return null;
        }
        if (reasonCode == null || reasonCode.isBlank()) {
            throw new BadRequestException("reason_code_required", "reasonCode is required for " + decision);
        }
        String normalized = reasonCode.trim();
        if (!ALL.contains(normalized)) {
            throw new BadRequestException("invalid_reason_code",
                    "reasonCode must be one of " + String.join(", ", ALL.stream().sorted().toList()));
        }
        if ("other".equals(normalized) && (note == null || note.isBlank())) {
            throw new BadRequestException("reason_note_required", "note is required when reasonCode is other");
        }
        return normalized;
    }

    public static String ownerMessage(String reasonCode, String note) {
        String message = switch (reasonCode) {
            case "photos_not_real" -> "Please add clear photos of the actual property.";
            case "duplicate" -> "Please tell us why this is not a duplicate listing.";
            case "broker" -> "Please confirm that you are the owner or family, not a broker.";
            case "wrong_details" -> "Please correct the listing details.";
            case "locality_unclear" -> "Please clarify the exact locality.";
            case "document_unreadable" -> "Please upload a readable document.";
            case "name_mismatch" -> "Please explain the name mismatch.";
            default -> "Please share the missing information.";
        };
        return note == null || note.isBlank() ? message : message + " " + note.trim();
    }
}
