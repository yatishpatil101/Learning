package com.draazy.api.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/**
 * <strong>Proof that a role change lands on the caller's next request rather than when their token
 * expires</strong> (tech debt D201).
 *
 * <p>The back office offers two ways to take access away from a colleague, one screen apart: narrow
 * their permission document, or change their role. D192 made the first immediate — the document is
 * re-read on every request — and the second was left reading off the JWT, so a demoted administrator
 * kept administrator-level route access for the remaining life of a token that had already been
 * issued. Nothing in either call site said so, and the console presents the two gestures as though
 * they behave alike.
 *
 * <p>Every test here mints the token <em>once</em>, before the change, and reuses that same string
 * afterwards. That is the whole point: re-issuing would prove nothing, because a fresh token carries
 * the new role in its claims and would pass even with the fix removed.
 *
 * <p>{@code Routes.Admin.SETTINGS} is the probe because its guard is
 * {@code ADMIN_ONLY and REQUIRE_SETTINGS_READ} — the first half is a plain {@code hasRole('ADMIN')}
 * check, which is the half the permission document cannot reach and therefore the half D201 is
 * about. 403 rather than 404 for the same reason the neighbouring guard suites give: the denial
 * happens in {@code @PreAuthorize} before any row is read, so there is no row identity to hide.
 */
@DisplayName("D201 — a role change lands on the next request, not when the token expires")
class RoleChangeTakesEffectImmediatelyTest extends AbstractApiTest {

    @Autowired
    UserRepository users;

    private User save(String mobile, String role, String team) {
        User user = new User(mobile, role);
        user.setName("Role probe");
        user.setTeam(team);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private int status(String route, String bearer) throws Exception {
        return mvc.perform(get(route).header(HttpHeaders.AUTHORIZATION, bearer))
                .andReturn().getResponse().getStatus();
    }

    @Test
    @DisplayName("an administrator demoted to staff is refused on the very next call, same token")
    void demotionLandsBeforeTheTokenExpires() throws Exception {
        User account = save("9866030001", Roles.Wire.ADMIN, null);
        String token = bearer(account);

        assertThat(status(Routes.Admin.SETTINGS, token))
                .as("baseline: the token was minted while this account was an administrator")
                .isEqualTo(200);

        account.setRole(Roles.Wire.STAFF);
        account.setTeam(Teams.RENTAL);
        users.saveAndFlush(account);

        assertThat(status(Routes.Admin.SETTINGS, token))
                .as("same token, demoted account — the admin route must refuse it now")
                .isEqualTo(403);
    }

    /**
     * The mirror case, and not redundant: it rules out a fix that reads "distrust the token and
     * assume the weaker role". The rule is the stored role, whichever direction it moved.
     */
    @Test
    @DisplayName("a promotion lands the same way, so the rule is the stored role and not the lower of the two")
    void promotionLandsOnTheSameTerms() throws Exception {
        User account = save("9866030002", Roles.Wire.STAFF, Teams.RENTAL);
        String token = bearer(account);

        assertThat(status(Routes.Admin.SETTINGS, token))
                .as("baseline: staff have no business on the settings route")
                .isEqualTo(403);

        account.setRole(Roles.Wire.ADMIN);
        users.saveAndFlush(account);

        assertThat(status(Routes.Admin.SETTINGS, token))
                .as("same token, promoted account — the admin route must admit it now")
                .isEqualTo(200);
    }
}
