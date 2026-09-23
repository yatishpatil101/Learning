package com.draazy.api.identity.user.erasure;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.identity.verification.IdentityVerificationService;
import com.draazy.api.security.AuthPrincipal;
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

/** DPDP right-to-erasure — filing and execution. Erased vs retained: {@link ErasureRetention} and
 * docs/system/legal-entity-and-compliance.md#11-dpdp-erasure--what-is-deleted-what-is-retained-and-on-whose-authority */
@Service
public class ErasureService {

    /** Serializer for the two {@code jsonb} documents; must not corrupt or forge fields from a quoted note. */
    private static final ObjectMapper DOCUMENT_JSON = JsonMapper.builder().build();

    /** Where the pseudonym mobile block starts. See {@link #pseudonymMobile}. */
    private static final long MOBILE_BLOCK = 9_000_000_000L;

    private static final long MOBILE_BLOCK_SIZE = 1_000_000_000L;

    private final ErasureRequestRepository requests;
    private final UserRepository users;
    private final AuditService audit;
    private final EntityManager entityManager;
    private final IdentityVerificationService identity;

    /** Deployment secret mixed into {@link #digest}; empty by default, which is a real weakening
     * (an unpeppered digest is confirmable from a database dump alone). */
    private final String pepper;

    public ErasureService(ErasureRequestRepository requests, UserRepository users,
            AuditService audit, EntityManager entityManager, IdentityVerificationService identity,
            @Value("${draazy.erasure.pepper:}") String pepper) {
        this.requests = requests;
        this.users = users;
        this.audit = audit;
        this.entityManager = entityManager;
        this.identity = identity;
        this.pepper = pepper == null ? "" : pepper;
    }

