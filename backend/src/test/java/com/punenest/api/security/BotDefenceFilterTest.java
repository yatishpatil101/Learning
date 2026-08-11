package com.punenest.api.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.punenest.api.common.web.Routes;
import jakarta.servlet.ServletException;
import java.io.IOException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * The bot-defence filter (tech-debt D130).
 *
 * <p>Driven directly rather than through MockMvc, because the two things worth proving are which
 * requests reach the chain and what the refusal looks like — both visible here without a context,
 * and both obscured by a controller that would return its own status. The fake defences below make
 * the enabled/disabled asymmetry explicit: the same request is a pass with one and a 403 with the
 * other, which is the only property of this filter that matters.
 */
@DisplayName("Bot defence filter (D130)")
class BotDefenceFilterTest {

    private static final String GOOD = "a-token-the-provider-accepts";

    private final MockHttpServletResponse response = new MockHttpServletResponse();
    private final MockFilterChain chain = new MockFilterChain();

    /** Enforcing, and accepting only {@link #GOOD}. */
    private static BotDefence enforcing() {
        return new BotDefence() {
            @Override
            public boolean enforced() {
                return true;
            }

            @Override
            public boolean verify(String token, String remoteIp) {
                return GOOD.equals(token);
            }
        };
    }

    /** Enforcing, with a provider that never answers — the outage case. */
    private static BotDefence unreachable() {
        return new BotDefence() {
            @Override
            public boolean enforced() {
                return true;
            }

            @Override
            public boolean verify(String token, String remoteIp) {
                // What TurnstileBotDefence returns when the HTTP call throws: a refusal, never an
                // exception. See TurnstileBotDefenceTest for the real thing doing this.
                return false;
            }
        };
    }

