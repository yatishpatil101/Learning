package com.draazy.api.engagement.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.support.AbstractApiTest;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.test.util.AopTestUtils;

/**
 * The writer half of tech debt D94: server-written notifications honour the stored preferences.
 *
 * <p><strong>Written against the {@link Notifier} port, deliberately.</strong> That interface is
 * the object all eight server-side notification writers hold — visits, offers, contact requests,
 * messages, document grants and listing moderation each inject {@code Notifier} and call
 * {@code notify}. Asserting through it proves the rule for every one of them, and for the ninth
 * writer nobody has written yet, which asserting through any single writer would not.
 *
 * <p>The clock is pinned on the real bean (via the target behind its transactional proxy) so a
 * write can be placed at 23:00 or 03:00 without waiting for either, and restored afterwards so no
 * later test in the shared context inherits a fixed instant.
 */
@DisplayName("Notification delivery — quiet hours defer, the master switch drops (D94)")
class NotificationDeliveryPreferencesTest extends AbstractApiTest {

    /** A future quiet window: whatever it defers to is still in the future at real "now". */
    private static final ZonedDateTime FUTURE_NIGHT =
            ZonedDateTime.of(2027, 1, 10, 23, 0, 0, 0, PlatformTime.IST);

    private static final ZonedDateTime FUTURE_SMALL_HOURS =
            ZonedDateTime.of(2027, 1, 11, 3, 0, 0, 0, PlatformTime.IST);

    private static final ZonedDateTime FUTURE_MIDDAY =
            ZonedDateTime.of(2027, 1, 10, 12, 0, 0, 0, PlatformTime.IST);

    /** A quiet window that has already closed, for proving a deferred row is released. */
    private static final ZonedDateTime PAST_NIGHT =
            ZonedDateTime.of(2025, 1, 10, 23, 0, 0, 0, PlatformTime.IST);

    @Autowired
    UserRepository users;

    @Autowired
    NotificationPreferenceRepository preferences;

    @Autowired
    Notifier notifier;

    @Autowired
    NotificationPublisher publisher;

    @AfterEach
    void unpinTheClock() {
        target().useClock(Clock.systemUTC());
    }

    /** The bean behind the transactional proxy — the instance whose field the clock lives on. */
    private NotificationPublisher target() {
        return AopTestUtils.getTargetObject(publisher);
    }

    private void writeAt(ZonedDateTime istWallClock, UUID recipient, String type) {
        target().useClock(Clock.fixed(istWallClock.toInstant(), ZoneOffset.UTC));
        notifier.notify(recipient, type, "Something happened", "A short preview.", "/dashboard");
    }

