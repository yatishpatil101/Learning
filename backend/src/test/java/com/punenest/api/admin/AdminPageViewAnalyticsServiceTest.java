package com.punenest.api.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.punenest.api.common.PlatformTime;
import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.engagement.pageview.PageViewRollup;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import com.punenest.api.support.AbstractApiTest;

/**
 * The three analytics reads, proved end to end from raw page views through the rollup to the
 * response the console renders.
 *
 * <p><strong>Why the whole chain and not the service alone.</strong> Every figure here is a
 * measurement an operator will act on, and almost all of it is arithmetic split across a SQL
 * aggregate and a Java fold — a rate computed from the wrong denominator, or a window cut in the
 * wrong zone, produces a number that is entirely plausible and simply wrong. Mocking the repository
 * would prove the fold and leave the half that the compiler cannot check untested.
 *
 * <p>The tab this replaces had no tests because it had no data: every number on it came from a
 * seeded pseudo-random generator, so there was nothing to be right or wrong about.
 *
 * <p>Inherits {@code @Transactional} from {@link AbstractApiTest}, so every row rolls back and
 * {@code punenest_test} keeps holding schema and nothing else.
 */
@DisplayName("Admin page-view analytics")
class AdminPageViewAnalyticsServiceTest extends AbstractApiTest {

    /**
     * Yesterday, not today: a fixture placed at "today 10:00" is in the future for most of the day,
     * and a view in the future is not a case the collector can produce.
     */
    private static final LocalDate DAY = LocalDate.now(PlatformTime.IST).minusDays(1);

    @Autowired AdminPageViewAnalyticsService service;
    @Autowired PageViewRollup rollup;

    @Test
    @DisplayName("traffic fills every day in the window, so a quiet day is a zero and not a gap")
    void zeroFillsTheSeries() {
        view("s1", null, "/", "mobile", null, at(10, 0));
        rollUp();

        AdminAnalyticsTraffic report = service.traffic(7);

        assertThat(report.series())
                .as("seven days requested, seven days returned, whatever the rollup wrote")
                .hasSize(7);
        assertThat(report.series().get(report.series().size() - 1).date())
                .as("the window runs to the end of today, which is still accumulating")
                .isEqualTo(LocalDate.now(PlatformTime.IST));
        assertThat(report.series())
                .filteredOn(day -> day.date().equals(DAY))
                .singleElement()
                .satisfies(day -> assertThat(day.sessions()).isEqualTo(1L));
        assertThat(report.series())
                .as("every other day genuinely saw nothing, and says so")
                .filteredOn(day -> !day.date().equals(DAY))
                .allSatisfy(day -> assertThat(day.sessions()).isZero());
    }

    @Test
    @DisplayName("folds referring hosts into channels whose shares sum to 100")
    void foldsReferrersIntoChannels() {
        view("s-search", null, "/", "mobile", "google.co.in", at(9, 0));
        view("s-social", null, "/", "mobile", "facebook.com", at(9, 10));
        view("s-whats", null, "/", "mobile", "wa.me", at(9, 20));
        view("s-direct", null, "/", "mobile", null, at(9, 30));
        view("s-other", null, "/", "mobile", "someblog.in", at(9, 40));
        rollUp();

        List<AdminAnalyticsTraffic.Source> sources = service.traffic(7).sources();

        assertThat(sources).extracting(AdminAnalyticsTraffic.Source::channel)
                .as("a closed vocabulary, not one slice per site on the internet")
                .containsExactlyInAnyOrder(
                        "Organic search", "Direct", "WhatsApp", "Social", "Other referrals");
        assertThat(sources).allSatisfy(source ->
                assertThat(source.sessions())
                        .as("one session each, so every channel is populated")
                        .isEqualTo(1L));
        assertThat(sources).extracting(AdminAnalyticsTraffic.Source::sharePct)
                .as("every session has exactly one entry host, so the shares are a whole")
                .allMatch(share -> share == 20.0);
    }

    @Test
    @DisplayName("counts devices once per session, on the device the session arrived with")
    void countsDevicesPerSessionNotPerView() {
        // One visitor who rotated a tablet: three views, two device strings, one session.
        view("s-rotate", null, "/", "tablet", null, at(10, 0));
        view("s-rotate", null, "/listings", "desktop", null, at(10, 1));
        view("s-rotate", null, "/property/:id", "desktop", null, at(10, 2));
        view("s-phone", null, "/", "mobile", null, at(11, 0));
        rollUp();

        AdminAnalyticsTraffic.Devices devices = service.traffic(7).devices();

        assertThat(devices.tablet())
                .as("the rotating visitor arrived on a tablet and stays one tablet session")
                .isEqualTo(1L);
        assertThat(devices.desktop())
                .as("picking the most common view instead would have moved them to desktop")
                .isZero();
        assertThat(devices.mobile()).isEqualTo(1L);
    }

