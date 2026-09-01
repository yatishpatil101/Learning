package com.punenest.api.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
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

/**
 * The write rate limit (tech-debt D2), enabled deliberately with a budget small enough to reach.
 *
 * <p><strong>Why this test has to turn the feature on.</strong> The rest of the suite runs with
 * {@code punenest.security.rate-limit.enabled=false}, because MockMvc gives every request the same
 * remote address and most of the ~700 HTTP tests are unauthenticated — so the whole suite presents
 * as one caller and would exhaust any realistic budget partway through, failing whichever test
 * happened to run next. That is exactly how a limiter ends up switched off everywhere and therefore
 * proved nowhere, so this class exists to be the one place it is on.
 *
 * <p><strong>Why every test invents its own client address.</strong> The filter — and so its
 * counter — is one object in a context cached across the whole class, so its state does not roll
 * back between test methods the way a database transaction does. Sharing an address would make each
 * test's outcome depend on how many requests the previously-run test happened to make: a dependency
 * on JUnit's method ordering, green today and red the day a test is added above it. A distinct
 * address per test buys real isolation, and it exercises the keying at the same time — which is
 * itself load-bearing, since a limiter that pooled every caller into one bucket would let a single
 * script lock out the platform.
 *
 * <p>The write used throughout is {@code POST /auth/login} with a body the endpoint rejects. The
 * status of the <em>allowed</em> requests is deliberately asserted only as "not 429": all that
 * matters is whether the filter let the request reach the application, and a 400 proves that as
 * well as a 200 would — better, since it needs no fixtures and cannot pass by accident.
 */
