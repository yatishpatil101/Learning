package com.punenest.api.common.settings;

import com.punenest.api.common.web.Routes;
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
 * {@code GET /flags} — the feature toggles that decide what the client renders.
 *
 * <p><strong>Why a public route exists at all, when the same values are already in
 * {@code /admin/settings}.</strong> Because that endpoint is admin-only in both directions and
 * should stay that way: the document it serves also holds the fee table and the permission map, and
 * "what does this platform charge" and "which team may do what" are privileged answers. The flag
 * block is not. It gates the map view, the EMI calculator, the referral offer and whether signups
 * are open — decisions the browser has to make for a visitor who has never signed in and may never
 * do so. A value that governs what an anonymous person sees cannot be readable only by an
 * administrator.
 *
 * <p><strong>What it was doing instead, and why that was a defect rather than a shortcut.</strong>
 * The client kept its own copy in local storage. So an operator could switch maintenance mode on,
 * be told it saved — it did save — and watch the site carry on serving, because the only reader was
 * a browser that never asked. That is the worst shape a kill switch can have: it fails silently, and
 * it fails at exactly the moment somebody is reaching for it.
 *
 * <p><strong>Scope is deliberately one block.</strong> This is not "the public settings endpoint",
 * and it should not grow into one. It publishes {@code settings.flags} and nothing else — not
 * {@code adminFlags}, which describes the back office; not {@code fees}, which has its own public
 * route with its own shape; not {@code permissions}, which is access control. The next block that
 * needs an anonymous reader gets its own route and has to make its own case.
 *
 * <p><strong>No service layer</strong>, for the same reason {@code FeeController} has none: there is
 * no decision to make between the row and the wire beyond parsing it, and a class whose whole body
 * is a delegation is not a layer.
 */
@RestController
public class AppFlagsController {

    private static final Logger log = LoggerFactory.getLogger(AppFlagsController.class);

    /** The seeded key holding the flag block (see {@code R__seed_reference_data.sql}). */
    private static final String FLAGS_KEY = "flags";

    private final SettingRepository settings;
    private final ObjectMapper objectMapper;

    public AppFlagsController(SettingRepository settings, ObjectMapper objectMapper) {
        this.settings = settings;
        this.objectMapper = objectMapper;
    }

    /**
     * {@code GET /flags} — every explicitly-set boolean toggle.
     *
     * <p><strong>Absent means on, so a thin answer is a valid one.</strong> The client's test is
     * {@code flags[key] !== false}: a flag nobody has ever touched is enabled. That is what makes
     * shipping a feature a code change rather than a code change plus a config row, and it means
     * this response only has to carry the toggles somebody has actually decided about. The seeded
     * document holds three; an empty object is a correct answer for a fresh install, not an error.
     *
     * <p><strong>Non-booleans are dropped rather than forwarded.</strong> The contract types this
     * map as booleans and the client compares against {@code false}, so a {@code "false"} string
     * left in by a hand-edited row would read as <em>enabled</em> either way — passing it through
     * buys nothing and makes the response a lie about its own schema.
     *
     * <p>A missing or unparseable row answers {@code {}} rather than failing. Every consumer of this
     * endpoint is a page render, and the alternative to defaulting is a blank site because somebody
     * mistyped a config value.
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