    @Test
    @DisplayName("bounce rate is the week's bounces over the week's sessions, not a mean of days")
    void weighsBounceRateBySessionsNotByDay() {
        // A day with one session that bounced, and a day with four of which one bounced.
        // Mean-of-daily-rates would say (100 + 25) / 2 = 62.5%. The real rate is 2 in 5 = 40%.
        LocalDate quiet = mondayOf(DAY);
        LocalDate busy = quiet.plusDays(1);
        view("q1", null, "/", "mobile", null, at(quiet, 10, 0));

        view("b1", null, "/", "mobile", null, at(busy, 10, 0));
        view("b2", null, "/", "mobile", null, at(busy, 11, 0));
        view("b2", null, "/listings", "mobile", null, at(busy, 11, 2));
        view("b3", null, "/", "mobile", null, at(busy, 12, 0));
        view("b3", null, "/listings", "mobile", null, at(busy, 12, 1));
        view("b4", null, "/", "mobile", null, at(busy, 13, 0));
        view("b4", null, "/listings", "mobile", null, at(busy, 13, 4));
        rollUp();

        AdminAnalyticsEngagement.Week week = weekStarting(service.engagement(28), quiet);

        assertThat(week.sessions()).isEqualTo(5L);
        assertThat(week.bounceRatePct())
                .as("two of five sessions saw one page; averaging the two days would say 62.5")
                .isEqualTo(40.0);
    }

    @Test
    @DisplayName("reports session length in decimal minutes")
    void reportsSessionLengthInMinutes() {
        LocalDate monday = mondayOf(DAY);
        // 3 minutes exactly, and a bounce of zero: mean 1.5 minutes over two sessions.
        view("s-long", null, "/", "mobile", null, at(monday, 10, 0));
        view("s-long", null, "/listings", "mobile", null, at(monday, 10, 3));
        view("s-short", null, "/", "mobile", null, at(monday, 11, 0));
        rollUp();

        assertThat(weekStarting(service.engagement(28), monday).avgSessionMinutes())
                .as("minutes, not seconds -- the console prints this beside the word 'minutes'")
                .isEqualTo(1.5);
    }

    @Test
    @DisplayName("rates are null when there is nothing to measure, never a confident zero")
    void leavesRatesNullWhenThereIsNoTraffic() {
        // Deliberately no fixture. An empty window is the state a brand-new deployment is in, and
        // the state a broken rollup job looks like.
        AdminAnalyticsSurfers surfers = service.surfers(7);

        assertThat(surfers.totalSessions()).isZero();
        assertThat(surfers.anonSharePct())
                .as("0% anonymous would tell an operator every visitor signed in")
                .isNull();
        assertThat(surfers.conversionRatePct())
                .as("0% conversion would report a failure that did not happen")
                .isNull();
        assertThat(service.engagement(7).weeks())
                .as("weeks still span the window so the axis is complete")
                .isNotEmpty()
                .allSatisfy(week -> {
                    assertThat(week.bounceRatePct()).isNull();
                    assertThat(week.avgSessionMinutes()).isNull();
                });
    }

    @Test
    @DisplayName("splits sessions by identity and counts signups on the same calendar")
    void measuresTheAnonymousShare() {
        view("s-anon-a", null, "/", "mobile", null, at(10, 0));
        view("s-anon-b", null, "/", "mobile", null, at(10, 5));
        view("s-anon-c", null, "/", "mobile", null, at(10, 9));
        view("s-user", UUID.randomUUID(), "/dashboard", "desktop", null, at(11, 0));
        signup(at(12, 0));
        rollUp();

        AdminAnalyticsSurfers surfers = service.surfers(7);

        assertThat(surfers.totalSessions()).isEqualTo(4L);
        assertThat(surfers.anonSessions()).isEqualTo(3L);
        assertThat(surfers.signedInSessions()).isEqualTo(1L);
        assertThat(surfers.anonSharePct()).isEqualTo(75.0);
        assertThat(surfers.signups())
                .as("the signup landed inside the window and on the IST day the views did")
                .isGreaterThanOrEqualTo(1L);
        assertThat(surfers.weeks())
                .as("the anonymous share is counted, not derived from the conversion rate")
                .filteredOn(week -> week.anonymous() + week.signedIn() > 0)
                .singleElement()
                .satisfies(week -> {
                    assertThat(week.anonymous()).isEqualTo(3L);
                    assertThat(week.signedIn()).isEqualTo(1L);
                });
    }

    @Test
    @DisplayName("ranks exits separately from views, so a page few people reach still surfaces")
    void ranksExitsOnTheirOwn() {
        // /listings is viewed most and exited from least; /pricing is viewed once and always exited.
        view("s1", null, "/listings", "mobile", null, at(9, 0));
        view("s1", null, "/property/:id", "mobile", null, at(9, 1));
        view("s2", null, "/listings", "mobile", null, at(9, 10));
        view("s2", null, "/property/:id", "mobile", null, at(9, 11));
        view("s3", null, "/listings", "mobile", null, at(9, 20));
        view("s3", null, "/pricing", "mobile", null, at(9, 21));
        rollUp();

        AdminAnalyticsSurfers surfers = service.surfers(7);

        assertThat(surfers.pages()).first()
                .as("/listings is the most viewed page")
                .satisfies(page -> assertThat(page.path()).isEqualTo("/listings"));
        assertThat(surfers.dropOff())
                .as("/listings was never left from, so it is absent from the drop-off entirely")
                .extracting(AdminAnalyticsSurfers.Exit::path)
                .containsExactlyInAnyOrder("/property/:id", "/pricing");
        assertThat(surfers.dropOff())
                .as("shares are of the exits shown, so the chart's slices are a whole")
                .extracting(AdminAnalyticsSurfers.Exit::sharePct)
                .containsExactlyInAnyOrder(66.7, 33.3);
    }

