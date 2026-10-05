package com.draazy.api.common.audit;

import java.util.Map;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

public final class AuditMetadata {

    private static final ObjectMapper JSON = JsonMapper.builder().build();
    private static final TypeReference<Map<String, Object>> TYPE = new TypeReference<>() {
    };

    private AuditMetadata() {
    }

    // Bad metadata must not hide the rest of the log when an operator is investigating.
    public static Map<String, Object> parse(String raw) {
        if (raw == null || raw.isBlank()) {
            return Map.of();
        }
        try {
            return JSON.readValue(raw, TYPE);
        } catch (RuntimeException unparseable) {
            return Map.of();
        }
    }
}