@SpringBootTest(properties = {
    "punenest.security.rate-limit.enabled=true",
    "punenest.security.rate-limit.writes-per-window=2",
    "punenest.security.rate-limit.window-seconds=60",
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
                // A 429 without Retry-After tells a client it is too fast but not by how much, which
                // leaves it guessing and being refused again. The honest number is the only thing
                // that lets a well-behaved client back off correctly.
                .andExpect(result -> Assertions
                        .assertThat(result.getResponse().getHeader("Retry-After"))
                        .as("Retry-After must be present and a positive whole number of seconds")
                        .isNotNull()
                        .satisfies(v -> Assertions.assertThat(Integer.parseInt(v)).isPositive()));
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

        // The general rule above — reads are never limited — has exactly two exceptions, and this is
        // the one whose risk is cost rather than enumeration. GET /me/data-export runs roughly
        // seventy queries across the whole schema and cannot be cached, because an access-request
        // document that is stale is a false statement about what the platform holds. Left
        // unlimited it would be the cheapest denial of service available against this platform,
        // funded by the platform, and reachable by any signed-in account.
        //
        // Asserted unauthenticated on purpose. The limiter runs before authorisation, so a 429 here
        // rather than a 401 proves the request was stopped by this filter and not by the security
        // chain — which is the only thing that would still be true if the endpoint's own auth
        // changed. The path is written out rather than referenced because this package deliberately
        // imports nothing from a feature package; that is precisely the coupling this test replaces.
        mvc.perform(get("/me/data-export").with(from("10.0.0.10")))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("the signed payment callback has its own budget, not an exemption")
    void callbacksHaveTheirOwnBudget() throws Exception {
        spendBudget("10.0.0.5");

        // The body is unsigned, so this is rejected on its merits — the point is only that it is not
        // rejected by the ordinary budget, which this caller has already spent. A dropped callback is
        // a customer who paid and was not credited, and the provider's retry arrives from the same
        // address and would hit the same bucket.
        mvc.perform(write(Routes.Webhooks.CASHFREE_PAYMENT, "10.0.0.5"))
                .andExpect(status().is(Matchers.not(429)));
    }

    @Test
    @DisplayName("an oversized callback body is refused before it is buffered")
    void oversizedCallbackBodyIsRefused() throws Exception {
        // The one write that is permitAll and takes an unbounded raw String, so that nothing else in
        // the stack bounds it: Tomcat's maxPostSize covers form encoding and multipart only. Without
        // this ceiling, a few hundred megabytes of unsigned JSON is materialised on the heap before
        // the HMAC is consulted.
        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .with(from("10.0.0.8"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(new byte[70 * 1024]))
                .andExpect(status().isPayloadTooLarge());
    }

    @Test
    @DisplayName("a callback that declares no length is refused too")
    void undeclaredCallbackBodyIsRefused() throws Exception {
        // An unknown length — in practice `Transfer-Encoding: chunked` — reports as -1, which passes
        // any `greater than the cap` test. Accepting it would have left the ceiling above bypassable
        // by a single request header, on an unauthenticated route, for an unbounded body.
        mvc.perform(post(Routes.Webhooks.CASHFREE_PAYMENT)
                        .with(from("10.0.0.9"))
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isPayloadTooLarge());
    }

    @Test
    @DisplayName("a path parameter does not escape the limit, encoded or not")
    void limitedReadSurvivesPathParameters() throws Exception {
        // Spring's path matching excludes `;name=value` segments, so `/documents/shared;x=1` reaches
        // the same handler. StrictHttpFirewall rejects both of these shapes today, which is why the
        // assertion is written against the filter's own helper rather than through MockMvc — the
        // point is that the limiter does not depend on the firewall staying strict.
        Assertions.assertThat(WriteRateLimitFilter.normalisedPath("/api", "/api"
                        + Routes.Documents.SHARED + ";x=1"))
                .isEqualTo(Routes.Documents.SHARED);

        // And encoded, which is the order-of-operations trap: cutting at `;` before decoding leaves
        // `%3B` intact, so the path matches nothing here while the dispatcher — which decodes first
        // and strips afterwards — still routes it to the protected handler.
        Assertions.assertThat(WriteRateLimitFilter.normalisedPath("/api", "/api"
                        + Routes.Documents.SHARED + "%3Bx=1"))
                .isEqualTo(Routes.Documents.SHARED);
    }

    @Test
    @DisplayName("an IPv6 caller is keyed on the /64, not the address")
    void ipv6IsKeyedByRoutingPrefix() {
        // A single host is routinely handed an entire /64, so keying on the full address gives it
        // 2^64 free budgets — the cheapest possible way to defeat the limit, and the reason the
        // tracked-key ceiling would otherwise be unreachable in principle.
        String first = WriteRateLimitFilter.anonymousKey("2001:db8:1234:5678:1::1");
        String second = WriteRateLimitFilter.anonymousKey("2001:db8:1234:5678:ffff::9");
        String other = WriteRateLimitFilter.anonymousKey("2001:db8:1234:9999::1");

        Assertions.assertThat(first).isEqualTo(second);
        Assertions.assertThat(first).isNotEqualTo(other);
        Assertions.assertThat(WriteRateLimitFilter.anonymousKey("203.0.113.7"))
                .as("IPv4 is already the unit a party controls")
                .isEqualTo("203.0.113.7");
    }

    /**
     * {@code GET /documents/shared} is the one read D2 named, because it is anonymous and guarded
     * only by a token in the query string — so the attack is enumeration and the defence has to be a
     * rate limit. These two cases are the ways a `security-reviewer` pass found to walk straight past
     * it, both of which reach the same handler with the same effect.
     */
    @Test
    @DisplayName("the enumerable read is limited on HEAD too, not only GET")
    void limitedReadCoversHead() throws Exception {
        // Spring MVC dispatches HEAD to the @GetMapping handler and merely drops the body, so the
        // status code answers "is this token real?" just as well. Matching on the method would have
        // made the control bypassable by one character.
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
        // `/documents/share%64` is a different string from `/documents/shared` but the same route:
        // the dispatcher matches on the decoded path, so a filter comparing the raw URI would wave
        // this through while Spring routed it to the very handler being protected. Built as a URI
        // rather than a template because the template form re-encodes the `%` and would test nothing.
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
        // Every one of these fails silently if clamped instead of rejected: a zero window restarts on
        // every request so nothing is ever limited and the app looks healthy, a zero budget refuses
        // every write on the platform, and an absurd window binds fine and then throws
        // DateTimeException out of the filter on the first write — a 500 on every mutating request.
        Assertions.assertThatIllegalArgumentException()
                .isThrownBy(() -> new WriteRateLimiter(0, Duration.ofSeconds(60)));
        Assertions.assertThatIllegalArgumentException()
                .isThrownBy(() -> new WriteRateLimiter(120, Duration.ZERO));
        Assertions.assertThatIllegalArgumentException()
                .isThrownBy(() -> new WriteRateLimiter(120, Duration.ofSeconds(-1)));
        Assertions.assertThatIllegalArgumentException()
                .isThrownBy(() -> new WriteRateLimiter(120, Duration.ofDays(4000)));
    }

    /**
     * The counter's own arithmetic, driven directly so the window can be crossed without waiting a
     * minute for it. Fixed-window behaviour is the part most likely to be silently wrong — an
     * off-by-one in the budget, or a window that never rolls — and neither is reachable through HTTP
     * without a clock the test cannot control.
     */
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

    /**
     * A flood of one-shot keys must not switch enforcement off, and must not evict the people using
     * the service.
     *
     * <p>The first version of this class stopped tracking new callers past a ceiling and let them
     * through unlimited, which is the protection failing in exactly the direction the attacker wants:
     * 50,000 addresses — one routed IPv6 /64, or an afternoon's proxy rental — would have disabled
     * the limiter for every user who arrived afterwards. Evicting instead means the map is bounded
     * and the limit still applies.
     *
     * <p>The victim is touched throughout the flood rather than only before it, because that is what
     * distinguishes the design from a merely-capped map: under insertion ordering the victim is
     * evicted and their counter silently resets, which is a targeted bypass rather than a bound. Only
     * access ordering keeps an active caller tracked while single-use keys churn through the tail.
     */
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
