package com.punenest.api.engagement.pageview;

import static org.assertj.core.api.Assertions.assertThat;

import com.punenest.api.support.AbstractApiTest;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * The aggregation behind every analytics chart, proved against real rows.
 *
 * <p>The rollup is the only place raw page views are read at all, and everything the console
 * displays is derived from what it writes — so an error here is not a wrong pixel, it is a wrong
 * number presented with the authority of a measurement. It is also SQL rather than Java, which
 * means the compiler proves nothing about it and a test is the only thing standing between a
 * mistyped {@code filter} clause and a plausible-looking chart.
 *
 * <p><strong>Why the fixture is three sessions and not thirty.</strong> Each one is here to make a
 * specific way of getting this wrong fail: a multi-page session (which a naive count would treat as
 * several visitors), a single-page session (the bounce), and a session crossing IST midnight (the
 * case where "which day is this" stops being obvious). Rows beyond those would raise the totals
 * without raising the coverage.
 *
 * <p>Inherits {@code @Transactional} from {@link AbstractApiTest}, so every row here rolls back and
 * {@code punenest_test} keeps holding schema and nothing else.
 */
@DisplayName("Page view rollup")
class PageViewRollupTest extends AbstractApiTest {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    /**
     * A date far enough back that no seed or other test could have left raw views on it, and fixed
     * rather than relative to today so the assertions below are arithmetic a reader can check.
     */
    private static final LocalDate DAY = LocalDate.of(2031, 3, 17);

    @Autowired PageViewRollup rollup;

    @Test
    @DisplayName("counts sessions, page views, bounces and duration per IST day")
    void rollsUpDayGrain() {
        // Three pages over five minutes: one session, three views, not a bounce.
        view("sess-multi", null, "/listings", "mobile", at(DAY, 10, 0));
        view("sess-multi", null, "/property/:id", "mobile", at(DAY, 10, 2));
        view("sess-multi", null, "/property/:id/enquire", "mobile", at(DAY, 10, 5));

        // One page: a bounce, and a session of zero duration.
        view("sess-bounce", null, "/", "desktop", at(DAY, 11, 0));

        // Signed in, so the anon/signed-in split has something on both sides.
        view("sess-user", UUID.randomUUID(), "/dashboard", "tablet", at(DAY, 12, 0));
        view("sess-user", UUID.randomUUID(), "/dashboard/saved", "tablet", at(DAY, 12, 1));

        rollUpWholeDay();

        Map<String, Object> day = jdbc.queryForMap(
                "select * from page_view_daily where day = ?", DAY);

        assertThat(day.get("sessions"))
                .as("three distinct session ids, not six page views")
                .isEqualTo(3L);
        assertThat(day.get("pageviews")).isEqualTo(6L);
        assertThat(day.get("anon_sessions")).isEqualTo(2L);
        assertThat(day.get("signed_in_sessions"))
                .as("a session counts as signed in if any of its views carried a user id")
                .isEqualTo(1L);
        assertThat(day.get("bounced_sessions"))
                .as("only the single-view session bounced")
                .isEqualTo(1L);
        assertThat(day.get("duration_seconds_total"))
                .as("300s for the five-minute session, 60s for the signed-in one, 0 for the bounce")
                .isEqualTo(360L);
        assertThat(day.get("mobile_sessions")).isEqualTo(1L);
        assertThat(day.get("tablet_sessions")).isEqualTo(1L);
        assertThat(day.get("desktop_sessions")).isEqualTo(1L);
    }

    @Test
    @DisplayName("counts views and exits per path, and a path nobody left from still appears")
    void rollsUpPathGrain() {
        view("sess-a", null, "/listings", "mobile", at(DAY, 9, 0));
        view("sess-a", null, "/property/:id", "mobile", at(DAY, 9, 4));
        view("sess-b", null, "/listings", "mobile", at(DAY, 9, 30));

        rollUpWholeDay();

        assertThat(pathRow("/listings"))
                .as("viewed twice; one session stopped here, the other moved on")
                .containsEntry("pageviews", 2L)
                .containsEntry("anon_pageviews", 2L)
                .containsEntry("exits", 1L);

        assertThat(pathRow("/property/:id"))
                .as("the last page of sess-a")
                .containsEntry("pageviews", 1L)
                .containsEntry("exits", 1L);
    }

    @Test
    @DisplayName("a session crossing IST midnight is counted on both days, split where it breaks")
    void splitsSessionsAtMidnight() {
        view("sess-owl", null, "/listings", "mobile", at(DAY, 23, 58));
        view("sess-owl", null, "/property/:id", "mobile", at(DAY.plusDays(1), 0, 3));

        rollUpWholeDay();

        // Attributing the whole session to the day it started would leave the second day empty --
        // and would make every day's totals depend on re-reading the day before, which is the
        // property that lets the job recompute a short trailing window and stop.
        assertThat(sessionsOn(DAY)).isEqualTo(1L);
        assertThat(sessionsOn(DAY.plusDays(1))).isEqualTo(1L);

        assertThat(jdbc.queryForObject(
                "select duration_seconds_total from page_view_daily where day = ?",
                Long.class, DAY))
                .as("each side sees one view, so each side is a zero-length session-day")
                .isZero();
    }

