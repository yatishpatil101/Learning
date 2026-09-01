package com.punenest.api.engagement.pageview;

import com.punenest.api.security.AuthPrincipal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The only writer of {@link PageView}.
 *
 * <p><strong>The client's data-minimisation conventions are enforced here, not trusted.</strong> The
 * browser is supposed to send a route pattern rather than a URL and a host rather than a full
 * referrer. It mostly will. But "the client only ever sends X" is a property of every call site at
 * once, which means it stops being true the first time somebody adds a call site — and the failure
 * is silent, lands in a table that is explicitly justified by not holding free-text personal data,
 * and is only discoverable by reading rows nobody should be reading. So the query string is stripped
 * server-side and the referrer is reduced to a host server-side, and the client's version of those
 * rules is a bandwidth optimisation rather than the control.
 *
 * <p><strong>No dedupe, no session grouping, no throttle</strong> — the same reasoning as
 * {@link com.punenest.api.engagement.demand.DemandSignalService}. Each is a reporting judgement
 * wearing a storage costume, and one made at write time is made permanently: a service that
 * collapses two views of the same page into one row has decided that a re-read is not a read, and no
 * later report can recover what it discarded. Volume is bounded by the batch cap and by
 * {@code WriteRateLimitFilter}.
 */
@Service
public class PageViewService {

    /**
     * How far back a single event in a flush may claim to be.
     *
     * <p>Generous on purpose: a tab left open over lunch and flushed when it is hidden is a real
     * session, and the honest thing to do with it is count it. The ceiling exists so that a broken
     * or hostile client cannot file traffic into an arbitrary past — an event older than this is
     * pinned to the ceiling rather than refused, because refusing would discard a real view to
     * punish a clock.
     */
    private static final Duration MAX_BACKDATE = Duration.ofHours(6);

    private final PageViewRepository repository;

    public PageViewService(PageViewRepository repository) {
        this.repository = repository;
    }

    /**
     * Record one flush.
     *
     * <p>{@code principal} is null for signed-out viewers, which is the common case and the one the
     * Anonymous-surfers report exists to measure.
     *
     * <p>All events in the batch are anchored to a single {@code receivedAt}, so their relative
     * spacing — which is what session duration is computed from — survives exactly as the client
     * observed it, while the absolute position comes from a clock we control.
     */
    @Transactional
    public void record(PageViewBatchCreate body, AuthPrincipal principal) {
        Instant receivedAt = Instant.now();
        Instant floor = receivedAt.minus(MAX_BACKDATE);

        List<PageView> rows = new ArrayList<>(body.events().size());
        for (PageViewBatchCreate.Item item : body.events()) {
            PageView row = new PageView();
            row.setSessionId(body.sessionId());
            row.setUserId(principal == null ? null : principal.userId());
            row.setPath(normalisePath(item.path()));
            row.setReferrerHost(normaliseHost(item.referrerHost()));
            row.setDevice(item.device());

            Instant occurredAt = receivedAt.minusMillis(item.agoMs());
            row.setOccurredAt(occurredAt.isBefore(floor) ? floor : occurredAt);

            rows.add(row);
        }
        repository.saveAll(rows);
    }

    /**
     * Reduce a path to the part that is safe to keep, and never widen it.
     *
     * <p>Everything from the first {@code ?} or {@code #} goes. A query string is where search
     * terms, referral codes and campaign identifiers live, and a fragment is where a client-side
     * router hides the same things; both are free text typed or generated on behalf of a specific
     * person. Trailing slashes are collapsed so {@code /services} and {@code /services/} do not
     * become two rows in a top-pages chart that is supposed to be counting one page.
     */
    private static String normalisePath(String raw) {
        String path = raw.trim();

        int cut = indexOfFirst(path, '?', '#');
        if (cut >= 0) {
            path = path.substring(0, cut);
        }
        while (path.length() > 1 && path.endsWith("/")) {
            path = path.substring(0, path.length() - 1);
        }
        return path.isEmpty() ? "/" : path;
    }

    /**
     * Reduce a referrer to a bare host, whether the client sent one or a whole URL.
     *
     * <p>The scheme, the port, any credentials, the path and the query all go — on a search engine
     * the query <em>is</em> what the viewer typed, which is the single most sensitive thing a
     * referrer can carry. A leading {@code www.} is dropped so one site is one slice of the traffic
     * doughnut rather than two, and the result is lower-cased for the same reason.
     */
    private static String normaliseHost(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String host = raw.trim();

        int scheme = host.indexOf("://");
        if (scheme >= 0) {
            host = host.substring(scheme + 3);
        }
        int credentials = host.lastIndexOf('@');
        if (credentials >= 0) {
            host = host.substring(credentials + 1);
        }
        int end = indexOfFirst(host, '/', '?', '#', ':');
        if (end >= 0) {
            host = host.substring(0, end);
        }
        host = host.toLowerCase(Locale.ROOT);
        if (host.startsWith("www.")) {
            host = host.substring(4);
        }
        return host.isBlank() ? null : host;
    }

    /** Index of whichever of {@code chars} appears first, or -1 when none does. */
    private static int indexOfFirst(String value, char... chars) {
        int found = -1;
        for (char c : chars) {
            int at = value.indexOf(c);
            if (at >= 0 && (found < 0 || at < found)) {
                found = at;
            }
        }
        return found;
    }
}
