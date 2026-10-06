package com.draazy.api.common.settings;

import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Not an enforcement point: api-standards.md §4.4. */
@Component
public class AppFlagsController {

    private static final Logger log = LoggerFactory.getLogger(AppFlagsController.class);

    /** The seeded key holding the flag block. Shared so the two readers cannot drift apart. */
    private static final String FLAGS_KEY = PlatformSettings.FLAGS_KEY;

    private final SettingsCache settings;
    private final ObjectMapper objectMapper;

    public AppFlagsController(SettingsCache settings, ObjectMapper objectMapper) {
        this.settings = settings;
        this.objectMapper = objectMapper;
    }

    /** Absent means on, non-booleans are dropped, and an unreadable row serves {@code {}}: api-standards.md §4.4. */
    public Map<String, Boolean> flags() {
        Map<String, Boolean> out = new LinkedHashMap<>();
        settings.value(FLAGS_KEY).ifPresent(row -> {
            JsonNode parsed;
            try {
                parsed = objectMapper.readTree(row);
            } catch (RuntimeException e) {
                log.warn("settings.{} is not parseable JSON; serving no flags", FLAGS_KEY, e);
                return;
            }
            if (!parsed.isObject()) {
                log.warn("settings.{} is not a JSON object; serving no flags", FLAGS_KEY);
                return;
            }
            parsed.properties().forEach(entry -> {
                if (entry.getValue().isBoolean()) {
                    out.put(entry.getKey(), entry.getValue().booleanValue());
                }
            });
        });
        return out;
    }
}
