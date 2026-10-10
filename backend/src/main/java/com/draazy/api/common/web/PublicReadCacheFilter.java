package com.draazy.api.common.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.server.PathContainer;
import org.springframework.stereotype.Component;
import org.springframework.util.DigestUtils;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

/** Serves public reference reads from memory and lets browsers and the edge cache them (cross-cutting.md §9). */
@Component
// After Spring Security, so a hit still passes the origin gate, CORS and the security headers.
@Order(Ordered.LOWEST_PRECEDENCE)
public class PublicReadCacheFilter extends OncePerRequestFilter {

    // Each must answer every caller identically: one that varied by caller would leak across users.
    static final Set<String> PATHS = Set.of(
            Routes.Bootstrap.BASE, Routes.Fees.BASE, Routes.Localities.BASE, Routes.Content.FAQS,
            Routes.Properties.FEATURED, Routes.Properties.SEARCH_INDEX, Routes.Societies.TOP);

    // Caller-aware for a signed-in viewer (the owner, a checker), identical for every anonymous one.
    static final List<PathPattern> ANONYMOUS = Stream.of(
                    Routes.Properties.BASE, Routes.Properties.ANY_SINGLE, Routes.Reviews.FOR_PROPERTY,
                    Routes.Reviews.FOR_ENTITY, Routes.Owners.ANY_SINGLE, Routes.Localities.ANY_SINGLE,
                    Routes.Societies.BASE, Routes.Societies.ANY_SINGLE, Routes.Societies.ANY_BRIEF,
                    Routes.Flatmates.FEED, Routes.Flatmates.GROUP_BY_ID, Routes.Flatmates.ROOM_BY_ID,
                    Routes.Flatmates.POST_BY_ID)
            .map(PathPatternParser.defaultInstance::parse).toList();

    private static final String ADMIN_PREFIX = "/admin/";

    private static final Set<String> READ_METHODS = Set.of("GET", "HEAD", "OPTIONS");

    /** Bounds memory against arbitrary query strings, e.g. {@code /properties/featured?x=<random>}. */
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
        if (ttlMillis <= 0 || !"GET".equals(request.getMethod())) {
            return false;
        }
        String path = pathOf(request);
        return PATHS.contains(path) || (isAnonymous(request) && anonymousRoute(path));
    }

    private static boolean isAnonymous(HttpServletRequest request) {
        return request.getHeader(HttpHeaders.AUTHORIZATION) == null;
    }

    private static boolean anonymousRoute(String path) {
        PathContainer container = PathContainer.parsePath(path);
        return ANONYMOUS.stream().anyMatch(p -> p.matches(container));
    }

    // Every back-office write can change a cached answer (settings, cities, plans, FAQs, moderation),
    // so a successful one drops them all. Only on this instance: the others serve out their TTL.
    private boolean evicts(HttpServletRequest request) {
        return ttlMillis > 0 && !READ_METHODS.contains(request.getMethod())
                && pathOf(request).startsWith(ADMIN_PREFIX);
    }

    private static String pathOf(HttpServletRequest request) {
        return request.getRequestURI().substring(request.getContextPath().length());
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !caches(request) && !evicts(request);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        if (!caches(request)) {
            chain.doFilter(request, response);
            if (response.getStatus() < HttpServletResponse.SC_BAD_REQUEST) {
                entries.clear();
            }
            return;
        }
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
            // Weak: Tomcat will not gzip a response that carries a strong ETag.
            entry = new Entry(body, buffer.getContentType(),
                    "W/\"" + DigestUtils.md5DigestAsHex(body) + '"', now + ttlMillis);
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
        // Else a browser could replay an anonymous answer to the same visitor just after sign-in.
        response.addHeader(HttpHeaders.VARY, HttpHeaders.AUTHORIZATION);
        if (new ServletWebRequest(request, response).checkNotModified(entry.etag())) {
            return;
        }
        response.setContentType(entry.contentType());
        response.setContentLength(entry.body().length);
        response.getOutputStream().write(entry.body());
    }

    /** Sent on every staff and admin read (http.js), so an editor always sees their own edits. */
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
