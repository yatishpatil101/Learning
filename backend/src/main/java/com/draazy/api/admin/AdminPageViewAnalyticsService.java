package com.draazy.api.admin;

import com.draazy.api.common.PlatformTime;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.engagement.pageview.PageViewReportRepository;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The three page-view reports behind the Traffic, Engagement and Anonymous-surfers tabs.
 *
 * <p><strong>Everything here reads the daily rollup and nothing reads {@code page_views}.</strong>
 * Raw views are kept ninety days; the console's range picker offers a hundred and eighty. A report
 * served from raw data would return half a window at its widest setting and would do it silently —
 * the chart rendering, the axis still claiming 180 days, the first three months simply flat. Reading
 * the aggregates also means the retention sweep and an erasure request cannot move a figure that has
 * already been reported.
 *
 * <p><strong>Every window is cut on the Indian calendar</strong>, matching the rollup that wrote the
 * rows. A bare {@code LocalDate.now()} would open the window on the host's date while the aggregates
 * were grouped by India's, so on a UTC host the first and last buckets of every chart would each
 * hold part of a day the window's own edges disagree about — the same hazard {@code
 * AdminMetricsService} names for its own series.
 *
 * <p><strong>Null means unmeasurable and zero means measured zero.</strong> Rates are {@code Double}
 * and are null when their denominator is empty; counts are primitives and are genuinely zero. The
 * console prints an em dash for null. This is not fastidiousness — the seeded SLA generator this
 * replaces defaulted its compliance rates to a flawless {@code 100} whenever it had nothing to
 * measure, so a report with no data read as a perfect week.
 *
 * <p>Its own service rather than four more methods on {@code AdminMetricsService}, whose docblock
 * opens "the three back-office read surfaces" — a claim worth keeping true, and the same reason
 * {@code AdminPricingService} and {@code AdminSupplyGapService} stand alone.
 */
@Service
public class AdminPageViewAnalyticsService {

    /**
     * Ceiling on the window, in days.
     *
     * <p>The picker offers 30, 90 and 180, but {@code ?days=} is an integer a caller types. Without
     * a cap, {@code ?days=100000} is a grouped scan of every aggregate row the platform owns,
     * available to any staff account. A little over a year is past anything the console renders and
     * far short of a scan worth worrying about.
     */
    static final int MAX_DAYS = 400;

    /** What the caller gets when they do not say. Matches the console's default selection. */
    static final int DEFAULT_DAYS = 90;

    /**
     * How many pages the top-pages and drop-off charts return.
     *
     * <p>Ten, against the eight the old chart hard-coded. A horizontal bar chart stops being
     * readable well before this, and the cap is what keeps a site that has served ten thousand
     * distinct routes from returning ten thousand rows.
     */
    static final int TOP_PAGES = 10;

    /**
     * Channels sessions are folded into, in the order the chart shows them.
     *
     * <p>A closed vocabulary, defined once, here. The alternative — returning raw referring hosts —
     * is a doughnut with a slice per site on the internet, which answers nothing and is not a
     * decision anybody makes.
     */
    private static final String DIRECT = "Direct";
    private static final String ORGANIC = "Organic search";
    private static final String SOCIAL = "Social";
    private static final String WHATSAPP = "WhatsApp";
    private static final String REFERRAL = "Other referrals";

    private static final List<String> CHANNEL_ORDER =
            List.of(ORGANIC, DIRECT, WHATSAPP, SOCIAL, REFERRAL);

    /**
     * Hosts that mean a search engine sent the visitor.
     *
     * <p>Matched on a substring of the host and not on equality, because every one of these has
     * dozens of country domains — {@code google.co.in}, {@code google.com}, {@code google.de} — and
     * enumerating them is a list that is wrong the moment a market is added. The cost of substring
     * matching is that a site with "google" in its name is miscounted as organic search; the cost of
     * equality is that most of India's search traffic is filed under "other referrals".
     */
    private static final List<String> SEARCH_HOSTS =
            List.of("google.", "bing.", "duckduckgo.", "yahoo.", "ecosia.", "yandex.", "baidu.");

