package com.draazy.api.common.settings;

import java.util.Map;

/** {@code items} is an open map because the pack's contents are a merchandising decision; non-numeric entries are dropped,
 * as a hand-edited {@code "8000"} would disagree with the integer contract. Prices are whole rupees. */
public record MovePackResponse(
        boolean enabled,
        Map<String, Integer> items) {
}
