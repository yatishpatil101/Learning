package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

@DisplayName("Flatmate posts expire after 30 days and stay on the owner's dashboard")
class FlatmateExpiryTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    @Autowired
    FlatmateExpiryService expiry;

    @Autowired
    EntityManager entityManager;

    private final List<String> createdActors = new ArrayList<>();

    @AfterEach
    void removeAuditRowsThatEscapedRollback() {
        createdActors.forEach(actor -> jdbc.update("delete from audit_log where actor = ?", actor));
        createdActors.clear();
    }

    private User user(String mobile, String name) {
        User u = new User(mobile, Roles.Wire.BUYER);
        u.setName(name);
        u.setMobileVerified(true);
        User saved = users.saveAndFlush(u);
        createdActors.add(saved.getId().toString());
        return saved;
    }

    private static String body(String name, String locality, String note) {
        return """
                {"name":"%s","gender":"female","age":26,"occupation":"UX Designer",
                 "budget":18000,"localities":["%s"],"moveIn":"2026-09-01",
                 "flatPref":"women","roomPref":"private","tags":["Vegetarian"],
                 "note":"%s"}
                """.formatted(name, locality, note);
    }

    private String approvedPost(User author, String locality) throws Exception {
        String json = mvc.perform(post(Routes.Flatmates.POSTS)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(author.getName(), locality, "Quiet and tidy.")))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String id = json.replaceAll(".*\"id\"\\s*:\\s*\"([^\"]+)\".*", "$1");
        jdbc.update("update flatmate_seeker_posts set mod_status = 'approved' where id = ?::uuid", id);
        entityManager.clear();
        return id;
    }

    private void ageBy(String id, String interval) {
        jdbc.update("update flatmate_seeker_posts set active_until = now() - interval '" + interval
                + "' where id = ?::uuid", id);
        entityManager.clear();
    }

    private String modStatus(String id) {
        entityManager.flush();
        return jdbc.queryForObject("select mod_status from flatmate_seeker_posts where id = ?::uuid",
                String.class, id);
    }

    private int notices(User u, String type) {
        entityManager.flush();
        return jdbc.queryForObject("select count(*) from notifications where user_id = ? and type = ?",
                Integer.class, u.getId(), type);
    }

    private void onBoard(String locality, int size) throws Exception {
        entityManager.flush();
        mvc.perform(get(Routes.Flatmates.FEED).param("tab", "team-up").param("locality", locality))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content", Matchers.hasSize(size)));
    }

    @Test
    @DisplayName("a lapsed post leaves the board, stays on the dashboard, and the owner is told")
    void lapsedPostExpires() throws Exception {
        User author = user("9813000001", "Esha");
        String id = approvedPost(author, "ExpiryTownA");
        ageBy(id, "1 day");

        expiry.expireLapsed();

        assertThat(modStatus(id)).isEqualTo(FlatmateVocabulary.MOD_EXPIRED);
        onBoard("ExpiryTownA", 0);
        mvc.perform(get(Routes.Flatmates.MY_POSTS).header(HttpHeaders.AUTHORIZATION, bearer(author)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(id))
                .andExpect(jsonPath("$.content[0].modStatus").value("expired"));
        assertThat(notices(author, "flatmate.post.expired")).isEqualTo(1);
    }

    @Test
    @DisplayName("the reminder goes out once, three days ahead")
    void remindsOnce() throws Exception {
        User author = user("9813000002", "Farah");
        String id = approvedPost(author, "ExpiryTownB");
        jdbc.update("update flatmate_seeker_posts set active_until = now() + interval '2 days'"
                + " where id = ?::uuid", id);
        entityManager.clear();

        expiry.remindExpiring();
        expiry.remindExpiring();

        assertThat(notices(author, "flatmate.post.expiring")).isEqualTo(1);
        assertThat(modStatus(id)).isEqualTo("approved");
    }

    @Test
    @DisplayName("renew puts it back as it was, with no fresh review")
    void renewRestores() throws Exception {
        User author = user("9813000003", "Gauri");
        String id = approvedPost(author, "ExpiryTownC");
        ageBy(id, "1 day");
        expiry.expireLapsed();
        entityManager.flush();
        entityManager.clear();

        mvc.perform(post(Routes.Flatmates.RENEW, "post", id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author)))
                .andExpect(status().isNoContent());

        assertThat(modStatus(id)).isEqualTo("approved");
        assertThat(jdbc.queryForObject("select active_until > now() + interval '29 days'"
                + " from flatmate_seeker_posts where id = ?::uuid", Boolean.class, id)).isTrue();
        onBoard("ExpiryTownC", 1);
    }

    @Test
    @DisplayName("only the owner can renew")
    void renewIsOwnerOnly() throws Exception {
        User author = user("9813000004", "Hema");
        User stranger = user("9813000005", "Ira");
        String id = approvedPost(author, "ExpiryTownD");

        mvc.perform(post(Routes.Flatmates.RENEW, "post", id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isForbidden());
        mvc.perform(post(Routes.Flatmates.RENEW, "post", UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(author)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("editing an expired post revives it")
    void editRevives() throws Exception {
        User author = user("9813000006", "Jaya");
        String id = approvedPost(author, "ExpiryTownE");
        ageBy(id, "1 day");
        expiry.expireLapsed();
        entityManager.flush();
        entityManager.clear();

        mvc.perform(patch(Routes.Flatmates.POST_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(author))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body("Jaya", "ExpiryTownE", "Still looking.")))
                .andExpect(status().isOk());

        assertThat(modStatus(id)).isNotEqualTo(FlatmateVocabulary.MOD_EXPIRED);
    }

    @Test
    @DisplayName("an approved Tenant badge lapses 11 months after approval")
    void tenantBadgeIsCapped() {
        FlatmateReview review = new FlatmateReview("room", UUID.randomUUID(), null,
                UUID.randomUUID(), "Baner", FlatmateVocabulary.TIER_TENANT, false, false, null,
                new AgreementRegistration(), null);

        review.decide(FlatmateVocabulary.STATUS_APPROVED, null, UUID.randomUUID());

        assertThat(review.getAgreement().getValidTill())
                .isEqualTo(LocalDate.now().plusMonths(FlatmateReview.BADGE_MONTHS));
    }
}
