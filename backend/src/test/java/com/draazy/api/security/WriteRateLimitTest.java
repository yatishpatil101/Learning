package com.draazy.api.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import java.time.Duration;
import java.time.Instant;
import org.assertj.core.api.Assertions;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/** The one place the write limiter is enabled; MockMvc gives every request one address, so other tests disable it.
 * Each test uses its own address because counters don't roll back. */
@SpringBootTest(properties = {
    "draazy.security.rate-limit.enabled=true",
    "draazy.security.rate-limit.writes-per-window=2",
    "draazy.security.rate-limit.locality-resolves-per-window=1",
    "draazy.security.rate-limit.window-seconds=60",
})
@AutoConfigureMockMvc
@DisplayName("Write rate limit (D2)")
class WriteRateLimitTest {

    private static final int BUDGET = 2;

    @Autowired
    MockMvc mvc;

    private static RequestPostProcessor from(String ip) {
        return request -> {
            request.setRemoteAddr(ip);
            return request;
        };
    }

    private static MockHttpServletRequestBuilder write(String path, String ip) {
        return post(path).with(from(ip)).contentType(MediaType.APPLICATION_JSON).content("{}");
    }

    /** Uses up one caller's whole allowance, so their next write must be refused. */
    private void spendBudget(String ip) throws Exception {
        for (int i = 0; i < BUDGET; i++) {
            mvc.perform(write(Routes.Auth.LOGIN, ip)).andExpect(status().is(Matchers.not(429)));
        }
    }

