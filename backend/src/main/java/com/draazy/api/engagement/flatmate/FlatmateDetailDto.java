package com.draazy.api.engagement.flatmate;

import java.util.List;

public record FlatmateDetailDto(String kind, boolean owned, Object item, List<String> photos,
        Verification verification) {

    static final String KIND_GROUP = "group";
    static final String KIND_ROOM = "room";
    static final String KIND_POST = "post";

    public record Verification(String status, boolean ownerConsent, String reason) {

        static Verification of(FlatmateReview review) {
            return new Verification(review.getStatus(), review.isOwnerConsent(),
                    review.getReason());
        }
    }

    static FlatmateDetailDto owned(String kind, Object item, List<String> photos,
            Verification verification) {
        return new FlatmateDetailDto(kind, true, item, photos, verification);
    }

    static FlatmateDetailDto visitor(String kind, Object item, List<String> photos) {
        return new FlatmateDetailDto(kind, false, item, photos, null);
    }
}