    private static MockHttpServletRequest post(String path) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
        request.setRequestURI(path);
        request.setRemoteAddr("203.0.113.9");
        return request;
    }

    private void run(BotDefence defence, MockHttpServletRequest request)
            throws ServletException, IOException {
        new BotDefenceFilter(defence).doFilter(request, response, chain);
    }

    /** The chain only advances when the filter let the request through. */
    private boolean reachedApplication() {
        return chain.getRequest() != null;
    }

    @Nested
    @DisplayName("when no challenge is configured")
    class Disabled {

        @Test
        @DisplayName("passes a challenged write straight through, with no token at all")
        void passesThrough() throws Exception {
            run(new NoopBotDefence(), post(Routes.SocietyLeads.BASE));

            assertThat(reachedApplication())
                    .as("the unconfigured default must never block a request")
                    .isTrue();
            assertThat(response.getStatus()).isEqualTo(200);
        }
    }

    @Nested
    @DisplayName("when a challenge is configured")
    class Enabled {

        @Test
        @DisplayName("accepts a write carrying a token the provider confirms")
        void acceptsValidToken() throws Exception {
            MockHttpServletRequest request = post(Routes.SocietyLeads.BASE);
            request.addHeader(BotDefenceFilter.TOKEN_HEADER, GOOD);

            run(enforcing(), request);

            assertThat(reachedApplication()).isTrue();
        }

        @Test
        @DisplayName("refuses a write carrying a token the provider rejects")
        void refusesInvalidToken() throws Exception {
            MockHttpServletRequest request = post(Routes.SocietyLeads.BASE);
            request.addHeader(BotDefenceFilter.TOKEN_HEADER, "forged");

            run(enforcing(), request);

            assertThat(reachedApplication()).isFalse();
            assertThat(response.getStatus()).isEqualTo(403);
            assertThat(response.getContentAsString()).contains("\"error\":\"forbidden\"");
        }

        @Test
        @DisplayName("refuses a write with no token, rather than treating absence as consent")
        void refusesMissingToken() throws Exception {
            run(enforcing(), post(Routes.SocietyLeads.BASE));

            assertThat(reachedApplication())
                    .as("omitting the header must not be an exemption; that is every script")
                    .isFalse();
            assertThat(response.getStatus()).isEqualTo(403);
        }

        @Test
        @DisplayName("refuses an absurdly long token instead of forwarding it to the provider")
        void refusesOversizedToken() throws Exception {
            MockHttpServletRequest request = post(Routes.SocietyLeads.BASE);
            request.addHeader(BotDefenceFilter.TOKEN_HEADER, "x".repeat(5000));

            run(enforcing(), request);

            assertThat(reachedApplication()).isFalse();
            assertThat(response.getStatus()).isEqualTo(403);
        }

        @Test
        @DisplayName("refuses when the provider cannot be reached — fail closed, not open")
        void refusesWhenProviderUnreachable() throws Exception {
            MockHttpServletRequest request = post(Routes.SocietyLeads.BASE);
            request.addHeader(BotDefenceFilter.TOKEN_HEADER, GOOD);

            run(unreachable(), request);

            assertThat(reachedApplication())
                    .as("an attacker who can break verification must not thereby disable it")
                    .isFalse();
            assertThat(response.getStatus()).isEqualTo(403);
        }

        @Test
        @DisplayName("gives an unreachable provider the same answer as a forged token")
        void doesNotLeakWhichFailureOccurred() throws Exception {
            MockHttpServletRequest forged = post(Routes.SocietyLeads.BASE);
            forged.addHeader(BotDefenceFilter.TOKEN_HEADER, "forged");
            MockHttpServletResponse forgedResponse = new MockHttpServletResponse();
            new BotDefenceFilter(enforcing())
                    .doFilter(forged, forgedResponse, new MockFilterChain());

            MockHttpServletRequest outage = post(Routes.SocietyLeads.BASE);
            outage.addHeader(BotDefenceFilter.TOKEN_HEADER, GOOD);
            MockHttpServletResponse outageResponse = new MockHttpServletResponse();
            new BotDefenceFilter(unreachable())
                    .doFilter(outage, outageResponse, new MockFilterChain());

            assertThat(outageResponse.getStatus()).isEqualTo(forgedResponse.getStatus());
            assertThat(outageResponse.getContentAsString())
                    .as("telling a caller the provider is down invites them to keep trying")
                    .isEqualTo(forgedResponse.getContentAsString());
        }

        @Test
        @DisplayName("challenges the login door and the waitlist, not only the lead form")
        void challengesEveryPublicWrite() throws Exception {
            for (String path : new String[] {Routes.Auth.LOGIN, Routes.Cities.WAITLIST}) {
                MockHttpServletResponse each = new MockHttpServletResponse();
                MockFilterChain eachChain = new MockFilterChain();
                new BotDefenceFilter(enforcing()).doFilter(post(path), each, eachChain);

                assertThat(eachChain.getRequest()).as(path).isNull();
                assertThat(each.getStatus()).as(path).isEqualTo(403);
            }
        }

        @Test
        @DisplayName("still challenges a percent-encoded spelling of a protected path")
        void normalisesBeforeMatching() throws Exception {
            // /society-lead%73 decodes to /society-leads, which the dispatcher routes to the
            // protected handler. A raw string comparison would see an unknown path and wave it past.
            MockHttpServletRequest request = post("/society-leads");
            request.setRequestURI("/society-lead%73");

            run(enforcing(), request);

            assertThat(reachedApplication()).isFalse();
            assertThat(response.getStatus()).isEqualTo(403);
        }

        @Test
        @DisplayName("leaves authenticated writes alone, so the app does not need a token to work")
        void ignoresEndpointsOutsideTheAllowList() throws Exception {
            run(enforcing(), post("/me/listings"));

            assertThat(reachedApplication())
                    .as("challenging authenticated writes breaks every background save and retry")
                    .isTrue();
        }

        @Test
        @DisplayName("leaves the provider callbacks alone — there is no browser to solve a challenge")
        void ignoresServerToServerCallbacks() throws Exception {
            run(enforcing(), post(Routes.Webhooks.CASHFREE_PAYMENT));

            assertThat(reachedApplication()).isTrue();
        }

        @Test
        @DisplayName("leaves reads alone, including a GET on a challenged path")
        void ignoresReads() throws Exception {
            MockHttpServletRequest request = new MockHttpServletRequest("GET", Routes.Cities.BASE);
            request.setRequestURI(Routes.Cities.WAITLIST);

            run(enforcing(), request);

            assertThat(reachedApplication()).isTrue();
        }
    }
}