    @Test
    @DisplayName("counts anonymous views alongside total views, replacing the fabricated rate")
    void reportsAnonymousViewsPerPage() {
        view("s-anon", null, "/listings", "mobile", null, at(9, 0));
        view("s-user", UUID.randomUUID(), "/listings", "desktop", null, at(9, 30));
        rollUp();

        assertThat(service.surfers(7).pages()).singleElement().satisfies(page -> {
            assertThat(page.views()).isEqualTo(2L);
            assertThat(page.anonViews())
                    .as("a subset of views, both on one axis -- not a percentage plotted 100x large")
                    .isEqualTo(1L);
        });
    }

    @Test
    @DisplayName("rejects a window outside the range the console can ask for")
    void rejectsAnUnboundedWindow() {
        assertThatThrownBy(() -> service.traffic(0)).isInstanceOf(BadRequestException.class);
        assertThatThrownBy(() -> service.traffic(-1)).isInstanceOf(BadRequestException.class);
        assertThatThrownBy(() -> service.traffic(AdminPageViewAnalyticsService.MAX_DAYS + 1))
                .as("?days= is an integer a caller types, not a value the picker offers")
                .isInstanceOf(BadRequestException.class);

        assertThat(service.traffic(null).days())
                .as("no window asked for falls back to the console's own default")
                .isEqualTo(AdminPageViewAnalyticsService.DEFAULT_DAYS);
        assertThat(service.traffic(AdminPageViewAnalyticsService.MAX_DAYS).days())
                .isEqualTo(AdminPageViewAnalyticsService.MAX_DAYS);
    }

    @Test
    @DisplayName("classifies referring hosts by substring, so country domains are not lost")
    void classifiesCountryDomains() {
        assertThat(AdminPageViewAnalyticsService.channelOf("google.co.in")).isEqualTo("Organic search");
        assertThat(AdminPageViewAnalyticsService.channelOf("www.google.de")).isEqualTo("Organic search");
        assertThat(AdminPageViewAnalyticsService.channelOf("m.facebook.com")).isEqualTo("Social");
        assertThat(AdminPageViewAnalyticsService.channelOf("WA.ME")).isEqualTo("WhatsApp");
        assertThat(AdminPageViewAnalyticsService.channelOf(null)).isEqualTo("Direct");
        assertThat(AdminPageViewAnalyticsService.channelOf("")).isEqualTo("Direct");
        assertThat(AdminPageViewAnalyticsService.channelOf("someblog.in")).isEqualTo("Other referrals");
    }

    // ---------------------------------------------------------------------------------------------

    /** Rolls up a window wide enough to cover every fixture below, which all sit in the last week. */
    private void rollUp() {
        LocalDate today = LocalDate.now(PlatformTime.IST);
        rollup.rollUpBetween(
                today.minusDays(30).atStartOfDay(PlatformTime.IST).toInstant(),
                today.plusDays(1).atStartOfDay(PlatformTime.IST).toInstant());
    }

    private static LocalDate mondayOf(LocalDate day) {
        // A fixed weekday inside the window, so a test spanning two days cannot straddle a week
        // boundary and split its own fixture across two buckets depending on when it is run.
        return day.with(DayOfWeek.MONDAY);
    }

    private static AdminAnalyticsEngagement.Week weekStarting(
            AdminAnalyticsEngagement report, LocalDate week) {
        return report.weeks().stream()
                .filter(candidate -> candidate.week().equals(week))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no week starting " + week));
    }

    private static Instant at(int hour, int minute) {
        return at(DAY, hour, minute);
    }

    private static Instant at(LocalDate day, int hour, int minute) {
        return day.atTime(hour, minute).atZone(PlatformTime.IST).toInstant();
    }

    /**
     * Inserts a raw view with SQL rather than through the collector, which anchors every event to
     * its own clock by design — correct behaviour, and useless for placing a view on a chosen day.
     */
    private void view(String sessionId, UUID userId, String path, String device,
            String referrerHost, Instant at) {
        jdbc.update("""
                insert into page_views (session_id, user_id, path, referrer_host, device, occurred_at)
                values (?, ?, ?, ?, ?, ?)
                """, sessionId, userId, path, referrerHost, device, java.sql.Timestamp.from(at));
    }

    /** A bare account row: the conversion rate counts users, and only {@code mobile} is required. */
    private void signup(Instant at) {
        jdbc.update("insert into users (mobile, created_at) values (?, ?)",
                "9" + String.format("%09d", Math.abs(UUID.randomUUID().hashCode()) % 1_000_000_000),
                java.sql.Timestamp.from(at));
    }
}