    private static final List<String> SOCIAL_HOSTS = List.of(
            "facebook.", "fb.", "instagram.", "twitter.", "x.com", "t.co", "linkedin.", "lnkd.in",
            "youtube.", "youtu.be", "reddit.", "pinterest.", "telegram.", "t.me");

    private static final List<String> WHATSAPP_HOSTS = List.of("whatsapp.", "wa.me");

    private final PageViewReportRepository repository;

    public AdminPageViewAnalyticsService(PageViewReportRepository repository) {
        this.repository = repository;
    }

    /** {@code GET /admin/analytics/traffic}. */
    @Transactional(readOnly = true)
    public AdminAnalyticsTraffic traffic(Integer daysRequested) {
        int days = window(daysRequested);
        LocalDate to = today().plusDays(1);
        LocalDate from = to.minusDays(days);

        List<Object[]> rows = repository.dailyTraffic(from, to);
        Map<LocalDate, Long> signups = longsByDay(repository.dailySignups(from, to));

        List<AdminAnalyticsTraffic.Day> series = new ArrayList<>();
        Map<LocalDate, Long> sessionsByDay = new HashMap<>();
        Map<LocalDate, Long> pageviewsByDay = new HashMap<>();
        long mobile = 0;
        long tablet = 0;
        long desktop = 0;
        for (Object[] row : rows) {
            LocalDate day = day(row[0]);
            sessionsByDay.put(day, num(row[1]));
            pageviewsByDay.put(day, num(row[4]));
            mobile += num(row[7]);
            tablet += num(row[8]);
            desktop += num(row[9]);
        }
        // Zero-fill: see AdminAnalyticsTraffic.Day for why a gap is worse than a zero here.
        for (LocalDate day = from; day.isBefore(to); day = day.plusDays(1)) {
            series.add(new AdminAnalyticsTraffic.Day(
                    day,
                    sessionsByDay.getOrDefault(day, 0L),
                    pageviewsByDay.getOrDefault(day, 0L),
                    signups.getOrDefault(day, 0L)));
        }

        return new AdminAnalyticsTraffic(
                days,
                from,
                to,
                series,
                sources(from, to),
                new AdminAnalyticsTraffic.Devices(mobile, tablet, desktop),
                identityWeeks(rows, from, to));
    }

    /** {@code GET /admin/analytics/engagement}. */
    @Transactional(readOnly = true)
    public AdminAnalyticsEngagement engagement(Integer daysRequested) {
        int days = window(daysRequested);
        LocalDate to = today().plusDays(1);
        LocalDate from = to.minusDays(days);

        // Accumulate per week rather than per day: a bounce rate is a ratio, so the weekly figure is
        // the week's bounces over the week's sessions -- never the mean of seven daily rates, which
        // would weight a Tuesday with four sessions the same as a Saturday with four thousand.
        Map<LocalDate, long[]> weekly = emptyWeeks(from, to, 3);
        for (Object[] row : repository.dailyTraffic(from, to)) {
            long[] acc = weekly.get(weekOf(day(row[0])));
            acc[0] += num(row[1]);
            acc[1] += num(row[5]);
            acc[2] += num(row[6]);
        }

        List<AdminAnalyticsEngagement.Week> weeks = new ArrayList<>();
        weekly.forEach((week, acc) -> {
            long sessions = acc[0];
            weeks.add(new AdminAnalyticsEngagement.Week(
                    week,
                    sessions,
                    sessions == 0 ? null : round1(acc[2] / 60.0 / sessions),
                    sessions == 0 ? null : percent(acc[1], sessions)));
        });

        List<AdminAnalyticsEngagement.Page> topPages = new ArrayList<>();
        for (Object[] row : repository.topPaths(from, to, TOP_PAGES)) {
            topPages.add(new AdminAnalyticsEngagement.Page(
                    (String) row[0], num(row[1]), num(row[2])));
        }

        return new AdminAnalyticsEngagement(days, from, to, weeks, topPages);
    }