    @Test
    @DisplayName("a write past the budget is refused with the contract's 429 envelope")
    void writesAreCapped() throws Exception {
        spendBudget("10.0.0.1");

        mvc.perform(write(Routes.Auth.LOGIN, "10.0.0.1"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("rate_limited"))
                .andExpect(jsonPath("$.status").value(429))
                // Retry-After lets a well-behaved client back off correctly instead of being refused again.
                .andExpect(result -> Assertions
                        .assertThat(result.getResponse().getHeader("Retry-After"))
                        .as("Retry-After must be present and a positive whole number of seconds")
                        .isNotNull()
                        .satisfies(v -> Assertions.assertThat(Integer.parseInt(v)).isPositive()));
    }

    @Test
    @DisplayName("locality resolves have their own, smaller bucket that refuses before the general budget is spent")
    void localityResolvesAreCappedSeparately() throws Exception {
        mvc.perform(write(Routes.Localities.RESOLVE, "10.0.0.9")).andExpect(status().is(Matchers.not(429)));

        mvc.perform(write(Routes.Localities.RESOLVE, "10.0.0.9"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("rate_limited"));
        mvc.perform(write(Routes.Auth.LOGIN, "10.0.0.9")).andExpect(status().is(Matchers.not(429)));
        mvc.perform(write(Routes.Localities.RESOLVE, "10.0.0.50")).andExpect(status().is(Matchers.not(429)));
    }

    @Test
    @DisplayName("one exhausted caller does not affect another")
    void budgetIsPerCaller() throws Exception {
        spendBudget("10.0.0.2");

        mvc.perform(write(Routes.Auth.LOGIN, "10.0.0.2"))
                .andExpect(status().isTooManyRequests());
        mvc.perform(write(Routes.Auth.LOGIN, "10.0.0.3"))
                .andExpect(status().is(Matchers.not(429)));
    }

    @Test
    @DisplayName("reads are never limited, however many of them there are")
    void readsAreNotCapped() throws Exception {
        spendBudget("10.0.0.4");

        // Five times the budget. Reads are cheap, cacheable and often the entire reason someone is
        // on the site; the page-size ceiling is what bounds their cost, not this filter.
        for (int i = 0; i < BUDGET * 5; i++) {
            mvc.perform(get(Routes.Properties.BASE).with(from("10.0.0.4")))
                    .andExpect(status().isOk());
        }
    }

    @Test
    @DisplayName("the data export is limited despite being a read")
    void dataExportIsLimited() throws Exception {
        spendBudget("10.0.0.10");

        // Reads are exempt except this one, for cost: /me/data-export runs ~70 uncacheable queries.
        // Unauthenticated on purpose: a 429 rather than 401 proves this filter stopped it.
        mvc.perform(get("/me/data-export").with(from("10.0.0.10")))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("the signed payment callback has its own budget, not an exemption")
    void callbacksHaveTheirOwnBudget() throws Exception {
        spendBudget("10.0.0.5");

        // The unsigned body is rejected on its merits; the spent ordinary budget must not drop a provider's retry.
        mvc.perform(write(Routes.Webhooks.CASHFREE_PAYMENT, "10.0.0.5"))
                .andExpect(status().is(Matchers.not(429)));
    }

    @Test
    @DisplayName("an oversized callback body is refused before it is buffered")
    void oversizedCallbackBodyIsRefused() throws Exception {
        // The one permitAll write taking an unbounded raw String (Tomcat's maxPostSize covers form/multipart
        // only), so without this ceiling hundreds of MB of unsigned JSON hit the heap before the HMAC check.
        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .with(from("10.0.0.8"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(new byte[70 * 1024]))
                .andExpect(status().isPayloadTooLarge());
    }

    @Test
    @DisplayName("a callback that declares no length is refused too")
    void undeclaredCallbackBodyIsRefused() throws Exception {
        // Unknown length (chunked) reports -1, which would slip past a "greater than the cap" test.
        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .with(from("10.0.0.9"))
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isPayloadTooLarge());
    }

    @Test
    @DisplayName("a path parameter does not escape the limit, encoded or not")
    void limitedReadSurvivesPathParameters() throws Exception {
        // Spring's path matching ignores `;name=value` segments; asserted on the filter's helper rather than
        // MockMvc so the limiter doesn't depend on StrictHttpFirewall staying strict.
        Assertions.assertThat(WriteRateLimitFilter.normalisedPath("/api", "/api"
                        + Routes.Documents.SHARED + ";x=1"))
                .isEqualTo(Routes.Documents.SHARED);

        // Encoded: cutting at `;` before decoding leaves `%3B`, but the dispatcher decodes first and routes it.
        Assertions.assertThat(WriteRateLimitFilter.normalisedPath("/api", "/api"
                        + Routes.Documents.SHARED + "%3Bx=1"))
                .isEqualTo(Routes.Documents.SHARED);
    }

    @Test
    @DisplayName("an IPv6 caller is keyed on the /64, not the address")
    void ipv6IsKeyedByRoutingPrefix() {
        // A host is handed a whole /64, so keying on the full address would give it 2^64 free budgets.
        String first = WriteRateLimitFilter.anonymousKey("2001:db8:1234:5678:1::1");
        String second = WriteRateLimitFilter.anonymousKey("2001:db8:1234:5678:ffff::9");
        String other = WriteRateLimitFilter.anonymousKey("2001:db8:1234:9999::1");

        Assertions.assertThat(first).isEqualTo(second);
        Assertions.assertThat(first).isNotEqualTo(other);
        Assertions.assertThat(WriteRateLimitFilter.anonymousKey("203.0.113.7"))
                .as("IPv4 is already the unit a party controls")
                .isEqualTo("203.0.113.7");
    }

    /** {@code GET /documents/shared} is anonymous and guarded only by a query token, so enumeration needs a rate
     * limit; these two cases are bypasses that reach the same handler. */
    @Test
    @DisplayName("the enumerable read is limited on HEAD too, not only GET")
    void limitedReadCoversHead() throws Exception {
        // Spring MVC dispatches HEAD to the @GetMapping handler, so the status answers "is this token real?" too.
        for (int i = 0; i < BUDGET; i++) {
            mvc.perform(head(Routes.Documents.SHARED).param("token", "nope").with(from("10.0.0.6")))
                    .andExpect(status().is(Matchers.not(429)));
        }
        mvc.perform(head(Routes.Documents.SHARED).param("token", "nope").with(from("10.0.0.6")))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("percent-encoding the path does not escape the limit")
    void limitedReadSurvivesEncoding() throws Exception {
        // Built as a URI since a template re-encodes `%`; the dispatcher matches the decoded path.
        java.net.URI encoded = java.net.URI.create(
                Routes.Documents.SHARED.substring(0, Routes.Documents.SHARED.length() - 1)
                        + "%64?token=nope");
        for (int i = 0; i < BUDGET; i++) {
            mvc.perform(get(encoded).with(from("10.0.0.7")))
                    .andExpect(status().is(Matchers.not(429)));
        }
        mvc.perform(get(encoded).with(from("10.0.0.7")))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("a misconfigured budget or window is refused at construction, not at runtime")
    void misconfigurationFailsFast() {
        // Rejected, not clamped: a zero window never limits anything, a zero budget refuses every write, and an
        // absurd window throws DateTimeException on the first write.
        Assertions.assertThatIllegalArgumentException()
                .isThrownBy(() -> new WriteRateLimiter(0, Duration.ofSeconds(60)));
        Assertions.assertThatIllegalArgumentException()
                .isThrownBy(() -> new WriteRateLimiter(120, Duration.ZERO));
        Assertions.assertThatIllegalArgumentException()
                .isThrownBy(() -> new WriteRateLimiter(120, Duration.ofSeconds(-1)));
        Assertions.assertThatIllegalArgumentException()
                .isThrownBy(() -> new WriteRateLimiter(120, Duration.ofDays(4000)));
    }

    /** Driven directly to cross the window without waiting; HTTP can't expose off-by-one or stuck windows. */
    @Test
    @DisplayName("the window rolls over and the budget comes back")
    void windowRollsOver() {
        WriteRateLimiter limiter = new WriteRateLimiter(2, Duration.ofSeconds(60));
        Instant t0 = Instant.parse("2026-01-01T00:00:00Z");

        Assertions.assertThat(limiter.tryAcquire("u:alice", t0)).isZero();
        Assertions.assertThat(limiter.tryAcquire("u:alice", t0)).isZero();
        Assertions.assertThat(limiter.tryAcquire("u:alice", t0))
                .as("the third write in the window is refused, with the seconds until it reopens")
                .isEqualTo(60);

        Assertions.assertThat(limiter.tryAcquire("u:alice", t0.plusSeconds(59)))
                .as("still inside the window, so still refused — with one second left to wait")
                .isEqualTo(1);

        Assertions.assertThat(limiter.tryAcquire("u:alice", t0.plusSeconds(60)))
                .as("at exactly +60s the window has elapsed and the budget is fresh")
                .isZero();
    }

    /** One-shot keys must neither switch enforcement off nor evict active callers; the victim is touched
     * throughout since only access ordering keeps them tracked. */
    @Test
    @DisplayName("a key-space flood evicts the idle, not the active, and the limit still bites")
    void floodEvictsRatherThanDisabling() {
        WriteRateLimiter limiter = new WriteRateLimiter(1, Duration.ofSeconds(60));
        Instant t0 = Instant.parse("2026-01-01T00:00:00Z");

        Assertions.assertThat(limiter.tryAcquire("ip:victim", t0)).isZero();
        for (int i = 0; i < 60_000; i++) {
            limiter.tryAcquire("ip:flood-" + i, t0);
            if (i % 1_000 == 0) {
                Assertions.assertThat(limiter.tryAcquire("ip:victim", t0))
                        .as("the victim stays over budget throughout the flood; if they are evicted "
                                + "their counter resets and the flood has bought them a fresh one")
                        .isPositive();
            }
        }

        Assertions.assertThat(limiter.tracked())
                .as("the map is capped however many distinct keys arrive")
                .isLessThanOrEqualTo(50_000);
        Assertions.assertThat(limiter.tryAcquire("ip:victim", t0))
                .as("and is still over budget after it")
                .isPositive();
        Assertions.assertThat(limiter.tryAcquire("ip:newcomer", t0))
                .as("a caller arriving after the flood is still counted — the old fail-open version "
                        + "would have let them through unlimited")
                .isZero();
        Assertions.assertThat(limiter.tryAcquire("ip:newcomer", t0)).isPositive();
    }
}
