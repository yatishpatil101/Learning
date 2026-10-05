package com.draazy.api.catalog.property;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

public record ListingProgress(String track, String step, List<String> flags) {

    private static final Set<String> IN_FUNNEL = Set.of(
            PropertyStatus.PENDING, PropertyStatus.APPROVED, PropertyStatus.REJECTED, PropertyStatus.FLAGGED);
    private static final Set<String> OWNER_FLAGS = Set.of("needs_info", "rejected");

    public static ListingProgress of(Property p, boolean backOffice) {
        if (p.isArchived() || !IN_FUNNEL.contains(p.getStatus())) {
            return null;
        }
        boolean staff = p.isPostedByAdmin();
        String status = p.getStatus();
        List<String> flags = new ArrayList<>();
        if (p.isAwaitingOwnerInfo()) {
            flags.add("needs_info");
        }
        if (PropertyStatus.REJECTED.equals(status)) {
            flags.add("rejected");
        }
        if (PropertyStatus.FLAGGED.equals(status)) {
            flags.add("flagged");
        }
        if (!PropertyStatus.APPROVED.equals(status) && (p.getImages() == null || p.getImages().isEmpty())) {
            flags.add("no_photos");
        }
        if (staff && p.getClaimLinkOpenedAt() != null && p.getOwnerConfirmedAt() == null) {
            flags.add("opened");
        }
        if (p.isRecheckPending()) {
            flags.add("recheck");
        }
        if (!backOffice) {
            flags.retainAll(OWNER_FLAGS);
        }
        return new ListingProgress(staff ? "staff" : "owner", step(p, staff), List.copyOf(flags));
    }

    private static String step(Property p, boolean staff) {
        String status = p.getStatus();
        if (PropertyStatus.APPROVED.equals(status)) {
            return "live";
        }
        boolean reviewing = p.getReviewStartedAt() != null
                || PropertyStatus.REJECTED.equals(status) || PropertyStatus.FLAGGED.equals(status);
        if (!staff) {
            return reviewing ? "in_review" : "submitted";
        }
        if (p.getOwnerConfirmedAt() != null) {
            return reviewing ? "in_review" : "owner_confirmed";
        }
        return p.getClaimLinkSentAt() != null ? "link_sent" : "created";
    }
}
