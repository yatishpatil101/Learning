package com.draazy.api.admin.staff;

import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.BackOfficeFunctions;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.sql.Timestamp;
import java.time.Instant;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

@DisplayName("Team performance endpoint")
class TeamPerformanceEndpointTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Test
    void managerGetsStaffShapeCountsAndKycQueue() throws Exception {
        User manager = person("9866100001", Roles.Wire.MANAGER);
        User staff = person("9866100002", Roles.Wire.STAFF);
        User applicant = person("9866100003", Roles.Wire.BUYER);
        grant(staff, BackOfficeFunctions.LISTING_MODERATION);
        auditRow(staff, "property.status", "property");
        Instant submittedAt = Instant.now().minusSeconds(7_200);
        jdbc.update("""
                INSERT INTO identity_verifications
                  (id, user_id, status, doc_type, consent_at, submitted_at, attempt_count,
                   attempt_window_start, created_at, updated_at)
                VALUES (gen_random_uuid(), ?, 'pending', 'aadhaar', ?, ?, 1, ?, ?, ?)
                """, applicant.getId(), Timestamp.from(submittedAt), Timestamp.from(submittedAt),
                Timestamp.from(submittedAt), Timestamp.from(submittedAt), Timestamp.from(submittedAt));

        mvc.perform(get(Routes.Admin.TEAM_PERFORMANCE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(manager)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.windowDays").value(7))
                .andExpect(jsonPath("$.staff[?(@.id == '" + staff.getId() + "')].name",
                        hasItem(staff.getName())))
                .andExpect(jsonPath("$.staff[?(@.id == '" + staff.getId() + "')].handled",
                        hasItem(1)))
                .andExpect(jsonPath("$.staff[?(@.id == '" + staff.getId()
                        + "')].functions[0]", hasItem(BackOfficeFunctions.LISTING_MODERATION)))
                .andExpect(jsonPath("$.staff[?(@.id == '" + staff.getId()
                        + "')].byFunction.listingModeration", hasItem(1)))
                .andExpect(jsonPath("$.queues[?(@.function == 'kyc')].open",
                        Matchers.hasItem(Matchers.greaterThanOrEqualTo(1))))
                .andExpect(jsonPath("$.queues[?(@.function == 'kyc')].oldestWaitingSince")
                        .isNotEmpty());
    }

    @Test
    void acceptsThirtyDaysAndRejectsOtherWindows() throws Exception {
        User manager = person("9866100004", Roles.Wire.MANAGER);

        mvc.perform(get(Routes.Admin.TEAM_PERFORMANCE)
                        .param("days", "30")
                        .header(HttpHeaders.AUTHORIZATION, bearer(manager)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.windowDays").value(30));

        mvc.perform(get(Routes.Admin.TEAM_PERFORMANCE)
                        .param("days", "5")
                        .header(HttpHeaders.AUTHORIZATION, bearer(manager)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void rejectsNonManagers() throws Exception {
        User staff = person("9866100005", Roles.Wire.STAFF);
        User buyer = person("9866100006", Roles.Wire.BUYER);

        mvc.perform(get(Routes.Admin.TEAM_PERFORMANCE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isForbidden());

        mvc.perform(get(Routes.Admin.TEAM_PERFORMANCE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isForbidden());

        mvc.perform(get(Routes.Admin.TEAM_PERFORMANCE))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void myWorkShowsOnlyTheCallerAndTheirQueues() throws Exception {
        User staff = person("9866100007", Roles.Wire.STAFF);
        User colleague = person("9866100008", Roles.Wire.STAFF);
        grant(staff, BackOfficeFunctions.KYC);
        grant(colleague, BackOfficeFunctions.KYC);
        auditRow(staff, "identity.verification.approve", "identity_verification");
        auditRow(colleague, "identity.verification.reject", "identity_verification");

        mvc.perform(get(Routes.Admin.MY_WORK)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.windowDays").value(7))
                .andExpect(jsonPath("$.staff", Matchers.hasSize(1)))
                .andExpect(jsonPath("$.staff[0].id").doesNotExist())
                .andExpect(jsonPath("$.staff[0].name").value(staff.getName()))
                .andExpect(jsonPath("$.staff[0].functions", Matchers.contains(BackOfficeFunctions.KYC)))
                .andExpect(jsonPath("$.staff[0].handled").value(1))
                .andExpect(jsonPath("$.staff[0].byFunction.kyc").value(1))
                .andExpect(jsonPath("$.queues[*].function", Matchers.contains(BackOfficeFunctions.KYC)))
                .andExpect(jsonPath("$.queues[0].medianDecisionMinutes").doesNotExist());
    }

    @Test
    void myWorkQueuesAreScopedToTheCallersFunctions() throws Exception {
        User staff = person("9866100010", Roles.Wire.STAFF);
        User applicant = person("9866100011", Roles.Wire.BUYER);
        grant(staff, BackOfficeFunctions.SUPPORT);
        Instant submittedAt = Instant.now().minusSeconds(3_600);
        jdbc.update("""
                INSERT INTO identity_verifications
                  (id, user_id, status, doc_type, consent_at, submitted_at, attempt_count,
                   attempt_window_start, created_at, updated_at)
                VALUES (gen_random_uuid(), ?, 'pending', 'aadhaar', ?, ?, 1, ?, ?, ?)
                """, applicant.getId(), Timestamp.from(submittedAt), Timestamp.from(submittedAt),
                Timestamp.from(submittedAt), Timestamp.from(submittedAt), Timestamp.from(submittedAt));

        mvc.perform(get(Routes.Admin.MY_WORK)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.queues[*].function", Matchers.contains(BackOfficeFunctions.SUPPORT)));

        User verifier = person("9866100012", Roles.Wire.STAFF);
        grant(verifier, BackOfficeFunctions.KYC);

        mvc.perform(get(Routes.Admin.MY_WORK)
                        .header(HttpHeaders.AUTHORIZATION, bearer(verifier)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.queues[?(@.function == 'kyc')].open",
                        Matchers.hasItem(Matchers.greaterThanOrEqualTo(1))))
                .andExpect(jsonPath("$.queues[?(@.function == 'kyc')].oldestWaitingSince").isNotEmpty());
    }

    @Test
    void myWorkCountsTheBacklogOfEveryQueueFunctionTheCallerHolds() throws Exception {
        User staff = person("9866100013", Roles.Wire.STAFF);
        grant(staff, BackOfficeFunctions.REVIEWS, BackOfficeFunctions.ENQUIRIES,
                BackOfficeFunctions.SOCIETIES, BackOfficeFunctions.REFERRALS,
                BackOfficeFunctions.FLATMATES);
        jdbc.update("INSERT INTO reviews (target_type, target_id, rating, status) VALUES ('property', 'p-1', 4, 'pending')");
        jdbc.update("INSERT INTO societies (slug, name, source) VALUES ('team-perf-society', 'Team Perf Society', 'community')");
        jdbc.update("INSERT INTO referrals (referred, status) VALUES ('Referee', 'pending')");

        mvc.perform(get(Routes.Admin.MY_WORK)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.queues[*].function", Matchers.containsInAnyOrder(
                        BackOfficeFunctions.REVIEWS, BackOfficeFunctions.ENQUIRIES,
                        BackOfficeFunctions.SOCIETIES, BackOfficeFunctions.REFERRALS,
                        BackOfficeFunctions.FLATMATES)))
                .andExpect(jsonPath("$.queues[?(@.function == 'reviews')].open",
                        hasItem(Matchers.greaterThanOrEqualTo(1))))
                .andExpect(jsonPath("$.queues[?(@.function == 'societies')].open",
                        hasItem(Matchers.greaterThanOrEqualTo(1))))
                .andExpect(jsonPath("$.queues[?(@.function == 'referrals')].open",
                        hasItem(Matchers.greaterThanOrEqualTo(1))))
                .andExpect(jsonPath("$.queues[?(@.function == 'referrals')].oldestWaitingSince")
                        .isNotEmpty());
    }

    @Test
    void myWorkOmitsQueuesOfFunctionsTheCallerDoesNotHold() throws Exception {
        User staff = person("9866100014", Roles.Wire.STAFF);
        grant(staff, BackOfficeFunctions.REVIEWS);

        mvc.perform(get(Routes.Admin.MY_WORK)
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.queues[*].function", Matchers.contains(BackOfficeFunctions.REVIEWS)));
    }

    @Test
    void myWorkRejectsBadWindowAndAnonymous() throws Exception {
        User staff = person("9866100009", Roles.Wire.STAFF);
        grant(staff, BackOfficeFunctions.KYC);

        mvc.perform(get(Routes.Admin.MY_WORK)
                        .param("days", "14")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff)))
                .andExpect(status().isBadRequest());

        mvc.perform(get(Routes.Admin.MY_WORK))
                .andExpect(status().isUnauthorized());
    }

    private User person(String mobile, String role) {
        User user = new User(mobile, role);
        user.setName("Team " + role + " " + mobile);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private void grant(User user, String... functions) {
        jdbc.update("""
                INSERT INTO back_office_permissions (user_id, permissions)
                VALUES (?, ?::jsonb)
                ON CONFLICT (user_id) DO UPDATE SET permissions = excluded.permissions
                """, user.getId(), "[\"" + String.join("\",\"", functions) + "\"]");
    }

    private void auditRow(User actor, String action, String entity) {
        jdbc.update("""
                INSERT INTO audit_log (id, actor, actor_role, action, entity, entity_id, metadata, at)
                VALUES (gen_random_uuid(), ?, ?, ?, ?, 'team-performance-test', '{}', now())
                """, actor.getId().toString(), actor.getRole(), action, entity);
    }
}
