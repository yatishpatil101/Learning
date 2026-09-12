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
 * {@code GET /move-pack} — whether the Move-in Pack is on sale, and its price list.
 *
 * <p><strong>Why this exists.</strong> The consumer services page read this block out of local
 * storage, so the {@code settings} domain being live changed nothing on it: an operator could
 * publish the pack, be told it saved — it did save — and watch the page carry on showing "coming
 * soon". The write was real and the read was not, which is the same defect {@code /flags} was
 * created to fix, one block over.
 *
 * <p><strong>Why not another key on {@code /flags}.</strong> That endpoint's contract is {@code map
 * of boolean} and it drops non-booleans deliberately, so it cannot carry a price list without
 * giving up the guarantee that makes it safe to read blindly. Its own documentation asks the next
 * block needing a public reader to make its own case rather than move in, and {@code FeeController}
 * is the shape it points at: public, its own route, its own schema, no service layer.
 *
 * <p><strong>Why absent means <em>off</em> here, where absent means <em>on</em> for a flag.</strong>
 * This is the one place these two endpoints must not agree. A flag nobody has configured is enabled,
 * so that shipping a feature is a code change rather than a code change plus a config row. Applying
 * that rule to a price would mean an unconfigured install offering to sell a service at a number
 * nobody chose. Silence about a feature is a reasonable yes; silence about a price is never one, so
 * a missing, unparseable or malformed row answers {@code enabled: false} with no prices — which
 * puts the page in coming-soon mode and captures a waitlist signup instead of taking money.
 *
 * <p><strong>No service layer</strong>, for the reason {@code FeeController} has none: there is no
 * decision between the row and the wire beyond parsing it, and a class whose whole body is a
 * delegation is not a layer.
 */
@RestController
public class MovePackController {

    private static final Logger log = LoggerFactory.getLogger(MovePackController.class);

    /** The settings key holding the pack block (see {@code R__DML_seed_reference_data.sql}). */
    private static final String MOVE_PACK_KEY = "movePack";

    /** The block's launch switch. */
    private static final String ENABLED_FIELD = "enabled";

    /** The block's price map, keyed by item slug. */
    private static final String ITEMS_FIELD = "items";

    /**
     * Answered when the row is missing or unusable: the pack is not on sale and there are no
     * prices. Deliberately not a constant anyone can mutate — {@link Map#of()} is immutable.
     */
    private static final MovePackResponse COMING_SOON = new MovePackResponse(false, Map.of());

    private final SettingRepository settings;
    private final ObjectMapper objectMapper;

    public MovePackController(SettingRepository settings, ObjectMapper objectMapper) {
        this.settings = settings;
        this.objectMapper = objectMapper;
    }

    /**
     * {@code GET /move-pack} — the pack's launch state and prices.
     *
     * <p>Never fails on bad configuration. Every consumer of this endpoint is a page render, and the
     * alternative to defaulting is a broken services page because somebody mistyped a price. The
     * default is the safe direction rather than merely a quiet one: coming-soon mode shows no
     * numbers and takes no payment.
     */
    @GetMapping(Routes.MovePack.BASE)
    @Transactional(readOnly = true)
    public MovePackResponse movePack() {
        return settings.findById(MOVE_PACK_KEY)
                .map(row -> {
                    JsonNode parsed;
                    try {
                        parsed = objectMapper.readTree(row.getValue());
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

    /**
     * The price map, keeping only entries that are actually whole-rupee numbers.
     *
     * <p>A non-integral or negative price is dropped rather than clamped. Clamping would invent a
     * number, and the page treats a missing item as one it cannot sell yet — which is the honest
     * reading of a price nobody has validly set.
     */
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