    /** {@code GET /admin/analytics/surfers}. */
    @Transactional(readOnly = true)
    public AdminAnalyticsSurfers surfers(Integer daysRequested) {
        int days = window(daysRequested);
        LocalDate to = today().plusDays(1);
        LocalDate from = to.minusDays(days);

        List<Object[]> rows = repository.dailyTraffic(from, to);
        long sessions = 0;
        long anon = 0;
        long signedIn = 0;
        for (Object[] row : rows) {
            sessions += num(row[1]);
            anon += num(row[2]);
            signedIn += num(row[3]);
        }

        long signups = repository.dailySignups(from, to).stream()
                .mapToLong(row -> num(row[1]))
                .sum();

        List<AdminAnalyticsSurfers.Page> pages = new ArrayList<>();
        for (Object[] row : repository.topPaths(from, to, TOP_PAGES)) {
            pages.add(new AdminAnalyticsSurfers.Page((String) row[0], num(row[1]), num(row[2])));
        }

        List<Object[]> exitRows = repository.topExitPaths(from, to, TOP_PAGES);
        long totalExits = exitRows.stream().mapToLong(row -> num(row[1])).sum();
        List<AdminAnalyticsSurfers.Exit> dropOff = new ArrayList<>();
        for (Object[] row : exitRows) {
            long exits = num(row[1]);
            // Share of the exits shown, not of every exit in the window -- so the chart's slices add
            // up to what the chart displays. A share of an unshown total would leave the reader
            // subtracting to find a remainder that is not there.
            dropOff.add(new AdminAnalyticsSurfers.Exit(
                    (String) row[0], exits, totalExits == 0 ? 0 : percent(exits, totalExits)));
        }

        return new AdminAnalyticsSurfers(
                days,
                from,
                to,
                sessions,
                anon,
                signedIn,
                signups,
                sessions == 0 ? null : percent(anon, sessions),
                sessions == 0 ? null : percent(signups, sessions),
                identityWeeks(rows, from, to),
                pages,
                dropOff);
    }

    // -----------------------------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------------------------

    /**
     * Today on the Indian calendar. See the class Javadoc for why not {@code LocalDate.now()}.
     *
     * <p>The window runs to <em>tomorrow</em>, exclusive, so today is included and is understood to
     * be still accumulating — the rollup runs hourly, so today's figure is correct as of the last
     * tick rather than as of this request.
     */
    private static LocalDate today() {
        return LocalDate.now(PlatformTime.IST);
    }

    private static int window(Integer requested) {
        if (requested == null) {
            return DEFAULT_DAYS;
        }
        if (requested < 1 || requested > MAX_DAYS) {
            throw new BadRequestException(
                    "days must be between 1 and " + MAX_DAYS + ", was " + requested);
        }
        return requested;
    }

    /**
     * Fold referring hosts into the channel vocabulary and rank them.
     *
     * <p>Shares are of the window's total sessions, so they sum to 100 across the returned list —
     * every session has exactly one entry host, including the empty one that means direct.
     */
    private List<AdminAnalyticsTraffic.Source> sources(LocalDate from, LocalDate to) {
        Map<String, Long> byChannel = new LinkedHashMap<>();
        CHANNEL_ORDER.forEach(channel -> byChannel.put(channel, 0L));
        long total = 0;
        for (Object[] row : repository.referrerSessions(from, to)) {
            long sessions = num(row[1]);
            total += sessions;
            byChannel.merge(channelOf((String) row[0]), sessions, Long::sum);
        }

        long windowTotal = total;
        List<AdminAnalyticsTraffic.Source> sources = new ArrayList<>();
        byChannel.forEach((channel, sessions) -> sources.add(new AdminAnalyticsTraffic.Source(
                channel, sessions, windowTotal == 0 ? 0 : percent(sessions, windowTotal))));
        sources.sort((a, b) -> Long.compare(b.sessions(), a.sessions()));
        return sources;
    }

    /**
     * Which channel a referring host belongs to.
     *
     * <p>Package-private so its vocabulary is asserted directly rather than inferred from a chart.
     */
    static String channelOf(String host) {
        if (host == null || host.isBlank()) {
            return DIRECT;
        }
        String lower = host.toLowerCase(Locale.ROOT);
        if (WHATSAPP_HOSTS.stream().anyMatch(lower::contains)) {
            return WHATSAPP;
        }
        if (SEARCH_HOSTS.stream().anyMatch(lower::contains)) {
            return ORGANIC;
        }
        if (SOCIAL_HOSTS.stream().anyMatch(lower::contains)) {
            return SOCIAL;
        }
        return REFERRAL;
    }

