package com.punenest.api.engagement.history;

import com.punenest.api.common.error.ValidationException;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The signed-in "resume your search" rail (V121).
 *
 * <p>Every method is keyed by the server-resolved principal id. There is no user identifier in any
 * request body or path, so there is no parameter a caller could change to read or write somebody
 * else's history — the isolation is structural rather than checked.
 *
 * <p>Anonymous visitors are not served here at all: they keep the device-local list in
 * {@code lib/localPrefs.js}, which is the right home for a trail nobody signed in to create.
 */
@Service
public class RecentSearchService {

    /**
     * How many entries a user keeps. Six is the rail's own width, and the cap is enforced on write
     * rather than on read so the stored trail never grows past what the feature can show — a
     * retention rule that lives in the schema's behaviour instead of in a policy document.
     */
    static final int MAX_ENTRIES = 6;

    /**
     * The paths a recent search may point at.
     *
     * <p>An allowlist, not a "starts with /" check, and the difference is the whole guard. The stored
     * URL is handed straight back to the browser as a link the user is invited to click, so anything
     * that can be written here is something the account's own UI will offer them later. A permissive
     * rule turns this table into a stored-redirect primitive: write once, and every subsequent visit
     * to Home shows a friendly chip pointing wherever the writer chose.
     *
     * <p>These are the only two search-result routes the app has ({@code App.jsx}); adding a third
     * search page means adding it here, deliberately, which is the intended amount of friction.
     */
    private static final Set<String> ALLOWED_PATHS = Set.of("/listings", "/flatmates");

    /**
     * RFC 3986 path and query characters, and nothing else — no space, backslash, angle bracket,
     * quote, control character or raw non-ASCII. Anything outside this set either is not a URL or is
     * a URL trying to be read as something else; a legitimate client percent-encodes it, which
     * {@code URLSearchParams.toString()} already does.
     */
    private static final Pattern SAFE_CHARS = Pattern.compile("^[A-Za-z0-9\\-._~%!$&'()*+,;=:@/?]*$");

    private final RecentSearchRepository searches;

    public RecentSearchService(RecentSearchRepository searches) {
        this.searches = searches;
    }

    /** The caller's own recent searches, newest first, at most {@link #MAX_ENTRIES}. */
    @Transactional(readOnly = true)
    public List<RecentSearchDto> list(UUID userId) {
        return searches.findByUserIdOrderBySearchedAtDesc(userId, Limit.of(MAX_ENTRIES))
                .stream()
                .map(RecentSearchService::toDto)
                .toList();
    }

    /**
     * Record a search, or move an existing one back to the top.
     *
     * <p>Idempotent by normalised URL: running the same search twice leaves one row with a refreshed
     * timestamp, which is what makes this a {@code PUT}. The label is refreshed on a touch because
     * copy and locale change and the newer rendering is the truer one; it is never the key, because
     * two different searches can render the same chip and the old client lost one of them whenever
     * they did.
     *
     * <p>The read-then-insert is deliberately not guarded against a concurrent identical write. Two
     * simultaneous PUTs for the same URL — a double-tapped Search button — race to the unique index
     * and one of them loses with a 500. Nothing is lost by that: the row exists, the rail is right on
     * the next read, and the client already logs the failure without blocking navigation. Catching it
     * would mean a second transaction, since a constraint violation dooms this one, and that is more
     * machinery than a swallowed log line is worth.
     *
     * @return the caller's full rail after the write, so a client never has to guess at the eviction
     */
    @Transactional
    public List<RecentSearchDto> record(UUID userId, String label, String rawUrl) {
        String url = normalizeUrl(rawUrl);
        String chip = label.trim();
        Instant now = Instant.now();

        searches.findByUserIdAndUrl(userId, url).ifPresentOrElse(
                existing -> {
                    existing.touch(chip, now);
                    searches.saveAndFlush(existing);
                },
                () -> {
                    searches.saveAndFlush(new RecentSearch(userId, chip, url, now));
                    evictBeyondCap(userId);
                });

        return list(userId);
    }

    /**
     * Drop everything past the newest {@link #MAX_ENTRIES}. Only runs after an insert — a touch
     * cannot change the row count, so it cannot push anything over the cap.
     *
     * <p>Reads the whole trail rather than the cap plus one because a cap lowered in a later release
     * would otherwise leave the surplus stranded forever, evicted one row per search.
     */
    private void evictBeyondCap(UUID userId) {
        List<RecentSearch> all = searches.findByUserIdOrderBySearchedAtDesc(userId);
        if (all.size() > MAX_ENTRIES) {
            searches.deleteAll(all.subList(MAX_ENTRIES, all.size()));
        }
    }

    /**
     * Reduce a search URL to the canonical form two identical searches share.
     *
     * <p>Query parameters are sorted, because {@code ?deal=rent&loc=baner} and
     * {@code ?loc=baner&deal=rent} are the same search and the user should not end up with two chips
     * for it. Everything else here is a rejection: the value must be a relative URL on one of our own
     * search pages, so an absolute, protocol-relative, backslash-smuggled or off-site URL never
     * reaches the column.
     *
     * @throws ValidationException 422, naming what was wrong, so the client can log something useful
     */
    private static String normalizeUrl(String rawUrl) {
        String url = rawUrl.trim();
        if (!SAFE_CHARS.matcher(url).matches()) {
            throw new ValidationException("url contains characters that are not allowed in a search URL");
        }
        // A leading '//' is protocol-relative — '//evil.test/x' is off-site despite starting with a
        // slash, and it is the single most common way a "must be relative" check is walked past.
        if (!url.startsWith("/") || url.startsWith("//")) {
            throw new ValidationException("url must be a relative search URL");
        }
        int q = url.indexOf('?');
        // Locale.ROOT, not the platform default: under a Turkish locale `toLowerCase()` maps 'I' to
        // a dotless 'ı', so `/LISTINGS` would normalise to something the allowlist has never heard
        // of and every save on that host would fail. A case rule about ASCII route names has no
        // business consulting the server's locale.
        String path = (q < 0 ? url : url.substring(0, q)).toLowerCase(Locale.ROOT);
        String query = q < 0 ? "" : url.substring(q + 1);
        if (!ALLOWED_PATHS.contains(path)) {
            throw new ValidationException("url must point at a search page");
        }
        if (query.isEmpty()) {
            return path;
        }
        String canonicalQuery = Arrays.stream(query.split("&"))
                .filter(part -> !part.isEmpty())
                .sorted()
                .collect(Collectors.joining("&"));
        String out = canonicalQuery.isEmpty() ? path : path + "?" + canonicalQuery;
        // Unreachable from the controller, where @Size(max = 500) on the request already bounds this
        // and normalisation can only shorten. It is the column's guard, not the request's: this
        // method is the only thing standing between any future caller and a varchar(500).
        if (out.length() > 500) {
            throw new ValidationException("url is too long");
        }
        return out;
    }

    private static RecentSearchDto toDto(RecentSearch s) {
        return new RecentSearchDto(s.getLabel(), s.getUrl(), s.getSearchedAt());
    }
}
