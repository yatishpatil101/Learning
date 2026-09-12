package com.draazy.api.common.settings;

import com.draazy.api.common.web.Routes;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * {@code GET /flags} — the feature toggles that decide what the client renders. Public, scoped to
 * the {@code settings.flags} block alone, and not an enforcement point: api-standards.md §4.4.
 */
@RestController
public class AppFlagsController {

    private static final Logger log = LoggerFactory.getLogger(AppFlagsController.class);

    /** The seeded key holding the flag block. Shared so the two readers cannot drift apart. */
    private static final String FLAGS_KEY = PlatformSettings.FLAGS_KEY;

    private final SettingRepository settings;
    private final ObjectMapper objectMapper;

    public AppFlagsController(SettingRepository settings, ObjectMapper objectMapper) {
        this.settings = settings;
        this.objectMapper = objectMapper;
    }

    /**
     * {@code GET /flags} — every explicitly-set boolean toggle. Absent means on, non-booleans are
     * dropped, and an unreadable row serves {@code {}}: docs/system/api-standards.md §4.4.
     */
    @GetMapping(Routes.Flags.BASE)
    @Transactional(readOnly = true)
    public Map<String, Boolean> flags() {
        Map<String, Boolean> out = new LinkedHashMap<>();
        settings.findById(FLAGS_KEY).ifPresent(row -> {
            JsonNode parsed;
            try {
                parsed = objectMapper.readTree(row.getValue());
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
