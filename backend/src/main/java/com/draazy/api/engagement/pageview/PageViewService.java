package com.draazy.api.engagement.pageview;

import com.draazy.api.security.AuthPrincipal;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Enforces data minimisation server-side (query string stripped, referrer reduced to host), not by trust.
 * No dedupe or throttle: a write-time reporting judgement can't be undone later. */
@Service
public class PageViewService {

    /** Older events are pinned to this ceiling, not refused: an idle tab is a real view, but can't backfill. */
    private static final Duration MAX_BACKDATE = Duration.ofHours(6);

    private final PageViewRepository repository;

    public PageViewService(PageViewRepository repository) {
        this.repository = repository;
    }

    /** Shared {@code receivedAt} keeps relative spacing (duration) as observed; absolute time is our clock's. */
    @Transactional
    public void record(PageViewBatchCreate body, AuthPrincipal principal) {
        Instant receivedAt = Instant.now();
        Instant floor = receivedAt.minus(MAX_BACKDATE);

        List<PageView> rows = new ArrayList<>(body.events().size());
        for (PageViewBatchCreate.Item item : body.events()) {
            PageView row = new PageView();
            row.setSessionId(body.sessionId());
            row.setSignedIn(principal != null);
            row.setUserId(principal != null && Boolean.TRUE.equals(body.attributed()) ? principal.userId() : null);
            row.setPath(normalisePath(item.path()));
            row.setReferrerHost(normaliseHost(item.referrerHost()));
            row.setDevice(item.device());

            Instant occurredAt = receivedAt.minusMillis(item.agoMs());
            row.setOccurredAt(occurredAt.isBefore(floor) ? floor : occurredAt);

            rows.add(row);
        }
        repository.saveAll(rows);
    }

    /** Strips from the first {@code ?} or {@code #} (search terms, campaign ids) and trailing slashes. */
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

    /** Reduces to a lower-case host without {@code www.}; a search referrer's query is what the viewer typed. */
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