    /**
     * Roll day rows up into weeks of signed-in against anonymous sessions.
     *
     * <p>Weeks are real ISO weeks anchored to Monday, not the window divided into eight. The old tab
     * chopped whatever range it had into exactly eight chunks with {@code ceil(days / 8)}, so at
     * thirty days the eight buckets spanned thirty-two and the last one was always short — a
     * downward slope at the right-hand edge of every chart that was an artefact of the arithmetic.
     * Real weeks mean the first and last are partial in an obvious way instead.
     */
    private static List<AdminAnalyticsTraffic.IdentityWeek> identityWeeks(
            List<Object[]> rows, LocalDate from, LocalDate to) {
        Map<LocalDate, long[]> weekly = emptyWeeks(from, to, 2);
        for (Object[] row : rows) {
            long[] acc = weekly.get(weekOf(day(row[0])));
            acc[0] += num(row[2]);
            acc[1] += num(row[3]);
        }
        List<AdminAnalyticsTraffic.IdentityWeek> weeks = new ArrayList<>();
        weekly.forEach((week, acc) ->
                weeks.add(new AdminAnalyticsTraffic.IdentityWeek(week, acc[0], acc[1])));
        return weeks;
    }

    /**
     * Every week the window touches, pre-created and empty, so a week nobody visited is reported
     * rather than omitted.
     *
     * <p>The same reasoning as the daily zero-fill, one grain up: a sparse weekly series lets a
     * chart draw a straight segment across the weeks it is missing, inventing a trend exactly where
     * there is no data. A present week with zero sessions reports null rates instead, which the
     * console renders as a gap in the line and an em dash in the table — visibly absent rather than
     * invisibly skipped.
     *
     * <p>Sorted, because the console plots these in array order and a {@code HashMap} would hand it
     * a chronology that changed between requests.
     */
    private static Map<LocalDate, long[]> emptyWeeks(LocalDate from, LocalDate to, int slots) {
        Map<LocalDate, long[]> weeks = new TreeMap<>();
        for (LocalDate week = weekOf(from); week.isBefore(to); week = week.plusWeeks(1)) {
            weeks.put(week, new long[slots]);
        }
        return weeks;
    }

    private static LocalDate weekOf(LocalDate day) {
        return day.with(DayOfWeek.MONDAY);
    }

    private static Map<LocalDate, Long> longsByDay(List<Object[]> rows) {
        Map<LocalDate, Long> byDay = new HashMap<>();
        rows.forEach(row -> byDay.put(day(row[0]), num(row[1])));
        return byDay;
    }

    /**
     * A {@code date} column as a {@link LocalDate}, whichever of the two shapes the driver chose.
     *
     * <p>A native query returns {@code Object[]}, so what a {@code date} column arrives as is a
     * driver decision rather than a compiler-checked one. The modern pgjdbc path returns {@link
     * LocalDate} directly; the legacy JDBC mapping returns {@code java.sql.Date}, which is a {@code
     * java.util.Date} and so cannot be cast to the former at all.
     *
     * <p>Accepting both is not defensive padding — it is the only honest reading of a value whose
     * type is not fixed by the signature. Assuming either one produces a {@link ClassCastException}
     * at the top of every report the moment the driver, its version, or a Hibernate dialect setting
     * changes underneath, and the failure is total rather than partial.
     */
    private static LocalDate day(Object value) {
        if (value instanceof LocalDate date) {
            return date;
        }
        if (value instanceof java.sql.Date date) {
            return date.toLocalDate();
        }
        throw new IllegalStateException(
                "unexpected date type from the analytics query: " + value.getClass().getName());
    }

    private static long num(Object value) {
        return value == null ? 0L : ((Number) value).longValue();
    }

    /** A percentage 0–100 to one decimal place. Callers guarantee a non-zero denominator. */
    private static double percent(long part, long whole) {
        return round1(part * 100.0 / whole);
    }

    private static double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
    }
}
