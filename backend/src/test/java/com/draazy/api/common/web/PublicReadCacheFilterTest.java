package com.draazy.api.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** The Java suite and e2e run with the cache off, so this is where its behaviour is proved. */
class PublicReadCacheFilterTest {

    private final AtomicInteger calls = new AtomicInteger();
    private int status = 200;

    /** Answers a body that changes on every call, so a replay is distinguishable from a recompute. */
    private final FilterChain controller = (req, res) -> {
        int n = calls.incrementAndGet();
        var http = (HttpServletResponse) res;
        http.setStatus(status);
        http.setContentType("application/json");
        http.getWriter().write("{\"n\":" + n + "}");
    };

    private final PublicReadCacheFilter filter = new PublicReadCacheFilter(Duration.ofSeconds(30));

    @Test
    void aRepeatAnonymousReadIsAnsweredFromMemoryWithAPublicCountdown() throws Exception {
        var first = send(get("/flags"));
        var second = send(get("/flags"));

        assertThat(calls).hasValue(1);
        assertThat(second.getContentAsString()).isEqualTo("{\"n\":1}").isEqualTo(first.getContentAsString());
        assertThat(second.getContentType()).startsWith("application/json");
        assertThat(second.getHeader("Cache-Control")).matches("max-age=(30|29), public");
        assertThat(second.getHeader("ETag")).isEqualTo(first.getHeader("ETag")).isNotBlank();
    }

    @Test
    void aSignedInReadBypassesTheEntryAndRefreshesItForEveryoneElse() throws Exception {
        send(get("/cities"));

        var fresh = get("/cities");
        fresh.addHeader("Cache-Control", "max-age=0");
        assertThat(send(fresh).getContentAsString()).isEqualTo("{\"n\":2}");

        assertThat(send(get("/cities")).getContentAsString()).isEqualTo("{\"n\":2}");
        assertThat(calls).hasValue(2);
    }

    @Test
    void aMatchingETagIsAnsweredNotModifiedWithNoBody() throws Exception {
        String etag = send(get("/pricing")).getHeader("ETag");

        var conditional = get("/pricing");
        conditional.addHeader("If-None-Match", etag);
        var response = send(conditional);

        assertThat(response.getStatus()).isEqualTo(304);
        assertThat(response.getContentAsByteArray()).isEmpty();
        assertThat(calls).hasValue(1);
    }

    @Test
    void aFailureIsPassedThroughAndNeverRemembered() throws Exception {
        status = 503;
        var failed = send(get("/geo"));
        status = 200;
        var recovered = send(get("/geo"));

        assertThat(failed.getStatus()).isEqualTo(503);
        assertThat(failed.getContentAsString()).isEqualTo("{\"n\":1}");
        assertThat(failed.getHeader("Cache-Control")).isNull();
        assertThat(recovered.getContentAsString()).isEqualTo("{\"n\":2}");
    }

    @Test
    void theQueryStringIsPartOfTheKey() throws Exception {
        var baner = get("/properties/trust-stats");
        baner.setQueryString("locality=baner");
        var wakad = get("/properties/trust-stats");
        wakad.setQueryString("locality=wakad");

        send(baner);
        assertThat(send(wakad).getContentAsString()).isEqualTo("{\"n\":2}");
    }

    @Test
    void anExpiredEntryIsRecomputed() throws Exception {
        var shortLived = new PublicReadCacheFilter(Duration.ofMillis(1));
        send(shortLived, get("/fees"));
        Thread.sleep(5);

        assertThat(send(shortLived, get("/fees")).getContentAsString()).isEqualTo("{\"n\":2}");
    }

    @Test
    void theOldestEntryIsDroppedOnceTheBoundIsReached() throws Exception {
        for (int i = 0; i <= PublicReadCacheFilter.MAX_ENTRIES; i++) {
            var request = get("/properties/trust-stats");
            request.setQueryString("locality=l" + i);
            send(request);
        }
        var oldest = get("/properties/trust-stats");
        oldest.setQueryString("locality=l0");
        send(oldest);

        assertThat(calls).hasValue(PublicReadCacheFilter.MAX_ENTRIES + 2);
    }

    @Test
    void onlyAnonymousStyleGetsOnTheListUnderTheContextPathAreCached() {
        var underApi = new MockHttpServletRequest("GET", "/api/flags");
        underApi.setContextPath("/api");

        assertThat(filter.caches(underApi)).isTrue();
        assertThat(filter.caches(new MockHttpServletRequest("POST", "/flags"))).isFalse();
        assertThat(filter.caches(get("/properties"))).isFalse();
        assertThat(filter.caches(get("/me/listings"))).isFalse();
        assertThat(new PublicReadCacheFilter(Duration.ZERO).caches(get("/flags"))).isFalse();
    }

    private static MockHttpServletRequest get(String path) {
        return new MockHttpServletRequest("GET", path);
    }

    private MockHttpServletResponse send(MockHttpServletRequest request) throws Exception {
        return send(filter, request);
    }

    private MockHttpServletResponse send(PublicReadCacheFilter target, MockHttpServletRequest request)
            throws Exception {
        var response = new MockHttpServletResponse();
        target.doFilter(request, response, controller);
        return response;
    }
}
