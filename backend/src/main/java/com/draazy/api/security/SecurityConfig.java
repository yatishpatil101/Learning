package com.draazy.api.security;

import com.draazy.api.common.settings.PlatformSettings;
import com.draazy.api.common.web.Routes;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;

/**
 * The one stateless resource-server chain every request flows through. Filter order, the disabled
 * CSRF decision, the header policy and every public matcher: docs/system/cross-cutting.md §8.
 */
@Configuration
@EnableMethodSecurity
@EnableConfigurationProperties(JwtProperties.class)
public class SecurityConfig {

    private final JwtService jwtService;
    private final RestAuthEntryPoint authEntryPoint;
    private final RestAccessDeniedHandler accessDeniedHandler;
    private final BotDefence botDefence;
    private final WriteRateLimitStore.Factory rateLimitStores;
    private final boolean rateLimitEnabled;
    private final int writeBudget;
    private final Duration rateLimitWindow;
    private final boolean proxyAware;

    public SecurityConfig(JwtService jwtService, RestAuthEntryPoint authEntryPoint,
            RestAccessDeniedHandler accessDeniedHandler, BotDefence botDefence,
            WriteRateLimitStore.Factory rateLimitStores,
            @Value("${draazy.security.rate-limit.enabled:true}") boolean rateLimitEnabled,
            @Value("${draazy.security.rate-limit.writes-per-window:120}") int writeBudget,
            @Value("${draazy.security.rate-limit.window-seconds:60}") long windowSeconds,
            @Value("${draazy.security.trusted-proxies:none}") String trustedProxies) {
        this.jwtService = jwtService;
        this.authEntryPoint = authEntryPoint;
        this.accessDeniedHandler = accessDeniedHandler;
        // Injected rather than resolved on demand so a misconfiguration producing no BotDefence
        // bean — or two — fails at startup rather than on the first anonymous form submission.
        this.botDefence = botDefence;
        // Where the counters live: per-instance memory by default, Redis when configured.
        this.rateLimitStores = rateLimitStores;
        this.rateLimitEnabled = rateLimitEnabled;
        this.writeBudget = writeBudget;
        this.rateLimitWindow = Duration.ofSeconds(windowSeconds);
        // Addresses are resolved by TrustedProxyConfig, not here; this only tells the filter
        // whether a forwarded header arriving at runtime is evidence of a misconfiguration.
        this.proxyAware = !TrustedProxyConfig.NO_PROXY.equalsIgnoreCase(trustedProxies.trim());
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, RoleSource roles,
            PlatformSettings platformSettings) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                // Spring Security's defaults omit Referrer-Policy, and GET /documents/shared
                // carries a credential in its query string. Rationale: cross-cutting.md §8.3.
                .headers(headers -> headers.referrerPolicy(referrer ->
                        referrer.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER)))
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // Public auth entry points (contract: security: []). The invite redeem is
                        // anonymous because the single-use token IS the credential.
                        .requestMatchers(HttpMethod.POST,
                                Routes.Auth.LOGIN, Routes.Auth.STAFF_LOGIN,
                                Routes.Auth.REFRESH,
                                Routes.Auth.STAFF_INVITE_REDEEM).permitAll()
                        // Public catalogue reads. Single-segment matcher keeps deeper writes
                        // (e.g. /{id}/archive) authenticated; TRUST_STATS is named by decision.
                        .requestMatchers(HttpMethod.GET,
                                Routes.Properties.BASE, Routes.Properties.FEATURED,
                                Routes.Properties.TRUST_STATS,
                                Routes.Properties.ANY_SINGLE).permitAll()
                        // The rooms a flat has been split into. Its own line because ANY_SINGLE is
                        // single-segment; GET-only, and the payload carries no host number.
                        .requestMatchers(HttpMethod.GET, Routes.Properties.ROOMS).permitAll()
                        // The public seller card — the only public route that reads the users
                        // table. Capped in OwnerProfileResponse, mobile masked in the service.
                        .requestMatchers(HttpMethod.GET, Routes.Owners.ANY_SINGLE).permitAll()
                        // Public reference catalogue: the pages a visitor sees before deciding
                        // whether to sign up at all. Why each is public: cross-cutting.md §8.4.
                        .requestMatchers(HttpMethod.GET,
                                Routes.Cities.BASE,
                                Routes.Localities.BASE, Routes.Localities.ANY_SINGLE,
                                Routes.Societies.BASE, Routes.Societies.ANY_SINGLE,
                                // The five public two-segment society reads, named individually
                                // because ANY_SINGLE does not cover them and its siblings are writes.
                                Routes.Societies.MEMBERSHIP,
                                Routes.Societies.QUESTIONS,
                                Routes.Societies.BOARD,
                                Routes.Societies.CONTRIBUTIONS,
                                Routes.Societies.PROPOSALS,
                                Routes.Reels.BASE,
                                Routes.Fees.BASE,
                                // The config blocks a logged-out visitor's render depends on, each
                                // scoped to one block so the rest of /admin/settings stays admin.
                                Routes.Flags.BASE,
                                Routes.Plans.BASE,
                                Routes.Boosts.PACKS,
                                Routes.ServiceCatalog.BASE,
                                Routes.MovePack.BASE,
                                Routes.Pricing.BASE,
                                Routes.Geo.BASE).permitAll()
                        // The catalogue's only public write: joining a waitlist for a city we do
                        // not serve. The people it exists for are not users and may never be.
                        .requestMatchers(HttpMethod.POST, Routes.Cities.WAITLIST).permitAll()
                        // The B2B pipeline's front door. POST-only — reading the leads back is
                        // staff/admin. Rate-limited per mobile in SocietyLeadService.
                        .requestMatchers(HttpMethod.POST, Routes.SocietyLeads.BASE).permitAll()
                        // "Tell me when this launches". POST-only and no read at all; rate-limited
                        // in TicketService.joinWaitlist and challenged in BotDefenceFilter.
                        .requestMatchers(HttpMethod.POST, Routes.ServiceWaitlist.BASE).permitAll()
                        // Anonymous demand telemetry. Write-only by design: a public read of the
                        // aggregate would map what Draazy is short of, locality by locality.
                        .requestMatchers(HttpMethod.POST, Routes.DemandSignals.BASE).permitAll()
                        .requestMatchers(HttpMethod.POST, Routes.PageViews.BASE).permitAll()
                        // The flatmates feed. Exact-path and GET-only: the writes beside it are
                        // role- or author-scoped, and the interest route releases a phone number.
                        .requestMatchers(HttpMethod.GET, Routes.Flatmates.POSTS).permitAll()
                        // The rest of the public flatmates surface, one matcher per route: every
                        // write in this family differs from its read only by method or one suffix.
                        .requestMatchers(HttpMethod.GET,
                                Routes.Flatmates.FEED,
                                Routes.Flatmates.ROOMS,
                                Routes.Flatmates.GROUPS).permitAll()
                        // Public editorial + reviews. Per-method because the two review routes
                        // serve a public GET and an authenticated POST on the identical path.
                        .requestMatchers(HttpMethod.GET,
                                Routes.Content.ANNOUNCEMENTS, Routes.Content.SERVICES,
                                Routes.Content.FAQS, Routes.Content.BANNERS,
                                Routes.Reviews.FOR_PROPERTY, Routes.Reviews.SUMMARY_FOR_PROPERTY,
                                Routes.Reviews.FOR_ENTITY,
                                Routes.Reviews.SUMMARY_FOR_ENTITY).permitAll()
                        // Token-scoped document share: the expiring token IS the credential,
                        // checked in DocumentRequestService.shared. GET-only and exact-path.
                        .requestMatchers(HttpMethod.GET, Routes.Documents.SHARED).permitAll()
                        // Server-to-server callback. No user session; authenticity is an HMAC over
                        // the raw body, verified in the handler.
                        .requestMatchers(HttpMethod.POST,
                                Routes.Webhooks.CASHFREE_PAYMENT).permitAll()
                        // Docs + Swagger UI + static OpenAPI + liveness/readiness.
                        .requestMatchers("/", "/favicon.ico",
                                "/docs", "/docs/**", "/swagger-ui/**", "/webjars/**",
                                "/openapi/**", "/actuator/health/**", "/actuator/info").permitAll()
                        // CORS preflight.
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(authEntryPoint)
                        .accessDeniedHandler(accessDeniedHandler))
                // A bean-method parameter, not a constructor field: a @Configuration class holding
                // a JPA repository forces persistence up ahead of the bean post-processors.
                .addFilterBefore(new JwtAuthFilter(jwtService, roles),
                        UsernamePasswordAuthenticationFilter.class);
        if (rateLimitEnabled) {
            // After the JWT filter, so the counter keys on a user id. Off for the test run, where
            // ~700 MockMvc tests share one anonymous bucket; WriteRateLimitTest turns it back on.
            http.addFilterAfter(
                    new WriteRateLimitFilter(writeBudget, rateLimitWindow, proxyAware,
                            rateLimitStores),
                    JwtAuthFilter.class);
        }
        // Registered unconditionally, unlike the rate limiter: which BotDefence bean was wired
        // decides whether it acts, so the enabled and disabled paths cannot drift.
        http.addFilterAfter(new BotDefenceFilter(botDefence), JwtAuthFilter.class);
        // Last, so the two cheap in-memory defences refuse a flood without a database query; after
        // the JWT filter because it is answered by a caller's role.
        http.addFilterAfter(new MaintenanceModeFilter(platformSettings), BotDefenceFilter.class);
        return http.build();
    }

    /** BCrypt for the internal staff/admin password path; buyers/owners stay passwordless (OTP). */
    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
