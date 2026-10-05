package com.draazy.api.common.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.util.DigestUtils;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;

/**
 * Answers the public reference reads every page render makes from memory, and tells browsers and the
 * Cloudflare edge they may reuse them. Rationale and staleness budget: cross-cutting.md §9.
 */
@Component
// After Spring Security, so a hit still passes the origin gate, CORS and the security headers.
@Order(Ordered.LOWEST_PRECEDENCE)
public class PublicReadCacheFilter extends OncePerRequestFilter {

    // Each must answer every caller identically: one that varied by caller would leak across users.
    static final Set<String> PATHS = Set.of(
            Routes.Flags.BASE, Routes.Geo.BASE, Routes.Pricing.BASE, Routes.ListingPolicy.BASE,
            Routes.MovePack.BASE, Routes.Plans.BASE, Routes.Fees.BASE, Routes.Cities.BASE,
            Routes.Localities.BASE, Routes.Properties.FEATURED, Routes.Properties.TRUST_STATS,
            Routes.Properties.COUNTS);

    /** Bounds memory against arbitrary query strings, e.g. {@code trust-stats?locality=<random>}. */
    static final int MAX_ENTRIES = 256;

    private final long ttlMillis;

    private final Map<String, Entry> entries = Collections.synchronizedMap(
            new LinkedHashMap<>(16, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(
                        Map.Entry<String, PublicReadCacheFilter.Entry> eldest) {
                    return size() > MAX_ENTRIES;
                }
            });

    public PublicReadCacheFilter(@Value("${draazy.cache.public-reads.ttl:30s}") Duration ttl) {
        this.ttlMillis = ttl.toMillis();
    }

    /** Whether this request is served through the cache; false for everything when the TTL is zero. */
    public boolean caches(HttpServletRequest request) {
        return ttlMillis > 0 && "GET".equals(request.getMethod())
                && PATHS.contains(request.getRequestURI().substring(request.getContextPath().length()));
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !caches(request);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        String key = request.getRequestURI() + '?' + Objects.toString(request.getQueryString(), "");
        long now = System.currentTimeMillis();
        Entry entry = wantsFresh(request) ? null : entries.get(key);
        if (entry == null || entry.expiresAt() <= now) {
            ContentCachingResponseWrapper buffer = new ContentCachingResponseWrapper(response);
            chain.doFilter(request, buffer);
            if (buffer.getStatus() != HttpServletResponse.SC_OK) {
                buffer.copyBodyToResponse();
                return;
            }
            byte[] body = buffer.getContentAsByteArray();
            entry = new Entry(body, buffer.getContentType(),
                    '"' + DigestUtils.md5DigestAsHex(body) + '"', now + ttlMillis);
            entries.put(key, entry);
        }
        serve(entry, now, request, response);
    }

    // max-age counts down to the entry's expiry, so memory plus browser never exceeds one TTL.
    private static void serve(Entry entry, long now, HttpServletRequest request,
            HttpServletResponse response) throws IOException {
        long maxAge = Math.max(1, TimeUnit.MILLISECONDS.toSeconds(entry.expiresAt() - now + 999));
        response.setHeader(HttpHeaders.CACHE_CONTROL,
                CacheControl.maxAge(maxAge, TimeUnit.SECONDS).cachePublic().getHeaderValue());
        if (new ServletWebRequest(request, response).checkNotModified(entry.etag())) {
            return;
        }
        response.setContentType(entry.contentType());
        response.setContentLength(entry.body().length);
        response.getOutputStream().write(entry.body());
    }

    /** A signed-in client sends this on every read (http.js), so it always sees its own edits. */
    private static boolean wantsFresh(HttpServletRequest request) {
        String header = request.getHeader(HttpHeaders.CACHE_CONTROL);
        if (header == null) {
            return false;
        }
        String value = header.toLowerCase(Locale.ROOT);
        return value.contains("no-cache") || value.contains("max-age=0");
    }

    private record Entry(byte[] body, String contentType, String etag, long expiresAt) {
    }
}
