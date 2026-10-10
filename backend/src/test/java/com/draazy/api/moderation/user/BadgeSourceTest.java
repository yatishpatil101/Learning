package com.draazy.api.moderation.user;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

@DisplayName("The back office sees where a Verified badge came from")
class BadgeSourceTest extends AbstractApiTest {

    @Autowired UserRepository users;
    @PersistenceContext EntityManager em;

    private User person(String mobile, String role) {
        User user = new User(mobile, role);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private void readBadgeSource(User actor, User target, String expected) throws Exception {
        var result = mvc.perform(get(Routes.Users.BASE).param("q", target.getMobile())
                        .header(HttpHeaders.AUTHORIZATION, bearer(actor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1));
        if (expected == null) {
            result.andExpect(jsonPath("$.content[0].badgeSource").doesNotExist());
        } else {
            result.andExpect(jsonPath("$.content[0].badgeSource").value(expected));
        }
    }

    @Test
    void identityManualAndNone() throws Exception {
        User actor = person("9877000301", Roles.Wire.ADMIN);
        User earned = person("9877000302", Roles.Wire.OWNER);
        User byHand = person("9877000303", Roles.Wire.OWNER);
        User none = person("9877000304", Roles.Wire.OWNER);
        jdbc.update("UPDATE users SET verified = true WHERE id in (?, ?)", earned.getId(), byHand.getId());
        jdbc.update("""
                insert into identity_verifications
                       (user_id, status, doc_type, doc_last4, holder_name, holder_dob, identity_hash,
                        consent_at, submitted_at, attempt_count, attempt_window_start, decided_at)
                values (?, 'verified', 'pan', 'D123', 'Earned Badge', date '1985-03-03', ?,
                        now(), now(), 1, now(), now())
                """, earned.getId(), "hmac-" + earned.getId());
        em.clear();

        readBadgeSource(actor, earned, "identity");
        readBadgeSource(actor, byHand, "manual");
        readBadgeSource(actor, none, null);
    }

    @Test
    void ownProfileNeverCarriesIt() throws Exception {
        User self = person("9877000305", Roles.Wire.OWNER);
        mvc.perform(get(Routes.Auth.ME).header(HttpHeaders.AUTHORIZATION, bearer(self)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.badgeSource").doesNotExist());
    }
}
