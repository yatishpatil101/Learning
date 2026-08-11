package com.punenest.api.identity.user.erasure;

import com.punenest.api.common.audit.AuditService;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.security.AuthPrincipal;
import jakarta.persistence.EntityManager;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * The right to erasure under the DPDP Act 2023 — filing a request, and carrying one out.
 *
 * <p><strong>Read {@link ErasureRetention} first.</strong> It carries the decision this class only
 * executes: which categories are erased, which are retained, and the statute behind each retention.
 * That reasoning is the part of this feature a future reader cannot reconstruct from the code, so it
 * is written down beside it rather than inferred from a list of {@code UPDATE} statements.
 *
 * <h2>Why erasure is pseudonymisation of one row rather than a cascade over fifty-five</h2>
 *
 * <p>Every table that knows about a person reaches them through a {@code user_id} foreign key into
 * {@code users}. Almost none of them stores contact details of its own; they store a reference. So
 * emptying the identity root of everything that names a human de-identifies the whole graph in one
 * write, and the small sweep below exists only for the handful of places that duplicate identity
 * outside it — auth credentials, and the KYC records that hold masked government numbers.
 *
 * <p>A cascade would have been shorter to write and wrong in both directions at once: it would
 * destroy the retained categories (payments, agreements, closed deals, the audit trail) and it would
 * still miss the denormalised copies listed in {@link ErasureRetention#knownGaps()}, because those
 * are not reachable by following a foreign key.
 *
 * <h2>Two stages, on purpose</h2>
 *
 * <p>Filing does not erase. Erasure is the one destructive act on this platform that the person it
 * was done to cannot appeal, because afterwards there is no account to appeal from — so a tapped
 * button, a coerced tenant or a stolen session must not be able to reach it in one hop. A pending
 * request also gives ops the chance to find the live obligation that makes a rejection the correct
 * answer under s.8(7).
 */
@Service
public class ErasureService {

    /**
     * Serializer for the two {@code jsonb} documents. Same reasoning as {@code AuditService}: the
     * documents carry an operator's free-text decision note, and a quote in a note must not be able
     * to corrupt — or forge fields inside — a record whose whole purpose is to be trusted.
     */
    private static final ObjectMapper DOCUMENT_JSON = JsonMapper.builder().build();

    /** Where the pseudonym mobile block starts. See {@link #pseudonymMobile}. */
    private static final long MOBILE_BLOCK = 9_000_000_000L;

    private static final long MOBILE_BLOCK_SIZE = 1_000_000_000L;

    private final ErasureRequestRepository requests;
    private final UserRepository users;
    private final AuditService audit;
    private final EntityManager entityManager;

    /**
     * Deployment secret mixed into {@link #digest}.
     *
     * <p>Empty by default, and that is a real weakening rather than a neutral default, so it is
     * stated: with no pepper the digest is a plain SHA-256 of a UUID, which anybody holding a
     * database dump and a list of candidate ids can confirm against. The pre-image space is still
     * 2^122, so it is not enumerable — but a pepper the database does not contain is what makes the
     * digest useless to somebody who has stolen only the database, which is the threat this column
     * is actually defending against.
     */
    private final String pepper;

    public ErasureService(ErasureRequestRepository requests, UserRepository users,
            AuditService audit, EntityManager entityManager,
            @Value("${punenest.erasure.pepper:}") String pepper) {
        this.requests = requests;
        this.users = users;
        this.audit = audit;
        this.entityManager = entityManager;
        this.pepper = pepper == null ? "" : pepper;
    }

    /**
     * {@code POST /me/erasure} — the subject asks to be erased.
     *
     * <p>Nothing is erased here. The request is a queue entry; see the class Javadoc for why the two
     * stages are separate.
     *
     * @throws ConflictException if the subject already has a pending request. The V56 partial unique
     *                          index is the real guard — this check exists so a double tap gets a
     *                          clean 409 rather than a constraint violation.
     */
    @Transactional
    public ErasureRequestResponse request(AuthPrincipal subject, String reason) {
        requests.findBySubjectIdAndStatus(subject.userId(), ErasureStatuses.PENDING)
                .ifPresent(existing -> {
                    throw new ConflictException(
                            "You already have an erasure request awaiting a decision.");
                });
        ErasureRequest saved = requests.saveAndFlush(
                new ErasureRequest(subject.userId(), digest(subject.userId()), reason));
        // The subject is the actor here, not a privileged one -- but this is the request that ends
        // an account, and "who asked, and when" has to be answerable later from a table that is not
        // the one about to be emptied.
        audit.record(subject, "erasure.request", "erasure_request", saved.getId().toString(),
                "reason", reason);
        return ErasureRequestResponse.of(saved);
    }

    /** {@code GET /me/erasure} — the subject's own requests, newest first. */
    @Transactional(readOnly = true)
    public Page<ErasureRequestResponse> mine(AuthPrincipal subject, Pageable pageable) {
        return requests.findBySubjectIdOrderByRequestedAtDesc(subject.userId(), pageable)
                .map(ErasureRequestResponse::of);
    }

    /** {@code GET /admin/erasure-requests} — the queue, newest first, optionally one state. */
    @Transactional(readOnly = true)
    public Page<ErasureRequestResponse> queue(String status, Pageable pageable) {
        if (status == null || status.isBlank()) {
            return requests.findAllByOrderByRequestedAtDesc(pageable)
                    .map(ErasureRequestResponse::of);
        }
        if (!ErasureStatuses.isValid(status)) {
            throw new BadRequestException("Unknown erasure request status: " + status);
        }
        return requests.findByStatusOrderByRequestedAtDesc(status, pageable)
                .map(ErasureRequestResponse::of);
    }

    /**
     * {@code PATCH /admin/erasure-requests/{id}} — carry the request out, or refuse it.
     *
     * <p>A rejection is a real outcome, not an escape hatch — see {@link ErasureStatuses#REJECTED}.
     * The note is required for a rejection and optional for an execution, because a refusal the
     * subject cannot understand is a refusal they cannot act on.
     *
     * @throws ConflictException if the request has already been decided
     */
    @Transactional
    public ErasureRequestResponse decide(AuthPrincipal admin, String id, String decision,
            String note) {
        ErasureRequest request = requests.findById(
                        Ids.parseUuid(id).orElseThrow(() -> NotFoundException.of("Erasure request")))
                .orElseThrow(() -> NotFoundException.of("Erasure request"));
        if (!ErasureStatuses.isDecidable(request.getStatus())) {
            throw new ConflictException(
                    "This erasure request was already %s. A fresh ask is a fresh request."
                            .formatted(request.getStatus()));
        }
        if (ErasureDecisions.REJECT.equals(decision)) {
            if (note == null || note.isBlank()) {
                throw new BadRequestException(
                        "A rejected erasure request must say why — the subject is entitled to know "
                                + "which obligation blocked it and when they can ask again.");
            }
            request.reject(admin.userId(), note.trim());
            audit.record(admin, "erasure.reject", "erasure_request", id, "note", note.trim());
            return ErasureRequestResponse.of(request);
        }
        if (!ErasureDecisions.EXECUTE.equals(decision)) {
            throw new BadRequestException("decision must be one of " + ErasureDecisions.ALL);
        }
        return ErasureRequestResponse.of(execute(admin, request, note));
    }

    /**
     * Carry out the erasure.
     *
     * <p>One transaction. A half-applied erasure is the worst outcome available: the subject is told
     * they were erased, the {@code users} row is pseudonymised so nothing can find them by number
     * any more, and their masked Aadhaar is still sitting in {@code identity_verifications} with no
     * remaining route to it. Every statement below either commits together or none of them does.
     *
     * <p>The sweep is written as native statements rather than through entities on purpose. Six of
     * these seven tables have no JPA entity in this codebase at all, and giving them one so that
     * erasure could reach them would create six new mapped types whose only reader is this method —
     * each one an extra thing that has to stay in step with the schema forever. A named-column
     * {@code UPDATE} is also the form in which a reviewer can see exactly which columns survive.
     */
    private ErasureRequest execute(AuthPrincipal admin, ErasureRequest request, String note) {
        UUID subjectId = request.getSubjectId();
        User subject = users.findById(subjectId)
                .orElseThrow(() -> NotFoundException.of("User"));
        String oldMobile = subject.getMobile();

        Map<String, Object> erased = new LinkedHashMap<>();

        // 1. Auth credentials. Deleted outright rather than blanked: an OTP row and a refresh token
        //    are transient artefacts of a session, no statute asks for them, and a blanked one would
        //    be a row that still says "this person signed in on this date".
        erased.put("otp_codes", entityManager
                .createNativeQuery("delete from otp_codes where mobile = :mobile")
                .setParameter("mobile", oldMobile)
                .executeUpdate());
        erased.put("refresh_tokens", entityManager
                .createNativeQuery("delete from refresh_tokens where user_id = :id")
                .setParameter("id", subjectId)
                .executeUpdate());

        // 2. KYC. The rows are kept because `identity_verifications.user_id` is UNIQUE and its
        //    absence is meaningful ("never verified"), but every field that identifies a person
        //    goes -- including `identity_hash`, the irreversible "one Aadhaar, one account" dedup
        //    key. That key is still a pseudonymous identifier of a specific human being, and
        //    keeping it would let the platform recognise the same person if they ever came back,
        //    which is the precise capability erasure is meant to remove. The cost is real and
        //    accepted: the dedup guarantee no longer covers erased accounts.
        erased.put("identity_verifications", entityManager
                .createNativeQuery("""
                        update identity_verifications
                           set masked_aadhaar = null,
                               identity_hash = null,
                               ref = null,
                               verification_url = null,
                               mobile_match = null,
                               badge = false,
                               status = 'none'
                         where user_id = :id
                        """)
                .setParameter("id", subjectId)
                .executeUpdate());
        erased.put("owner_kyc", entityManager
                .createNativeQuery("""
                        update owner_kyc
                           set pan_masked = null,
                               aadhaar_masked = null
                         where user_id = :id
                        """)
                .setParameter("id", subjectId)
                .executeUpdate());

        // 3. Profile free text the subject wrote about themselves. The column set is V13's, not
        //    V6's -- V13 reshaped this table and dropped four of the columns the original schema
        //    declared, which is exactly the trap a sweep written from the first migration falls
        //    into. `score` and `verified` stay: neither identifies anybody, and both are
        //    platform-derived signals attached to an id that no longer resolves to a person.
        erased.put("tenant_profiles", entityManager
                .createNativeQuery("""
                        update tenant_profiles
                           set name = null,
                               occupation = null,
                               income = null,
                               occupants = null,
                               move_in = null,
                               prior_landlord = null,
                               about = null
                         where user_id = :id
                        """)
                .setParameter("id", subjectId)
                .executeUpdate());

        // 4. The government numbers collected for a rent-agreement draft (V47). That table already
        //    has a purge for the ordinary case; this is the erasure case, which is stronger -- it
        //    takes `party_name` too, which the routine purge deliberately leaves behind.
        erased.put("service_request_identities", entityManager
                .createNativeQuery("""
                        update service_request_identities
                           set pan = null,
                               aadhaar = null,
                               party_name = null,
                               purged_at = coalesce(purged_at, now())
                         where service_request_id in (
                                   select id from service_requests where requester_id = :id)
                        """)
                .setParameter("id", subjectId)
                .executeUpdate());

        // 5. The identity root, last. Everything above keys off `mobile` or off the row existing, so
        //    replacing the number first would have orphaned the OTP delete.
        subject.erasePersonalData(pseudonymMobile(subjectId));
        erased.put("users", 1);

        String erasedJson = DOCUMENT_JSON.writeValueAsString(erased);
        String retainedJson = DOCUMENT_JSON.writeValueAsString(Map.of(
                "retained", ErasureRetention.retainedWithReasons(),
                "notYetSwept", ErasureRetention.knownGaps()));
        request.complete(admin.userId(), note, erasedJson, retainedJson);

        // Recorded against the request, never against the user: an audit row naming the erased
        // account would put the identifier straight back into a permanent table. `entityId` is the
        // request id and the metadata carries counts, not values.
        audit.record(admin, "erasure.execute", "erasure_request", request.getId().toString(),
                "erased", erased, "note", note);
        return request;
    }

    /**
     * A stand-in for {@code users.mobile} derived from the row id.
     *
     * <p>The column is {@code NOT NULL UNIQUE} with {@code CHECK (mobile ~ '^[6-9][0-9]{9}$')}
     * (V2), and all three keep holding after erasure — so the number cannot be blanked, and two
     * erased users must not collapse onto a shared placeholder. The value is therefore ten digits
     * beginning {@code 9}, taken from a SHA-256 of the <em>id</em>. It is not a function of the
     * mobile it replaces, so it cannot be reversed into one, and it is not a function of anything
     * the erased person supplied.
     *
     * <p><strong>It is a pseudonym, not a reserved range.</strong> Numbers beginning 9 are really
     * allocated in India, so a collision with a live subscriber is possible and nothing may treat
     * this value as contactable — which is why {@link User#erasePersonalData} also archives the row
     * and clears {@code mobileVerified}. A dedicated non-conforming placeholder would be more
     * honest, and would require relaxing a CHECK that holds for every real row on the platform in
     * order to accommodate a handful of erased ones. That trade was not worth making; this note is
     * the price of not making it.
     */
    static String pseudonymMobile(UUID subjectId) {
        BigInteger hash = new BigInteger(1, sha256("mobile:" + subjectId));
        long tail = hash.mod(BigInteger.valueOf(MOBILE_BLOCK_SIZE)).longValueExact();
        return String.valueOf(MOBILE_BLOCK + tail);
    }

    /**
     * The surviving reference to an erased subject — {@code SHA-256(pepper || uuid)}, lowercase hex.
     *
     * <p>A verifier, not an index: it confirms that a request concerned a UUID you already hold, and
     * cannot be run backwards to produce the UUID. See V56's header for why the digest is taken over
     * the id rather than over the mobile number — a ten-digit mobile is enumerable in seconds, so a
     * digest of one is a pointer wearing a hash's clothing.
     */
    String digest(UUID subjectId) {
        byte[] bytes = sha256(pepper + subjectId);
        StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            hex.append(Character.forDigit((b >> 4) & 0xF, 16))
                    .append(Character.forDigit(b & 0xF, 16));
        }
        return hex.toString();
    }

    private static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException impossible) {
            // Every JRE ships SHA-256. Failing loudly beats erasing somebody and writing an
            // unverifiable record of having done it.
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    /** The two things an admin may do with a pending request. */
    public static final class ErasureDecisions {

        private ErasureDecisions() {
        }

        public static final String EXECUTE = "execute";
        public static final String REJECT = "reject";

        static final List<String> ALL = List.of(EXECUTE, REJECT);
    }
}
