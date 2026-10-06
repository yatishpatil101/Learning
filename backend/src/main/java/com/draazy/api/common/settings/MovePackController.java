package com.draazy.api.common.settings;

import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Absent means off, unlike a flag: silence about a price is never a yes, so a missing or malformed row answers {@code enabled: false}. */
@Component
public class MovePackController {

    private static final Logger log = LoggerFactory.getLogger(MovePackController.class);

    /** The settings key holding the pack block (see {@code R__DML_seed_reference_data.sql}). */
    private static final String MOVE_PACK_KEY = "movePack";

    /** The block's launch switch. */
    private static final String ENABLED_FIELD = "enabled";

    /** The block's price map, keyed by item slug. */
    private static final String ITEMS_FIELD = "items";

    /** Immutable via {@link Map#of()}, so the not-on-sale fallback can't be mutated. */
    private static final MovePackResponse COMING_SOON = new MovePackResponse(false, Map.of());

    private final SettingsCache settings;
    private final ObjectMapper objectMapper;

    public MovePackController(SettingsCache settings, ObjectMapper objectMapper) {
        this.settings = settings;
        this.objectMapper = objectMapper;
    }

    /** Never fails on bad configuration; the default is coming-soon mode, which shows no numbers and takes no payment. */
    public MovePackResponse movePack() {
        return settings.value(MOVE_PACK_KEY)
                .map(row -> {
                    JsonNode parsed;
                    try {
                        parsed = objectMapper.readTree(row);
                    } catch (RuntimeException e) {
                        log.warn("settings.{} is not parseable JSON; pack stays in coming-soon mode",
                                MOVE_PACK_KEY, e);
                        return COMING_SOON;
                    }
                    if (!parsed.isObject()) {
                        log.warn("settings.{} is not a JSON object; pack stays in coming-soon mode",
                                MOVE_PACK_KEY);
                        return COMING_SOON;
                    }
                    JsonNode enabled = parsed.get(ENABLED_FIELD);
                    return new MovePackResponse(
                            enabled != null && enabled.isBoolean() && enabled.booleanValue(),
                            prices(parsed.get(ITEMS_FIELD)));
                })
                .orElse(COMING_SOON);
    }

    /** Drops non-integral or negative prices rather than clamping, which would invent a number. */
    private static Map<String, Integer> prices(JsonNode items) {
        Map<String, Integer> out = new LinkedHashMap<>();
        if (items == null || !items.isObject()) {
            return out;
        }
        items.properties().forEach(entry -> {
            JsonNode value = entry.getValue();
            if (value.isIntegralNumber() && value.canConvertToInt() && value.intValue() >= 0) {
                out.put(entry.getKey(), value.intValue());
            }
        });
        return out;
    }
}
