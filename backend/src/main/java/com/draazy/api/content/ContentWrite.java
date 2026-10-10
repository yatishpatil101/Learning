package com.draazy.api.content;

import java.util.Map;

/** Nullable: on PATCH {@code null} leaves a field alone. {@code translations} is replaced whole, so a deleted
 * translation stays deletable: {@code null} keeps the map, {@code {}} removes every language. */
public record ContentWrite(
        String question,
        String answer,
        String category,
        Map<String, Map<String, String>> translations) {
}