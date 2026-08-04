package com.punenest.api.admin;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.PreconditionFailedException;
import com.punenest.api.common.settings.Setting;
import com.punenest.api.common.settings.SettingRepository;
import com.punenest.api.security.AuthPrincipal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
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
 *
 * <p><strong>The wire shape is one document; the storage is many rows.</strong> The
 * {@code settings} table is keyed by top-level name ({@code fees}, {@code flags}, {@code site}…)
 * so that a server component can read the one block it cares about without deserialising the whole
 * thing — see {@code PlatformSettings}. The contract's {@code AdminSettings} is the union of those
 * rows, so this class only has to fold them together on the way out and split them apart on the
 * way in.
 *
 * <p><strong>PUT merges rather than replaces (S60).</strong> Every property of {@code AdminSettings}
 * is optional, which makes {@code {"flags":{"beta":true}}} a complete, well-formed document. Under
 * replace semantics an admin who opens the feature-flag panel and presses Save would delete the fee
 * table, the permission map and the custom roles, and the platform would silently start charging
 * its compiled-in defaults. So the only safe reading of an all-optional body is "these are the keys
 * I am changing".
 *
 * <p><strong>The merge narrowed the blast radius; {@code If-Match} closes what was left (S68, tech
 * debt D66).</strong> Merging stopped the flags panel from wiping the fee table, but two admins
 * editing the <em>same</em> block still last-write-wins, and neither is told. No body inspection can
 * fix that — the server cannot distinguish a deliberate overwrite from an ignorant one — so the
 * endpoint now issues an {@link #etag()} and honours a conditional write against it.
 */
@Service
public class AdminSettingsService {

    private static final Logger log = LoggerFactory.getLogger(AdminSettingsService.class);

    /**
     * Depth limit on the recursive merge.
     *
     * <p>{@code site}, {@code fees} and {@code permissions} are all declared
     * {@code additionalProperties: true}, so an admin can post arbitrarily deep JSON. Bounded
     * because a merge is recursion over attacker-influenced structure, and the alternative to a
     * limit is a {@code StackOverflowError} in a request thread.
     */
    private static final int MAX_MERGE_DEPTH = 12;

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
     * {@code GET /admin/settings} — every stored block, folded into one document, with the tag that
     * describes it.
     *
     * <p>A row whose JSON has become unparseable is skipped with a warning rather than failing the
     * request: an admin locked out of the settings screen cannot fix the row that locked them out.
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
     * The current entity tag: a strong ETag over every stored block (tech debt D66).
     *
     * <p><strong>Why a content hash and not {@code @Version} on {@code Setting}.</strong> The
     * register's note assumed a row version, but the resource an admin edits is the <em>union</em>
     * of several rows. A counter on one row cannot describe "the document you were looking at", and
     * versioning all of them would leave the endpoint holding a set of numbers it would have to
     * concatenate into a tag anyway — at which point the numbers are doing nothing the content was
     * not already doing. Hashing also gets the semantics right for free: saving a block byte-for-byte
     * unchanged leaves the tag alone, which is exactly what an entity tag is supposed to mean, and
     * what a bumped counter would get wrong.
     *
     * <p>Hashed from the stored strings rather than from the folded document, so the tag does not
     * depend on how Jackson happened to order keys on the way out. Unparseable rows are included:
     * they are part of what is stored even though {@link #current()} hides them, and a write that
     * repaired one must not look like no change at all.
     *
     * <p>SHA-256 truncated to 128 bits. This is a change detector, not a signature — nothing here
     * has to resist a chosen-prefix attack, and a shorter tag is a shorter header.
     *
     * <p>Private, and every caller computes it inside the transaction that produced the body it
     * belongs to. Exposing it would invite the one bug this feature exists to prevent: a tag read in
     * a second transaction can describe a document the caller was never shown, and a client would
     * then pass a precondition it had no right to pass.
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
     * {@code PUT /admin/settings} — deep-merge {@code patch} into what is stored, and return the
     * result.
     *
     * <p>Objects merge key by key; arrays and scalars are replaced whole. Replacing arrays is the
     * right call even inside a merge: {@code customRoles} is an ordered list, and merging two lists
     * positionally would produce a role nobody wrote.
     *
     * @param ifMatch the caller's {@code If-Match} header, or {@code null} for an unconditional
     *                write. Checked first, so a refused precondition writes nothing and records no
     *                audit row
     * @throws PreconditionFailedException if {@code ifMatch} names a document that is no longer
     *                                     stored
     */
    @Transactional
    public SettingsDocument update(AuthPrincipal caller, Map<String, Object> patch,
            String ifMatch) {
        requirePrecondition(ifMatch);
        List<String> touched = new ArrayList<>();
        for (Map.Entry<String, Object> entry : patch.entrySet()) {
            if (entry.getValue() == null) {
                // why skip rather than delete: `{"fees": null}` from a client that serialises its
                // whole form is indistinguishable from a deliberate "remove the fee table", and
                // one of those two readings quietly unprices the platform.
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
     * Enforce {@code If-Match}, per RFC 9110 §13.1.1.
     *
     * <p>Absent means unconditional — the header is optional so that adding it did not break every
     * existing caller, and a caller that omits it keeps today's last-write-wins behaviour and
     * accepts today's risk. {@code *} means "any current representation", which is always true here
     * because the settings document always exists. Otherwise the header is a comma-separated list
     * and matching <em>any</em> entry passes.
     *
     * <p>Weak comparison ({@code W/} prefixes) is not accepted: RFC 9110 requires strong comparison
     * for {@code If-Match}, and this endpoint issues strong tags, so a {@code W/} tag here is a
     * client bug rather than a near-miss worth honouring.
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
     * Deep-merge {@code incoming} onto {@code base}.
     *
     * <p>Beyond {@link #MAX_MERGE_DEPTH} the incoming subtree replaces the base one outright, which
     * is the same answer a scalar gets — deeper than twelve levels the caller is not editing a
     * settings form.
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
