package com.draazy.api.identity.verification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.error.ErrorCodes;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@Transactional(propagation = Propagation.NOT_SUPPORTED)
@TestPropertySource(properties = "spring.datasource.hikari.maximum-pool-size=24")
class IdentityDisputeEndpointsTest extends AbstractApiTest {

    private static final String PAN = "ABCDE1234F";
    private static final String OTHER_PAN = "FGHIJ5678K";

    @Autowired
    UserRepository users;
    @Autowired
    IdentityVerificationRepository verifications;
    @Autowired
    IdentityHasher hasher;
    @Autowired
    PlatformTransactionManager transactionManager;

    @BeforeEach
    @AfterEach
    void cleanRows() {
        jdbc.update("""
                delete from support_ticket_messages
                where ticket_id in (
                    select id from support_tickets
                    where user_id in (select id from users where mobile like '984900%')
                )
                """);
        jdbc.update("""
                delete from support_tickets
                where user_id in (select id from users where mobile like '984900%')
                """);
        jdbc.update("delete from audit_log where action like 'identity.%'");
        jdbc.update("""
                delete from identity_conflicts
                where user_id in (select id from users where mobile like '984900%')
                """);
        jdbc.update("""
                delete from identity_verification_files
                where verification_id in (
                    select id from identity_verifications
                    where user_id in (select id from users where mobile like '984900%')
                )
                """);
        jdbc.update("""
                delete from identity_verifications
                where user_id in (select id from users where mobile like '984900%')
                """);
        jdbc.update("delete from users where mobile like '984900%'");
    }

    @Test
    void dispute_createsSupportTicket_andAuditsStaffOnlyLinkage() throws Exception {
        User holder = user("9849000001");
        User challenger = user("9849000002");
        User reviewer = admin("9849000003");
        approveVerified(holder, reviewer, PAN);

        submitPan(challenger, PAN)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value(ErrorCodes.IDENTITY_ALREADY_REGISTERED));

        String ticketId = dispute(challenger, "This document was used without me.")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.ticketId").exists())
                .andReturn().getResponse().getContentAsString()
                .replaceAll(".*\"ticketId\"\\s*:\\s*\"([^\"]+)\".*", "$1");

