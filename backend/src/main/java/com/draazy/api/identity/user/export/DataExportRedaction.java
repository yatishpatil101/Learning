package com.draazy.api.identity.user.export;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Date;
import java.sql.Time;
import java.sql.Timestamp;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * <strong>The one place the other party is removed, and the one place a database value becomes a
 * JSON value.</strong>
 *
 * <p>Both jobs live here for the same reason: they are the two things every dataset in {@link
 * DataExportScope} needs and neither is worth getting subtly different in seventy places. Splitting
 * them across the service and the DTO is how an export ends up hashing the counterparty on eleven
 * datasets and forgetting on the twelfth.
 *
 * <h2>partyRef</h2>
 *
 * <p>A shared record — a tenancy, a chat thread, an offer — has a second person on it, and DPDP Act
 * 2023 s.11(2) says the subject's right of access stops short of revealing who they are. Three
 * options were considered:
 *
 * <ol>
 *   <li><strong>Omit the column.</strong> Rejected: the subject then cannot tell whether the four
 *       enquiries on their listing came from four people or from one person four times, which is
 *       exactly the kind of thing an access request is for.</li>
 *   <li><strong>Return the raw user id.</strong> Rejected. A UUID looks anonymous and is not: it is
 *       the primary key of a person, it appears in URLs, and anybody holding two exports or one
 *       export and any other leak can join on it.</li>
 *   <li><strong>A digest salted with the subject's own id.</strong> Chosen.</li>
 * </ol>
 *
 * <p>The salt is the load-bearing detail. {@code SHA-256("draazy:data-export:v1:" + subjectId +
 * ":" + otherKey)} means the same counterparty produces the same ref everywhere in <em>one</em>
 * subject's export — so the subject can see that their tenant is also the person who left them a
 * review — while two different subjects' exports produce completely unrelated refs for the same
 * third person. That second property is the one worth paying for: without it, two users who compare
 * exports could work out that they dealt with the same landlord, which is precisely the disclosure
 * s.11(2) forbids, arrived at by a route nobody would have called a disclosure.
 *
 * <p><strong>No pepper.</strong> {@code ErasureService} salts its subject digest with a configured
 * pepper because that digest has to survive the deletion of the row it was derived from; a
 * database-holder who could recompute it could re-identify an erased subject. Here the salt is the
 * subject's own id, which is in the same database as the value being hashed — a pepper would defend
 * against an attacker who already has both inputs in plaintext. The attacker this actually defends
 * against is the recipient of the export, and against them SHA-256 over a 122-bit UUID is not
 * brute-forceable. Adding a pepper would buy nothing and add a configuration value whose loss would
 * silently change every ref.
 *
 * <p><strong>Sixteen hex characters, not sixty-four.</strong> Sixty-four bits. A ref is only ever
 * compared against other refs inside the same document, so the collision that matters is between two
 * counterparties of one subject; at a thousand distinct counterparties that is about one chance in
 * seventy billion. The shorter form is legible to a human reading the document, which the full
 * digest is not, and the export is a document meant to be read.
 *
 * <p><strong>{@code self}.</strong> Where the source value is the subject's own id, the ref is the
 * literal {@code "self"} rather than a digest. A hashed self-reference would be indistinguishable
 * from a stranger, so an export of a chat thread would leave the subject unable to tell which
 * messages they wrote — technically complete and practically useless.
 *
 * <p><strong>Why the transform keys off the column alias and not the column.</strong> Any value a
 * query selects as {@code party_ref_src} is hashed, whatever it is. Two of the columns routed
 * through it ({@code offer_history.by}, {@code service_request_timeline.by}) are {@code text} and
 * the schema does not record whether they hold a user id, a staff email or a display name. Hashing
 * by alias means a wrong guess about a column's contents costs an opaque field rather than a
 * disclosure, and it fails safe: a new dataset that forgets the alias gets a raw value in the output
 * where a reviewer and {@code DataExportCoverageTest} will both see it, rather than silently
 * skipping a redaction step nobody can observe.
 */
final class DataExportRedaction {

