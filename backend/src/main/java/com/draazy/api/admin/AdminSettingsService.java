package com.draazy.api.admin;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.PreconditionFailedException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.common.settings.PlatformSettings;
import com.draazy.api.common.settings.Setting;
import com.draazy.api.common.settings.SettingRepository;
import com.draazy.api.common.settings.SettingsCache;
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
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

@Service
public class AdminSettingsService {

    private static final Logger log = LoggerFactory.getLogger(AdminSettingsService.class);

    /** Bounded because the merge recurses over attacker-influenced structure; unbounded means a
     * {@code StackOverflowError} in a request thread. */
    private static final int MAX_MERGE_DEPTH = 12;

    /** Top-level keys refused outright: configuration that would be stored and enforced by nothing.
     * A deny-list, not an allow-list, because the table is deliberately open. */
    private static final Set<String> UNSUPPORTED_KEYS = Set.of("customRoles");

    private static final String ADMIN_FLAGS_KEY = "adminFlags";

    private final SettingRepository settings;
    private final SettingsCache cache;
    private final ObjectMapper objectMapper;
    private final AuditService audit;

    public AdminSettingsService(SettingRepository settings, SettingsCache cache,
            ObjectMapper objectMapper, AuditService audit) {
        this.settings = settings;
        this.cache = cache;
        this.objectMapper = objectMapper;
        this.audit = audit;
    }

    // `GET /admin/settings` - every stored block folded into one document, with its tag, from one read.
    // An unparseable row is skipped: an admin locked out cannot fix the row that locked them out.
    @Transactional(readOnly = true)
    public SettingsDocument current() {
        List<Setting> rows = settings.findAll(Sort.by("key"));
        Map<String, Object> document = new TreeMap<>();
        for (Setting row : rows) {
            JsonNode value = parseOrNull(row.getKey(), row.getValue());
            if (value != null) {
                document.put(row.getKey(), objectMapper.convertValue(value, Object.class));
            }
        }
        return new SettingsDocument(document, etag(rows));
    }

    // `GET /admin/settings/flags` - the console's module switches alone, one row instead of the whole table.
    @Transactional(readOnly = true)
    public Map<String, Object> adminFlags() {
        return settings.findById(ADMIN_FLAGS_KEY)
                .map(row -> parseOrNull(row.getKey(), row.getValue()))
                .filter(JsonNode::isObject)
                .map(node -> objectMapper.convertValue(node, new TypeReference<Map<String, Object>>() { }))
                .orElseGet(Map::of);
    }

    // Strong hash of every stored block, taken in the transaction that produced the body it describes.
    private String etag() {
        return etag(settings.findAll(Sort.by("key")));
    }

    private static String etag(List<Setting> rows) {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is required of every JRE", impossible);
        }
        for (Setting row : rows) {
            digest.update(row.getKey().getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            digest.update(row.getValue().getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
        }
        return "\"" + HexFormat.of().formatHex(digest.digest(), 0, 16) + "\"";
    }
    @Transactional
    public SettingsDocument update(AuthPrincipal caller, Map<String, Object> patch,
            String ifMatch) {
        rejectUnsupportedKeys(patch);
        requirePrecondition(ifMatch);
        List<String> touched = new ArrayList<>();
        Map<String, Object> saved = new TreeMap<>();
        for (Map.Entry<String, Object> entry : patch.entrySet()) {
            if (entry.getValue() == null) {

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
            saved.put(key, objectMapper.convertValue(merged, Object.class));
        }
        cache.evictAfterCommit();
        audit.record(caller, "settings.update", "settings", "platform",
                "keys", String.join(",", touched));
        return new SettingsDocument(saved, etag());
    }

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
        rejectOutOfRange(patch, PlatformSettings.LISTINGS_KEY, "maxPhotos",
                PlatformSettings.MIN_LISTING_PHOTOS, PlatformSettings.MAX_LISTING_PHOTOS);
        rejectOutOfRange(patch, PlatformSettings.FLATMATES_KEY, "maxGroupsPerPerson",
                PlatformSettings.MIN_GROUPS_PER_PERSON, PlatformSettings.MAX_GROUPS_PER_PERSON);
        // Floor of 1: a cleared field arrives as 0, and a ₹0 plan activates without payment.
        for (String price : PlatformSettings.PRICE_FIELDS) {
            rejectOutOfRange(patch, PlatformSettings.FEES_KEY, price, 1, PlatformSettings.MAX_PRICE);
        }
    }

    private static void rejectOutOfRange(Map<String, Object> patch, String key, String field,
            int min, int max) {
        if (!(patch.get(key) instanceof Map<?, ?> block)) {
            return;
        }
        Object value = block.get(field);
        if (value == null) {
            return;
        }
        boolean whole = value instanceof Integer || value instanceof Long;
        long n = whole ? ((Number) value).longValue() : -1;
        if (n < min || n > max) {
            throw new ValidationException("'" + key + "." + field + "' must be a whole number from "
                    + min + " to " + max + ", not " + value + ". Nothing was saved.");
        }
    }

    private static void rejectNonBooleanFlags(Map<String, Object> patch) {
        if (!(patch.get("flags") instanceof Map<?, ?> flags)) {
            return;
        }
        for (Map.Entry<?, ?> entry : flags.entrySet()) {
            Object value = entry.getValue();

            if (value != null && !(value instanceof Boolean)) {
                throw new ValidationException("'flags." + entry.getKey() + "' must be true or false, "
                        + "not " + value.getClass().getSimpleName() + ". A flag stored as anything "
                        + "else reads as ON to every part of this server, so it would look saved and "
                        + "do nothing. Nothing was saved.");
            }
        }
    }

    // City launch state lives on `cities`; public visibility cannot depend on admin-only JSON.
    private static void rejectRetiredCityLive(Map<String, Object> patch) {
        if (!(patch.get("geo") instanceof Map<?, ?> geo)
                || !(geo.get("cities") instanceof Map<?, ?> cities)) {
            return;
        }
        for (Map.Entry<?, ?> entry : cities.entrySet()) {
            if (entry.getValue() instanceof Map<?, ?> city && city.containsKey("live")) {
                throw new ValidationException("'geo.cities." + entry.getKey() + ".live' is no longer "
                        + "stored here: city launch state is a column on the city roster. Use PATCH "
                        + "/admin/cities/{slug} instead, and read it back from GET /bootstrap (cities). Nothing "
                        + "was saved.");
            }
        }
    }

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