        UUID ticketUuid = UUID.fromString(ticketId);
        assertThat(jdbc.queryForObject(
                "select category from support_tickets where id = ?",
                String.class, ticketUuid)).isEqualTo("identity_dispute");
        String visibleText = jdbc.queryForObject(
                "select body from support_ticket_messages where ticket_id = ?",
                String.class, ticketUuid);
        assertThat(visibleText).doesNotContain(PAN, holder.getId().toString());
        String metadata = jdbc.queryForObject("""
                select metadata from audit_log
                where action = 'identity.dispute.opened' and entity_id = ?
                """, String.class, ticketId);
        assertThat(metadata)
                .contains("\"holderVerificationId\"", "\"docType\": \"pan\"")
                .doesNotContain(PAN);
    }

    @Test
    void dispute_redactsSeparatedAndLowercaseDocumentNumbersFromVisibleNote() throws Exception {
        User holder = user("9849000018");
        User challenger = user("9849000019");
        User reviewer = admin("9849000020");
        approveVerified(holder, reviewer, PAN);
        submitPan(challenger, PAN).andExpect(status().isConflict());

        String ticketId = dispute(challenger,
                "Aadhaar 1234 5678 9012 pan abcde-1234-f passport z-1234567 epic abc-1234567")
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()
                .replaceAll(".*\"ticketId\"\\s*:\\s*\"([^\"]+)\".*", "$1");

        String visibleText = jdbc.queryForObject(
                "select body from support_ticket_messages where ticket_id = ?",
                String.class, UUID.fromString(ticketId));
        assertThat(visibleText)
                .contains("[redacted]")
                .doesNotContain("1234 5678 9012", "abcde-1234-f", "z-1234567", "abc-1234567");
    }

    @Test
    void dispute_withoutRecentConflict_is409() throws Exception {
        User caller = user("9849000004");

        dispute(caller, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value(ErrorCodes.IDENTITY_NO_RECENT_CONFLICT));
    }

    @Test
    void submitConflict_recordsRecentConflictForDispute() throws Exception {
        User holder = user("9849000005");
        User challenger = user("9849000015");
        User reviewer = admin("9849000006");
        approveVerified(holder, reviewer, PAN);

        submitPan(challenger, PAN).andExpect(status().isConflict());

        Integer conflicts = jdbc.queryForObject(
                "select count(*) from identity_conflicts where user_id = ?",
                Integer.class, challenger.getId());
        assertThat(conflicts).isEqualTo(1);
    }

    @Test
    void dispute_refusesSecondOpenTicketForTheCaller() throws Exception {
        User firstHolder = user("9849000007");
        User secondHolder = user("9849000008");
        User challenger = user("9849000009");
        User reviewer = admin("9849000010");
        approveVerified(firstHolder, reviewer, PAN);
        approveVerified(secondHolder, reviewer, OTHER_PAN);

        submitPan(challenger, PAN).andExpect(status().isConflict());
        dispute(challenger, null).andExpect(status().isCreated());
        submitPan(challenger, OTHER_PAN).andExpect(status().isConflict());

        dispute(challenger, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error").value(ErrorCodes.IDENTITY_DISPUTE_OPEN));
    }

    @Test
    void submitConflict_rateLimitsAfterFiveRecentConflicts() throws Exception {
        User caller = user("9849000011");
        User holder = user("9849000016");
        User reviewer = admin("9849000017");
        approveVerified(holder, reviewer, PAN);
        for (int i = 0; i < 5; i++) {
            insertConflict(caller, "hmac-conflict-" + i);
        }

        submitPan(caller, PAN)
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value(ErrorCodes.RATE_LIMITED));
    }

    @Test
    void concurrentSubmitConflictsAreLockedAndRateLimited() throws Exception {
        User holder = user("9849000021");
        User challenger = user("9849000022");
        User reviewer = admin("9849000023");
        approveVerified(holder, reviewer, PAN);
        int requests = 10;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(requests);
        List<Future<Integer>> futures = new ArrayList<>();
        try {
            for (int i = 0; i < requests; i++) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return submitPan(challenger, PAN).andReturn().getResponse().getStatus();
                }));
            }
            start.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> future : futures) {
                statuses.add(future.get(30, TimeUnit.SECONDS));
            }

            Long conflicts = jdbc.queryForObject(
                    "select count(*) from identity_conflicts where user_id = ?",
                    Long.class, challenger.getId());
            assertThat(conflicts).isLessThanOrEqualTo(5);
            assertThat(statuses.stream().filter(status -> status == 429).count()).isGreaterThanOrEqualTo(5);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void submit_storesConsentLanguage_defaultsToEnglish_andRejectsUnknownLanguage() throws Exception {
        User marathi = user("9849000012");
        User english = user("9849000013");
        User bad = user("9849000014");

        mvc.perform(submission(marathi, IdentityDocTypes.PAN, false)
                        .param("claims", claims(PAN))
                        .param("consentLanguage", "mr"))
                .andExpect(status().isAccepted());
        mvc.perform(submission(english, IdentityDocTypes.PAN, false)
                        .param("claims", claims(OTHER_PAN)))
                .andExpect(status().isAccepted());

        assertThat(verifications.findByUserId(marathi.getId()).orElseThrow().getConsentLanguage())
                .isEqualTo("mr");
        assertThat(verifications.findByUserId(english.getId()).orElseThrow().getConsentLanguage())
                .isEqualTo("en");

        mvc.perform(submission(bad, IdentityDocTypes.PAN, false)
                        .param("consentLanguage", "ta"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value(ErrorCodes.BAD_REQUEST));
    }

    private void approveVerified(User holder, User reviewer, String number) throws Exception {
        tx().executeWithoutResult(status -> {
            String hash = hasher.docHash(IdentityDocTypes.PAN, IdentityNumbers.canonical(
                    IdentityDocTypes.PAN, number).orElseThrow());
            IdentityVerification v = new IdentityVerification(holder.getId(), IdentityDocTypes.PAN, Instant.now());
            v.setStatus(VerificationStatuses.VERIFIED);
            v.setIdentityHash(hash);
            v.setClaimedHash(hash);
            v.setDocLast4(IdentityNumbers.last4(number));
            v.setHolderName(holder.getName());
            v.setHolderDob(java.time.LocalDate.of(1991, 4, 12));
            v.setDecidedAt(Instant.now());
            v.setConsentNoticeVersion("2026-09");
            v.setConsentLanguage("en");
            verifications.saveAndFlush(v);
        });
    }

    private ResultActions dispute(User caller, String note) throws Exception {
        String body = note == null ? "{}" : "{\"note\":\"" + note + "\"}";
        return mvc.perform(post(Routes.Verification.IDENTITY_DISPUTE)
                .header(HttpHeaders.AUTHORIZATION, bearer(caller))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private ResultActions submitPan(User u, String number) throws Exception {
        return mvc.perform(submission(u, IdentityDocTypes.PAN, false).param("claims", claims(number)));
    }

    private ResultActions approve(User reviewer, UUID id, String number) throws Exception {
        return mvc.perform(post(Routes.Moderation.IDENTITY_REVIEW_APPROVE.replace("{id}", id.toString()))
                .header(HttpHeaders.AUTHORIZATION, bearer(reviewer))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"number\":\"" + number + "\",\"name\":\"Asha Patil\",\"dob\":\"1991-04-12\"}"));
    }

    private MockMultipartHttpServletRequestBuilder submission(User u, String docType, boolean back) {
        MockMultipartHttpServletRequestBuilder b = multipart(Routes.Verification.IDENTITY)
                .file(png("front"))
                .file(png("selfie"))
                .param("docType", docType)
                .param("consent", "true")
                .header(HttpHeaders.AUTHORIZATION, bearer(u));
        return back ? b.file(png("back")) : b;
    }

    private static MockMultipartFile png(String field) {
        byte[] pngMagic = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0};
        return new MockMultipartFile(field, field + ".png", "image/png", pngMagic);
    }

    private static String claims(String number) {
        return "{\"number\":\"" + number + "\",\"name\":\"Asha Patil\",\"dob\":\"1991-04-12\"}";
    }

    private User user(String mobile) {
        return person(mobile, Roles.Wire.BUYER, "Asha Patil");
    }

    private User admin(String mobile) {
        return person(mobile, Roles.Wire.ADMIN, "Ops Admin");
    }

    private User person(String mobile, String role, String name) {
        return tx().execute(status -> {
            User u = new User(mobile, role);
            u.setName(name);
            u.setMobileVerified(true);
            return users.saveAndFlush(u);
        });
    }

    private void insertConflict(User caller, String hash) {
        tx().executeWithoutResult(status -> jdbc.update("""
                insert into identity_conflicts (user_id, doc_type, claimed_hash)
                values (?, 'pan', ?)
                """, caller.getId(), hash));
    }

    private TransactionTemplate tx() {
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return tx;
    }
}
