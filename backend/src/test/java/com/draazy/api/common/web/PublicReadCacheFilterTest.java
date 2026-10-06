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
        var first = send(get("/bootstrap"));
        var second = send(get("/bootstrap"));

        assertThat(calls).hasValue(1);
        assertThat(second.getContentAsString()).isEqualTo("{\"n\":1}").isEqualTo(first.getContentAsString());
        assertThat(second.getContentType()).startsWith("application/json");
        assertThat(second.getHeader("Cache-Control")).matches("max-age=(30|29), public");
        assertThat(second.getHeader("ETag")).isEqualTo(first.getHeader("ETag")).isNotBlank();
    }

    @Test
    void aSignedInReadBypassesTheEntryAndRefreshesItForEveryoneElse() throws Exception {
        send(get("/localities"));

        var fresh = get("/localities");
        fresh.addHeader("Cache-Control", "max-age=0");
        assertThat(send(fresh).getContentAsString()).isEqualTo("{\"n\":2}");

        assertThat(send(get("/localities")).getContentAsString()).isEqualTo("{\"n\":2}");
        assertThat(calls).hasValue(2);
    }

    @Test
    void aMatchingETagIsAnsweredNotModifiedWithNoBody() throws Exception {
        String etag = send(get("/faqs")).getHeader("ETag");

        var conditional = get("/faqs");
        conditional.addHeader("If-None-Match", etag);
        var response = send(conditional);

        assertThat(response.getStatus()).isEqualTo(304);
        assertThat(response.getContentAsByteArray()).isEmpty();
        assertThat(calls).hasValue(1);
    }

    @Test
    void aFailureIsPassedThroughAndNeverRemembered() throws Exception {
        status = 503;
        var failed = send(get("/bootstrap"));
        status = 200;
        var recovered = send(get("/bootstrap"));

        assertThat(failed.getStatus()).isEqualTo(503);
        assertThat(failed.getContentAsString()).isEqualTo("{\"n\":1}");
        assertThat(failed.getHeader("Cache-Control")).isNull();
        assertThat(recovered.getContentAsString()).isEqualTo("{\"n\":2}");
    }

    @Test
    void theQueryStringIsPartOfTheKey() throws Exception {
        var baner = get("/bootstrap");
        baner.setQueryString("v=baner");
        var wakad = get("/bootstrap");
        wakad.setQueryString("v=wakad");

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
            var request = get("/bootstrap");
            request.setQueryString("v=l" + i);
            send(request);
        }
        var oldest = get("/bootstrap");
        oldest.setQueryString("v=l0");
        send(oldest);

        assertThat(calls).hasValue(PublicReadCacheFilter.MAX_ENTRIES + 2);
    }

    @Test
    void aSuccessfulAdminWriteEvictsEveryEntry() throws Exception {
        send(get("/bootstrap"));
        send(new MockHttpServletRequest("PUT", "/admin/settings"));

        assertThat(send(get("/bootstrap")).getContentAsString()).isEqualTo("{\"n\":3}");
    }

    @Test
    void aRejectedAdminWriteEvictsNothing() throws Exception {
        send(get("/bootstrap"));
        status = 422;
        send(new MockHttpServletRequest("PUT", "/admin/settings"));
        status = 200;

        assertThat(send(get("/bootstrap")).getContentAsString()).isEqualTo("{\"n\":1}");
    }

    @Test
    void onlyAnonymousStyleGetsOnTheListUnderTheContextPathAreCached() {
        var underApi = new MockHttpServletRequest("GET", "/api/bootstrap");
        underApi.setContextPath("/api");

        assertThat(filter.caches(underApi)).isTrue();
        assertThat(filter.caches(new MockHttpServletRequest("POST", "/bootstrap"))).isFalse();
        assertThat(filter.caches(get("/properties"))).isFalse();
        assertThat(filter.caches(get("/me/listings"))).isFalse();
        assertThat(new PublicReadCacheFilter(Duration.ZERO).caches(get("/bootstrap"))).isFalse();
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
