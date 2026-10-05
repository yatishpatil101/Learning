package com.draazy.api.engagement.flatmate;

import java.util.UUID;

final class FlatmateLinks {

    static final String BOARD = "/flatmates";

    private FlatmateLinks() {
    }

    static String of(String kind, UUID id) {
        if (id == null || kind == null) {
            return BOARD;
        }
        return switch (kind) {
            case "room" -> BOARD + "/room/" + id;
            case "group" -> BOARD + "/group/" + id;
            case "flatmate", "post" -> BOARD + "/post/" + id;
            default -> BOARD;
        };
    }

    static String of(FlatmateReview review) {
        if (review.getRoomId() != null) {
            return of("room", review.getRoomId());
        }
        return of("group", review.getGroupId());
    }
}
