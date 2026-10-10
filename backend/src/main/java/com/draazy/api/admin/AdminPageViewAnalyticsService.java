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

/** Reads only the daily rollup, never {@code page_views}: raw views are kept 90 days but the picker offers 180,
 * so a raw read would silently return half a window. Windows are cut on the Indian calendar like the rollup. */
@Service
public class AdminPageViewAnalyticsService {

    /** Caps the typed {@code ?days=}: without it {@code ?days=100000} is a grouped scan of every aggregate row
     * available to any staff account. */
    static final int MAX_DAYS = 400;

    /** What the caller gets when they do not say. Matches the console's default selection. */
    static final int DEFAULT_DAYS = 90;

    /** Row cap for top-pages and drop-off: a site with thousands of distinct routes must not return them all. */
    static final int TOP_PAGES = 10;

    /** Closed channel vocabulary in chart order; raw referring hosts would make a doughnut slice per site. */
    private static final String DIRECT = "Direct";
    private static final String ORGANIC = "Organic search";
    private static final String SOCIAL = "Social";
    private static final String WHATSAPP = "WhatsApp";
    private static final String REFERRAL = "Other referrals";

    private static final List<String> CHANNEL_ORDER =
            List.of(ORGANIC, DIRECT, WHATSAPP, SOCIAL, REFERRAL);

    /** Matched by substring, not equality, as each engine has many country domains; the cost is that a site
     * with "google" in its name counts as organic search. */
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

    /** Dashboard tile: today's sessions and signups plus the window's sessions, no {@link #traffic} breakdowns. */
    @Transactional(readOnly = true)
    public AdminDashboard.Traffic glance(int days) {
        LocalDate today = today();
        LocalDate to = today.plusDays(1);
        long sessionsToday = 0;
        long sessions = 0;
        for (Object[] row : repository.dailyTraffic(to.minusDays(days), to)) {
            long n = num(row[1]);
            sessions += n;
            if (today.equals(day(row[0]))) {
                sessionsToday = n;
            }
        }
        long signupsToday = longsByDay(repository.dailySignups(today, to)).getOrDefault(today, 0L);
        return new AdminDashboard.Traffic(signupsToday, sessionsToday, sessions);
    }

    /** {@code GET /admin/analytics/engagement}. */
    @Transactional(readOnly = true)
    public AdminAnalyticsEngagement engagement(Integer daysRequested) {
        int days = window(daysRequested);
        LocalDate to = today().plusDays(1);
        LocalDate from = to.minusDays(days);

        // Accumulate per week: a bounce rate is a ratio, so weekly is bounces over sessions, not the mean of
        // seven daily rates, which would weight a four-session Tuesday like a four-thousand-session Saturday.
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
            // Share of the exits shown, not of all exits in the window,
            // so the chart's slices add up to what it displays.
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
                pages,
                dropOff);
    }


    /** Today on the Indian calendar (see class Javadoc). The window ends at tomorrow, exclusive, so today is
     * included though still accumulating: the rollup runs hourly. */
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

    /** Folds referring hosts into channels; shares are of total sessions and sum to 100 because every session
     * has exactly one entry host, the empty one meaning direct. */
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

    /** Package-private so tests assert the channel vocabulary directly rather than through a chart. */
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

    /** Real ISO weeks anchored to Monday, not the window divided into eight: equal chunks leave a short last
     * bucket that draws a false downward slope at the right edge. */
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

    /** Pre-creates every week in the window so an unvisited week shows as a gap, not a line the chart draws
     * across; sorted because a {@code HashMap} would reorder the series between requests. */
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

    /** Native queries return {@code Object[]}: a {@code date} is {@link LocalDate} or {@code java.sql.Date}
     * depending on the driver, and assuming one would throw {@link ClassCastException} on every report. */
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
