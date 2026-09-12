package com.draazy.api.admin;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.PreconditionFailedException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.settings.Setting;
import com.draazy.api.common.settings.SettingRepository;
import com.draazy.api.security.AuthPrincipal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Read and write the platform configuration document behind {@code /admin/settings}.
 * Storage shape, merge, ETag and refusal rationale: docs/system/api-standards.md section 12.
 */
@Service
public class AdminSettingsService {

    private static final Logger log = LoggerFactory.getLogger(AdminSettingsService.class);

    /** Bounded because the merge recurses over attacker-influenced structure; unbounded means a
     * {@code StackOverflowError} in a request thread. */
    private static final int MAX_MERGE_DEPTH = 12;

    /** Top-level keys refused outright: configuration that would be stored and enforced by nothing.
     * A deny-list, not an allow-list, because the table is deliberately open. */
    private static final Set<String> UNSUPPORTED_KEYS = Set.of("customRoles");

    private final SettingRepository settings;
    private final ObjectMapper objectMapper;
    private final AuditService audit;

    public AdminSettingsService(SettingRepository settings, ObjectMapper objectMapper,
            AuditService audit) {
        this.settings = settings;
        this.objectMapper = objectMapper;
        this.audit = audit;
    }

    /**
     * {@code GET /admin/settings} - every stored block folded into one document, with its tag. An
     * unparseable row is skipped: an admin locked out cannot fix the row that locked them out.
     */
    @Transactional(readOnly = true)
    public SettingsDocument current() {
        Map<String, Object> document = new TreeMap<>();
        for (Setting row : settings.findAll()) {
            JsonNode value = parseOrNull(row.getKey(), row.getValue());
            if (value != null) {
                document.put(row.getKey(), objectMapper.convertValue(value, Object.class));
            }
        }
        return new SettingsDocument(document, etag());
    }