    /**
     * Version-pinned so that if the derivation ever has to change, old and new refs are visibly
     * different rather than quietly incomparable.
     */
    private static final String DOMAIN = "draazy:data-export:v1:";

    /** Length in hex characters of the emitted digest. See the class Javadoc. */
    private static final int REF_LENGTH = 16;

    /** What a reference to the subject themselves looks like. */
    static final String SELF = "self";

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private DataExportRedaction() {
    }

    /**
     * Turns one JDBC row into one JSON object, applying the redaction on the way.
     *
     * <p>Order matters and is not arbitrary: the {@code party_ref_src} column is consumed and
     * replaced rather than added alongside, so there is no path by which the raw value reaches the
     * response even if a future dataset selects it under both names.
     */
    static Map<String, Object> row(Map<String, Object> raw, UUID subjectId) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : raw.entrySet()) {
            if (DataExportScope.PARTY_REF_SOURCE.equals(entry.getKey())) {
                out.put(DataExportScope.PARTY_REF, partyRef(entry.getValue(), subjectId));
            } else {
                out.put(entry.getKey(), value(entry.getValue()));
            }
        }
        return out;
    }

    /**
     * The stable, non-identifying reference to the other person on a shared record.
     *
     * @param source   whatever the query selected as {@code party_ref_src} — a {@link UUID}, a
     *                 {@code text} actor label, or null where the row has no second party yet
     * @param subjectId the person this export belongs to; both the salt and the {@code self} test
     */
    static String partyRef(Object source, UUID subjectId) {
        if (source == null) {
            return null;
        }
        String key = String.valueOf(source).trim();
        if (key.isEmpty()) {
            return null;
        }
        if (key.equalsIgnoreCase(subjectId.toString())) {
            return SELF;
        }
        return digest(DOMAIN + subjectId + ':' + key);
    }

    /**
     * Normalises one JDBC column value into something Jackson will render as the data subject
     * expects.
     *
     * <p>The driver hands back {@code java.sql} wrappers, {@link UUID}s and — for the thirty-four
     * {@code jsonb} columns in the schema — a {@code PGobject}. Left alone, Jackson renders a {@code
     * Timestamp} as an epoch number and a {@code PGobject} as a string containing escaped JSON, so a
     * document whose entire purpose is machine readability would arrive with its dates unreadable
     * and its structured fields double-encoded.
     *
     * <p><strong>{@code PGobject} is matched by class name rather than imported</strong> because the
     * PostgreSQL driver is a {@code runtime}-scope dependency in {@code pom.xml} — deliberately, so
     * that application code cannot bind itself to one database — and is therefore not on the compile
     * classpath. Duck-typing on {@code toString()} is the cost of keeping that constraint, and it is
     * a small one: {@code PGobject.toString()} returns the value string, which is what we want to
     * parse anyway.
     */
    static Object value(Object raw) {
        return switch (raw) {
            case null -> null;
            // Timestamp and Date both extend java.util.Date; the more specific arms must come first.
            case Timestamp ts -> ts.toInstant().toString();
            case Date d -> d.toLocalDate().toString();
            case Time t -> t.toLocalTime().toString();
            case UUID id -> id.toString();
            case String s -> s;
            case Boolean b -> b;
            case Number n -> n;
            default -> unwrap(raw);
        };
    }

    private static Object unwrap(Object raw) {
        String text = String.valueOf(raw);
        if (!raw.getClass().getName().equals("org.postgresql.util.PGobject")) {
            return text;
        }
        try {
            JsonNode parsed = JSON.readTree(text);
            return parsed == null || parsed.isMissingNode() ? text : parsed;
        } catch (RuntimeException e) {
            // A PGobject holding something that is not JSON — an enum or a range type, neither of
            // which the schema currently uses. Returning the text is honest and lossless; throwing
            // would fail somebody's entire export over one unexpected column type.
            return text;
        }
    }

    private static String digest(String input) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            byte[] hash = sha.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash).substring(0, REF_LENGTH);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by the JLS and is absent", e);
        }
    }
}