    @Test
    @DisplayName("running twice produces the same aggregates, not doubled ones")
    void isIdempotent() {
        view("sess-a", null, "/listings", "mobile", at(DAY, 10, 0));
        view("sess-a", null, "/property/:id", "mobile", at(DAY, 10, 1));

        rollUpWholeDay();
        rollUpWholeDay();

        // The job recomputes a trailing window every hour, so it revisits the same day many times
        // over. If it accumulated rather than replaced, today's traffic would climb all day on its
        // own -- believably, which is what would make it hard to notice.
        assertThat(sessionsOn(DAY)).isEqualTo(1L);
        assertThat(jdbc.queryForObject(
                "select pageviews from page_view_daily where day = ?", Long.class, DAY))
                .isEqualTo(2L);
        assertThat(jdbc.queryForObject(
                "select count(*) from page_view_daily_paths where day = ?", Long.class, DAY))
                .isEqualTo(2L);
    }

    @Test
    @DisplayName("a day whose raw views have gone loses its aggregate row rather than keeping stale totals")
    void recomputingWithoutRawRowsClearsTheDay() {
        view("sess-a", null, "/listings", "mobile", at(DAY, 10, 0));
        rollUpWholeDay();
        assertThat(sessionsOn(DAY)).isEqualTo(1L);

        jdbc.update("delete from page_views where session_id = 'sess-a'");
        rollUpWholeDay();

        // This is why the rollup deletes before inserting instead of upserting. An upsert only
        // corrects days that still produce a row, so a day emptied by the retention sweep would
        // keep its old totals for good -- wrong, and never revisited.
        assertThat(jdbc.queryForObject(
                "select count(*) from page_view_daily where day = ?", Long.class, DAY))
                .isZero();
    }

    @Test
    @DisplayName("attributes a session to the host it arrived from, once, whatever it read after")
    void rollsUpReferrerGrain() {
        // Arrived from search, then read three pages. Counting views would make this arrival look
        // three times the size of the one below it -- and the console presents these as reach.
        view("sess-search", null, "/", "mobile", "google.co.in", at(DAY, 10, 0));
        view("sess-search", null, "/listings", "mobile", "google.co.in", at(DAY, 10, 2));
        view("sess-search", null, "/property/:id", "mobile", "google.co.in", at(DAY, 10, 5));

        // Arrived from search too, so the host aggregates across sessions.
        view("sess-search-2", null, "/", "mobile", "google.co.in", at(DAY, 11, 0));

        // No referring header at all: typed, bookmarked, or withheld -- indistinguishable, and
        // reported as the one thing all three genuinely are.
        view("sess-typed", null, "/", "desktop", null, at(DAY, 12, 0));

        rollUpWholeDay();

        assertThat(referrerSessions("google.co.in"))
                .as("two sessions, not the four page views they made between them")
                .isEqualTo(2L);
        assertThat(referrerSessions(""))
                .as("a null host becomes the empty-string sentinel: it is half the primary key")
                .isEqualTo(1L);
    }

    @Test
    @DisplayName("a session's referrer is its first view's, not whichever view sorted first")
    void attributesTheEntryReferrer() {
        // A visitor arrives from search and later follows a link back in from WhatsApp inside the
        // same tab. Only the arrival is an acquisition; the second host is navigation.
        view("sess-mixed", null, "/", "mobile", "google.co.in", at(DAY, 9, 0));
        view("sess-mixed", null, "/listings", "mobile", "wa.me", at(DAY, 9, 30));

        rollUpWholeDay();

        assertThat(referrerSessions("google.co.in")).isEqualTo(1L);
        assertThat(jdbc.queryForObject(
                "select count(*) from page_view_daily_referrers where day = ?", Long.class, DAY))
                .as("one session contributes to exactly one host, so the shares stay a whole")
                .isEqualTo(1L);
    }

    // ---------------------------------------------------------------------------------------------

    private void rollUpWholeDay() {
        rollup.rollUpBetween(
                DAY.atStartOfDay(IST).toInstant(),
                DAY.plusDays(2).atStartOfDay(IST).toInstant());
    }

    private Long sessionsOn(LocalDate day) {
        return jdbc.queryForObject(
                "select sessions from page_view_daily where day = ?", Long.class, day);
    }

    private Map<String, Object> pathRow(String path) {
        return jdbc.queryForMap(
                "select * from page_view_daily_paths where day = ? and path = ?", DAY, path);
    }

    private Long referrerSessions(String host) {
        return jdbc.queryForObject(
                "select sessions from page_view_daily_referrers where day = ? and referrer_host = ?",
                Long.class, DAY, host);
    }

    private Instant at(LocalDate day, int hour, int minute) {
        return day.atTime(hour, minute).atZone(IST).toInstant();
    }

    /**
     * Inserts raw rows with SQL rather than through the service, so the fixture can place a view at
     * a chosen instant. The service anchors everything to its own clock by design — which is the
     * right behaviour and makes it useless for building a fixture spanning midnight.
     */
    private void view(String sessionId, UUID userId, String path, String device, Instant at) {
        view(sessionId, userId, path, device, null, at);
    }

    private void view(String sessionId, UUID userId, String path, String device,
            String referrerHost, Instant at) {
        jdbc.update("""
                insert into page_views (session_id, user_id, path, device, referrer_host, occurred_at)
                values (?, ?, ?, ?, ?, ?)
                """, sessionId, userId, path, device, referrerHost, java.sql.Timestamp.from(at));
    }
}