    private User user(String mobile) {
        User u = new User(mobile, "buyer");
        u.setName("Sleeper " + mobile.substring(6));
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /** Quiet hours on, with the given window. Every other preference stays at its default. */
    private void quietHours(User u, String start, String end) {
        preferences.saveAndFlush(withPreferences(u, true, start, end, true));
    }

    private NotificationPreference withPreferences(
            User u, boolean quietEnabled, String start, String end, boolean matchAlerts) {
        NotificationPreference row = preferences.findById(u.getId())
                .orElseGet(() -> new NotificationPreference(u.getId()));
        row.replace(true, false, true, matchAlerts, quietEnabled, start, end, "en");
        return row;
    }

    /** The stored {@code deliver_after}, or null when the notification is deliverable now. */
    private Instant deferredUntil(User u) {
        Timestamp stamp = jdbc.queryForObject(
                "select deliver_after from notifications where user_id = ?", Timestamp.class, u.getId());
        return stamp == null ? null : stamp.toInstant();
    }

    private int inboxSize(User u) throws Exception {
        String json = mvc.perform(get("/notifications").header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        // `content` is the PageResponse envelope's array field.
        return com.jayway.jsonpath.JsonPath.parse(json).read("$.content.length()");
    }

    // ============================== quiet hours: the window ==============================

    @Test
    @DisplayName("outside the quiet window the notification is delivered immediately")
    void deliveredOutsideQuietHours() throws Exception {
        User u = user("9800000201");
        quietHours(u, "22:00", "07:00");

        writeAt(FUTURE_MIDDAY, u.getId(), "offer.received");

        assertThat(deferredUntil(u))
                .as("midday is not inside a 22:00-07:00 window; nothing should be held back")
                .isNull();
        assertThat(inboxSize(u)).isEqualTo(1);
    }

    @Test
    @DisplayName("at 23:00 a window that crosses midnight defers to the NEXT morning")
    void wrappingWindowBeforeMidnightDefersToTomorrow() throws Exception {
        User u = user("9800000202");
        quietHours(u, "22:00", "07:00");

        writeAt(FUTURE_NIGHT, u.getId(), "offer.received");

        assertThat(deferredUntil(u))
                .as("23:00 on the 10th is inside 22:00-07:00, which closes at 07:00 on the 11th — "
                        + "the same-day answer would release it 16 hours early, before the user slept")
                .isEqualTo(ZonedDateTime.of(2027, 1, 11, 7, 0, 0, 0, PlatformTime.IST).toInstant());
        assertThat(inboxSize(u))
                .as("held back until the window closes")
                .isZero();
    }

    @Test
    @DisplayName("at 03:00 the same window defers to THIS morning, hours later not a day later")
    void wrappingWindowAfterMidnightDefersToThisMorning() throws Exception {
        User u = user("9800000203");
        quietHours(u, "22:00", "07:00");

        writeAt(FUTURE_SMALL_HOURS, u.getId(), "offer.received");

        assertThat(deferredUntil(u))
                .as("03:00 on the 11th is the tail of the window that opened on the 10th; it closes "
                        + "at 07:00 that same morning")
                .isEqualTo(ZonedDateTime.of(2027, 1, 11, 7, 0, 0, 0, PlatformTime.IST).toInstant());
        assertThat(inboxSize(u)).isZero();
    }

    @Test
    @DisplayName("a same-day window (09:00-17:00) works too, and 23:00 falls outside it")
    void nonWrappingWindow() throws Exception {
        User u = user("9800000204");
        quietHours(u, "09:00", "17:00");

        writeAt(FUTURE_MIDDAY, u.getId(), "offer.received");
        assertThat(deferredUntil(u))
                .as("12:00 is inside 09:00-17:00")
                .isEqualTo(ZonedDateTime.of(2027, 1, 10, 17, 0, 0, 0, PlatformTime.IST).toInstant());

        jdbc.update("delete from notifications where user_id = ?", u.getId());

        writeAt(FUTURE_NIGHT, u.getId(), "offer.received");
        assertThat(deferredUntil(u))
                .as("23:00 is outside 09:00-17:00 — a non-wrapping window must not be read as if it "
                        + "wrapped")
                .isNull();
    }

    @Test
    @DisplayName("once the window has closed the deferred notification appears, nothing sweeps it")
    void deferredNotificationIsReleasedWhenTheWindowCloses() throws Exception {
        User u = user("9800000205");
        quietHours(u, "22:00", "07:00");

        writeAt(PAST_NIGHT, u.getId(), "offer.received");

        assertThat(deferredUntil(u))
                .as("it was deferred at write time")
                .isEqualTo(ZonedDateTime.of(2025, 1, 11, 7, 0, 0, 0, PlatformTime.IST).toInstant());
        assertThat(inboxSize(u))
                .as("that instant has passed, so the row is due — released by the read's comparison "
                        + "against now(), with no job having run")
                .isEqualTo(1);
    }

    @Test
    @DisplayName("quiet hours are DEFERRED, never dropped — the row exists throughout")
    void quietHoursNeverLoseTheNotification() throws Exception {
        User u = user("9800000206");
        quietHours(u, "22:00", "07:00");

        writeAt(FUTURE_NIGHT, u.getId(), "offer.received");

        Integer rows = jdbc.queryForObject(
                "select count(*) from notifications where user_id = ?", Integer.class, u.getId());
        assertThat(rows)
                .as("the inbox is the only place a notification is ever read, so suppressing one "
                        + "would permanently lose the event. It must be on disk even while hidden")
                .isEqualTo(1);
        assertThat(inboxSize(u)).isZero();
    }

    // ============================== quiet hours: the edges ==============================

    @Test
    @DisplayName("quiet hours switched off never defer, whatever the window says")
    void disabledQuietHoursNeverDefer() throws Exception {
        User u = user("9800000207");
        preferences.saveAndFlush(withPreferences(u, false, "22:00", "07:00", true));

        writeAt(FUTURE_NIGHT, u.getId(), "offer.received");

        assertThat(deferredUntil(u)).isNull();
        assertThat(inboxSize(u)).isEqualTo(1);
    }

    @Test
    @DisplayName("start == end means never, not always")
    void degenerateWindowMeansNever() throws Exception {
        User u = user("9800000208");
        quietHours(u, "22:00", "22:00");

        writeAt(FUTURE_NIGHT, u.getId(), "offer.received");

        assertThat(deferredUntil(u))
                .as("reading a zero-length window as a whole day would mute a user permanently for "
                        + "dragging two sliders together")
                .isNull();
    }

    @Test
    @DisplayName("a user with no preferences row behaves exactly as before this slice")
    void absentPreferencesRowIsNotSilence() throws Exception {
        User u = user("9800000209");

        writeAt(FUTURE_NIGHT, u.getId(), "offer.received");

        assertThat(preferences.findById(u.getId())).isEmpty();
        assertThat(deferredUntil(u))
                .as("quiet hours default to OFF; an account that never opened Settings must not be "
                        + "quieted 22:00-07:00 by a deploy")
                .isNull();
        assertThat(inboxSize(u)).isEqualTo(1);
    }

    // ============================== the master switch ==============================

    @Test
    @DisplayName("matchAlerts off stops match alerts")
    void masterSwitchOffStopsMatchAlerts() throws Exception {
        User u = user("9800000210");
        preferences.saveAndFlush(withPreferences(u, false, "22:00", "07:00", false));

        writeAt(FUTURE_MIDDAY, u.getId(), "match.saved-search");

        Integer rows = jdbc.queryForObject(
                "select count(*) from notifications where user_id = ?", Integer.class, u.getId());
        assertThat(rows)
                .as("the master switch drops rather than defers: there is no later moment at which "
                        + "the user wants an alert they switched off")
                .isZero();
        assertThat(inboxSize(u)).isZero();
    }

    @Test
    @DisplayName("matchAlerts off does NOT silence events the user is a party to")
    void masterSwitchDoesNotSilenceTransactionalEvents() throws Exception {
        User u = user("9800000211");
        preferences.saveAndFlush(withPreferences(u, false, "22:00", "07:00", false));

        writeAt(FUTURE_MIDDAY, u.getId(), "offer.received");

        assertThat(inboxSize(u))
                .as("\"New match alerts\" is a narrow switch. Reading it as a global mute would lose "
                        + "an offer on the user's own listing, which they never asked to stop hearing "
                        + "about")
                .isEqualTo(1);
    }

    @Test
    @DisplayName("matchAlerts on leaves match alerts alone")
    void masterSwitchOnDeliversMatchAlerts() throws Exception {
        User u = user("9800000212");
        preferences.saveAndFlush(withPreferences(u, false, "22:00", "07:00", true));

        writeAt(FUTURE_MIDDAY, u.getId(), "match.saved-search");

        assertThat(inboxSize(u)).isEqualTo(1);
    }
}
