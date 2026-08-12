package com.punenest.api.engagement.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

/**
 * {@code GET/PUT /me/notification-preferences} — the endpoint half of tech debt D94 and D15.
 *
 * <p>The load-bearing assertions are: an absent row reads as today's behaviour and never as
 * silence; the document round-trips field for field under the names the browser already uses; and
 * one user's settings are unreachable from another user's session.
 */
@DisplayName("Notification preferences — the contract (D94, D15)")
class NotificationPreferencesEndpointTest extends AbstractApiTest {

    private static final String PATH = "/me/notification-preferences";

    @Autowired
    UserRepository users;

    @Autowired
    NotificationPreferenceRepository preferences;

    private User user(String mobile) {
        User u = new User(mobile, "buyer");
        u.setName("Prefs User " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /** The full document, so a test can vary one field without restating the shape five times. */
    private static String body(boolean email, boolean sms, boolean whatsapp, boolean matchAlerts,
            boolean quietEnabled, String start, String end, String language) {
        return """
                {"email":%s,"sms":%s,"whatsapp":%s,"matchAlerts":%s,
                 "quietHours":{"enabled":%s,"start":"%s","end":"%s"},
                 "language":"%s"}
                """
                .formatted(email, sms, whatsapp, matchAlerts, quietEnabled, start, end, language);
    }

    // ============================== defaults ==============================

    @Test
    @DisplayName("a user who has never saved settings gets the defaults, not an empty document")
    void getReturnsDefaultsForUserWhoNeverSaved() throws Exception {
        User u = user("9800000101");

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(true))
                .andExpect(jsonPath("$.sms").value(false))
                .andExpect(jsonPath("$.whatsapp").value(true))
                .andExpect(jsonPath("$.matchAlerts").value(true))
                .andExpect(jsonPath("$.quietHours.enabled").value(false))
                .andExpect(jsonPath("$.quietHours.start").value("22:00"))
                .andExpect(jsonPath("$.quietHours.end").value("07:00"))
                .andExpect(jsonPath("$.language").value("en"));

        assertThat(preferences.findById(u.getId()))
                .as("reading preferences must not create a row — an absent row IS the default, and "
                        + "materialising one on every read would turn a GET into a write")
                .isEmpty();
    }

    @Test
    @DisplayName("the service's defaults and V73's column defaults are the same document")
    void serviceDefaultsMatchTheDatabaseColumnDefaults() throws Exception {
        // Three copies of these values exist by necessity (browser, database, service). This is the
        // one that can be checked from here: insert a row naming nothing but the user, so every
        // value comes from V73, and read it back through the service's mapper.
        User u = user("9800000102");
        jdbc.update("insert into notification_preferences (user_id) values (?)", u.getId());

        NotificationPreferencesDto fromDatabaseDefaults =
                NotificationPreferencesDto.of(preferences.findById(u.getId()).orElseThrow());

        assertThat(fromDatabaseDefaults)
                .as("V73's column defaults have drifted from NotificationPreferenceService.DEFAULTS."
                        + " A row created by raw SQL would then behave differently from an account "
                        + "with no row at all")
                .isEqualTo(NotificationPreferenceService.DEFAULTS);
    }

    // ============================== round trip ==============================

    @Test
    @DisplayName("PUT round-trips every field, and a later GET agrees with the PUT's own answer")
    void putRoundTripsEveryField() throws Exception {
        User u = user("9800000103");

        // Every field flipped away from its default, so no assertion can pass by accident.
        mvc.perform(put(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(false, true, false, false, true, "21:30", "06:15", "mr")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(false))
                .andExpect(jsonPath("$.sms").value(true))
                .andExpect(jsonPath("$.whatsapp").value(false))
                .andExpect(jsonPath("$.matchAlerts").value(false))
                .andExpect(jsonPath("$.quietHours.enabled").value(true))
                .andExpect(jsonPath("$.quietHours.start").value("21:30"))
                .andExpect(jsonPath("$.quietHours.end").value("06:15"))
                .andExpect(jsonPath("$.language").value("mr"));

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(false))
                .andExpect(jsonPath("$.sms").value(true))
                .andExpect(jsonPath("$.whatsapp").value(false))
                .andExpect(jsonPath("$.matchAlerts").value(false))
                .andExpect(jsonPath("$.quietHours.enabled").value(true))
                .andExpect(jsonPath("$.quietHours.start").value("21:30"))
                .andExpect(jsonPath("$.quietHours.end").value("06:15"))
                .andExpect(jsonPath("$.language").value("mr"));
    }

    @Test
    @DisplayName("PUT is an upsert — saving twice updates the one row rather than adding a second")
    void putIsAnUpsert() throws Exception {
        User u = user("9800000104");

        mvc.perform(put(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(false, true, false, false, true, "23:00", "05:00", "hi")))
                .andExpect(status().isOk());

        mvc.perform(put(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(true, false, true, true, false, "22:00", "07:00", "en")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.language").value("en"));

        Integer rows = jdbc.queryForObject(
                "select count(*) from notification_preferences where user_id = ?",
                Integer.class, u.getId());
        assertThat(rows)
                .as("the primary key is the user id, so a second save must update rather than insert")
                .isEqualTo(1);
    }

    // ============================== isolation ==============================

    @Test
    @DisplayName("one user can neither read nor write another user's preferences")
    void preferencesAreStrictlyCallerScoped() throws Exception {
        User a = user("9800000105");
        User b = user("9800000106");

        mvc.perform(put(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(a))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(false, true, false, false, true, "20:00", "04:00", "hi")))
                .andExpect(status().isOk());

        // B sees the defaults, not A's document. There is no parameter on this endpoint through
        // which B could name A — the assertion is that the principal is genuinely the scope.
        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(b)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matchAlerts").value(true))
                .andExpect(jsonPath("$.language").value("en"))
                .andExpect(jsonPath("$.quietHours.enabled").value(false));

        // And B writing does not disturb A.
        mvc.perform(put(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(b))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(true, true, true, true, false, "22:00", "07:00", "mr")))
                .andExpect(status().isOk());

        mvc.perform(get(PATH).header(HttpHeaders.AUTHORIZATION, bearer(a)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.matchAlerts").value(false))
                .andExpect(jsonPath("$.language").value("hi"))
                .andExpect(jsonPath("$.quietHours.start").value("20:00"));
    }

    @Test
    @DisplayName("an anonymous caller gets nothing")
    void anonymousIsRejected() throws Exception {
        mvc.perform(get(PATH)).andExpect(status().isUnauthorized());
    }

    // ============================== validation ==============================

    @Test
    @DisplayName("a malformed quiet-hours time is refused, not stored")
    void malformedQuietHoursIsRejected() throws Exception {
        User u = user("9800000107");

        mvc.perform(put(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(true, false, true, true, true, "25:00", "07:00", "en")))
                .andExpect(status().isUnprocessableEntity());

        assertThat(preferences.findById(u.getId()))
                .as("a rejected write must leave no row behind")
                .isEmpty();
    }

    @Test
    @DisplayName("a language the app does not ship is a 422 here, not a 500 from V73's CHECK")
    void unknownLanguageIsRejected() throws Exception {
        User u = user("9800000108");

        mvc.perform(put(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body(true, false, true, true, false, "22:00", "07:00", "fr")))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("an omitted field is refused — this is a PUT, not a patch wearing a PUT's verb")
    void omittedFieldIsRejected() throws Exception {
        User u = user("9800000109");

        mvc.perform(put(PATH)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":true,"sms":false,"whatsapp":true,
                                 "quietHours":{"enabled":false,"start":"22:00","end":"07:00"},
                                 "language":"en"}
                                """))
                .andExpect(status().isUnprocessableEntity());
    }
}
