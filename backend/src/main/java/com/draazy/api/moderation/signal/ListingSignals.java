package com.draazy.api.moderation.signal;

import java.util.List;

public record ListingSignals(
        boolean possibleBroker,
        boolean hardBlock,
        boolean conflict,
        List<Item> items) {

    public static final ListingSignals NONE = new ListingSignals(false, false, false, List.of());

    public record Item(String code, String severity, String detail) {
    }
}