    /**
     * A strong content hash over every stored block, computed inside the transaction that produced
     * the body it describes. Rationale: docs/system/api-standards.md section 12.
     */
    private String etag() {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is required of every JRE", impossible);
        }
        for (Setting row : settings.findAll(Sort.by("key"))) {
            digest.update(row.getKey().getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            digest.update(row.getValue().getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
        }
        return "\"" + HexFormat.of().formatHex(digest.digest(), 0, 16) + "\"";
    }

    /**
     * {@code PUT /admin/settings} - deep-merge {@code patch} into what is stored, and return the
     * result. Merge, refusal order and {@code If-Match}: docs/system/api-standards.md section 12.
     */
    @Transactional
    public SettingsDocument update(AuthPrincipal caller, Map<String, Object> patch,
            String ifMatch) {
        rejectUnsupportedKeys(patch);
        requirePrecondition(ifMatch);
        List<String> touched = new ArrayList<>();
        for (Map.Entry<String, Object> entry : patch.entrySet()) {
            if (entry.getValue() == null) {
                // A null is "not changing this": a client that serialises its whole form cannot
                // distinguish it from a delete, and deleting would quietly unprice the platform.
                continue;
            }
            String key = entry.getKey();
            JsonNode incoming = objectMapper.valueToTree(entry.getValue());
            Setting row = settings.findById(key).orElseGet(() -> new Setting(key));
            JsonNode existing = parseOrNull(key, row.getValue());
            JsonNode merged = merge(existing, incoming, 0);
            row.setValue(objectMapper.writeValueAsString(merged));
            settings.save(row);
            touched.add(key);
        }
        audit.record(caller, "settings.update", "settings", "platform",
                "keys", String.join(",", touched));
        return current();
    }

    /**
     * Refuse anything that would be stored and enforced by nothing while the console reports it
     * saved. The three cases: docs/system/api-standards.md section 12.
     */
    private static void rejectUnsupportedKeys(Map<String, Object> patch) {
        for (String key : patch.keySet()) {
            if (UNSUPPORTED_KEYS.contains(key)) {
                throw new ValidationException("'" + key + "' is not supported by this server: it "
                        + "would be stored and enforced by nothing. Back-office access is decided by "
                        + "role, team and the 'permissions' allow-list. Nothing was saved.");
            }
        }
        rejectRetiredCityLive(patch);
        rejectNonBooleanFlags(patch);
    }

    /**
     * Refuse a leaf under {@code flags} that is not a JSON boolean: every reader treats one as
     * undecided, so it would be stored, echoed back and enforced as <em>on</em>.
     */
    private static void rejectNonBooleanFlags(Map<String, Object> patch) {
        if (!(patch.get("flags") instanceof Map<?, ?> flags)) {
            return;
        }
        for (Map.Entry<?, ?> entry : flags.entrySet()) {
            Object value = entry.getValue();
            // null is "not changing this", handled by the skip in `update`.
            if (value != null && !(value instanceof Boolean)) {
                throw new ValidationException("'flags." + entry.getKey() + "' must be true or false, "
                        + "not " + value.getClass().getSimpleName() + ". A flag stored as anything "
                        + "else reads as ON to every part of this server, so it would look saved and "
                        + "do nothing. Nothing was saved.");
            }
        }
    }

    /**
     * Refuse {@code geo.cities.*.live}: city launch state is a column on {@code cities}, because a
     * value deciding what a logged-out visitor sees cannot have an administrator-only reader.
     */
    private static void rejectRetiredCityLive(Map<String, Object> patch) {
        if (!(patch.get("geo") instanceof Map<?, ?> geo)
                || !(geo.get("cities") instanceof Map<?, ?> cities)) {
            return;
        }
        for (Map.Entry<?, ?> entry : cities.entrySet()) {
            if (entry.getValue() instanceof Map<?, ?> city && city.containsKey("live")) {
                throw new ValidationException("'geo.cities." + entry.getKey() + ".live' is no longer "
                        + "stored here: city launch state is a column on the city roster. Use PATCH "
                        + "/admin/cities/{slug} instead, and read it back from GET /cities. Nothing "
                        + "was saved.");
            }
        }
    }

    /**
     * Enforce {@code If-Match} per RFC 9110 13.1.1, strong comparison only.
     * Semantics: docs/system/api-standards.md section 12.
     */
    private void requirePrecondition(String ifMatch) {
        if (ifMatch == null || ifMatch.isBlank()) {
            return;
        }
        String trimmed = ifMatch.trim();
        if ("*".equals(trimmed)) {
            return;
        }
        String actual = etag();
        for (String candidate : trimmed.split(",")) {
            if (actual.equals(candidate.trim())) {
                return;
            }
        }
        throw new PreconditionFailedException(
                "The settings changed since you loaded them. Reload and re-apply your edit.");
    }

    /**
     * Deep-merge {@code incoming} onto {@code base}. Past {@link #MAX_MERGE_DEPTH} the incoming
     * subtree replaces the base one outright - nobody is editing a settings form twelve levels deep.
     */
    private static JsonNode merge(JsonNode base, JsonNode incoming, int depth) {
        if (base == null || !base.isObject() || !incoming.isObject() || depth >= MAX_MERGE_DEPTH) {
            return incoming;
        }
        ObjectNode result = ((ObjectNode) base).objectNode();
        for (Map.Entry<String, JsonNode> field : base.properties()) {
            result.set(field.getKey(), field.getValue());
        }
        for (Map.Entry<String, JsonNode> field : incoming.properties()) {
            result.set(field.getKey(),
                    merge(result.get(field.getKey()), field.getValue(), depth + 1));
        }
        return result;
    }

    private JsonNode parseOrNull(String key, String json) {
        try {
            return objectMapper.readTree(json);
        } catch (RuntimeException malformed) {
            log.warn("settings.{} holds unparseable JSON; omitting it from the document", key,
                    malformed);
            return null;
        }
    }
}