    /** {@code POST /me/erasure} files a queue entry (nothing is erased here); double-tap returns 409 rather than the V56 unique-index violation. */
    @Transactional
    public ErasureRequestResponse request(AuthPrincipal subject, String reason) {
        requests.findBySubjectIdAndStatus(subject.userId(), ErasureStatuses.PENDING)
                .ifPresent(existing -> {
                    throw new ConflictException(
                            "You already have an erasure request awaiting a decision.");
                });
        ErasureRequest saved = requests.saveAndFlush(
                new ErasureRequest(subject.userId(), digest(subject.userId()), reason));
        // Audit the subject-initiated ask onto a table other than the one about to be emptied.
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

    /** {@code PATCH /admin/erasure-requests/{id}} — execute or refuse; note is required on rejection. Throws {@link ConflictException} if already decided. */
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

    /** One transaction: a half-applied erasure (told-erased but photos still in the object store)
     * is the worst outcome available. */
    private ErasureRequest execute(AuthPrincipal admin, ErasureRequest request, String note) {
        UUID subjectId = request.getSubjectId();
        User subject = users.findById(subjectId)
                .orElseThrow(() -> NotFoundException.of("User"));
        String oldMobile = subject.getMobile();

        Map<String, Object> erased = new LinkedHashMap<>();

        // 1. Auth credentials, deleted outright. `requested_by` too: a consent code the subject
        //    asked for is addressed to a third party's number, unreachable from their own.
        erased.put("otp_codes", entityManager
                .createNativeQuery(
                        "delete from otp_codes where mobile = :mobile or requested_by = :id")
                .setParameter("mobile", oldMobile)
                .setParameter("id", subjectId)
                .executeUpdate());
        erased.put("refresh_tokens", entityManager
                .createNativeQuery("delete from refresh_tokens where user_id = :id")
                .setParameter("id", subjectId)
                .executeUpdate());

        // 1b. Outbound messages. Deleted whole: `body` holds rendered text naming the subject, so
        //     there is no column subset to null. Not retained — chasers are coordination, not obligation.
        erased.put("outbound_message", entityManager
                .createNativeQuery("delete from outbound_message where recipient_id = :id")
                .setParameter("id", subjectId)
                .executeUpdate());

        // 2. Identity case. Row, images and `identity_hash` all go — keeping the dedup key would
        //    let the platform recognise an erased person on their return.
        erased.put("identity_verifications", identity.erase(subjectId));
        erased.put("owner_kyc", entityManager
                .createNativeQuery("""
                        update owner_kyc
                           set pan_masked = null,
                               aadhaar_masked = null
                         where user_id = :id
                        """)
                .setParameter("id", subjectId)
                .executeUpdate());

        // 3. Profile free text. Column set follows V13; `score` and `verified`
        //    stay — platform-derived signals, not identifiers.
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

        // 4. Rent-agreement gov numbers (V47). Erasure case is stronger than the routine purge:
        //    also takes `party_name`, which routine purge deliberately keeps.
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

        // 5. Unclaimed co-fill invitations (V107). Row deleted because the CHECK forces mobile XOR
        //    user_id; must run before step 10 replaces the mobile. Claimed rows untouched by design.
        erased.put("service_request_parties", entityManager
                .createNativeQuery("delete from service_request_parties where mobile = :mobile")
                .setParameter("mobile", oldMobile)
                .executeUpdate());

        // 6. Society claim contact fields (V101). Row stays — deleting one person's claim would
        //    change a shared building's status — but `name` (NOT NULL) is substituted, `email` nulled.
        erased.put("society_claims", entityManager
                .createNativeQuery("""
                        update society_claims
                           set name = 'Erased account',
                               email = null
                         where claimed_by = :id
                        """)
                .setParameter("id", subjectId)
                .executeUpdate());

        // 7. Page view telemetry. Nulled, not deleted — the view happened, aggregates name nobody,
        //    and raw rows expire on a 90-day clock (see PageViewRetention).
        erased.put("page_views", entityManager
                .createNativeQuery("""
                        update page_views
                           set user_id = null
                         where user_id = :id
                        """)
                .setParameter("id", subjectId)
                .executeUpdate());

        // 8. The homes the subject records renting (V128). Whole row; reasoned in ErasureCoverageTest.
        erased.put("tenant_rentals", entityManager
                .createNativeQuery("delete from tenant_rentals where tenant_id = :id")
                .setParameter("id", subjectId)
                .executeUpdate());

        // 9. Help article verdicts (V36). Whole row, not an unlink: "what was missing?" reliably
        //    collects a phone number, and no aggregate has been computed from these rows.
        erased.put("help_article_feedback", entityManager
                .createNativeQuery("delete from help_article_feedback where user_id = :id")
                .setParameter("id", subjectId)
                .executeUpdate());

        // 10. Identity root, last: earlier steps key off mobile or row-existing, so replacing the
        //    number first would orphan the OTP and pending-invite deletes.
        subject.erasePersonalData(pseudonymMobile(subjectId));
        erased.put("users", 1);

        String erasedJson = DOCUMENT_JSON.writeValueAsString(erased);
        String retainedJson = DOCUMENT_JSON.writeValueAsString(Map.of(
                "retained", ErasureRetention.retainedWithReasons(),
                "notYetSwept", ErasureRetention.knownGaps()));
        request.complete(admin.userId(), note, erasedJson, retainedJson);

        // Audit against the request, not the user: a row naming the erased account would put the
        // identifier straight back into a permanent table.
        audit.record(admin, "erasure.execute", "erasure_request", request.getId().toString(),
                "erased", erased, "note", note);
        return request;
    }

    /** A stand-in for {@code users.mobile} derived from the row id: ten digits beginning {@code 9},
     * taken from SHA-256(id) — a pseudonym, not a reserved range, so never treated as contactable. */
    static String pseudonymMobile(UUID subjectId) {
        BigInteger hash = new BigInteger(1, sha256("mobile:" + subjectId));
        long tail = hash.mod(BigInteger.valueOf(MOBILE_BLOCK_SIZE)).longValueExact();
        return String.valueOf(MOBILE_BLOCK + tail);
    }

    /** Surviving reference to an erased subject — {@code SHA-256(pepper || uuid)}, lowercase hex.
     * A verifier, not an index: confirms a UUID you already hold, cannot be run backwards. */
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
            // SHA-256 ships with every JRE; failing loudly beats writing an unverifiable erasure record.
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
