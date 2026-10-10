package com.draazy.api.security;

import com.draazy.api.common.settings.PlatformSettings;
import com.draazy.api.common.web.Routes;
import jakarta.servlet.DispatcherType;
import java.time.Duration;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.access.hierarchicalroles.RoleHierarchy;
import org.springframework.security.access.hierarchicalroles.RoleHierarchyImpl;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter;

/** The one stateless resource-server chain every request flows through. Filter order, the disabled
 * CSRF decision, the header policy and every public matcher: docs/system/cross-cutting.md §8. */
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
    private final int localityResolveBudget;
    private final int propertyReadBudget;
    private final Duration rateLimitWindow;
    private final boolean proxyAware;
    private final Optional<OriginGateFilter> originGate;

    public SecurityConfig(JwtService jwtService, RestAuthEntryPoint authEntryPoint,
            RestAccessDeniedHandler accessDeniedHandler, BotDefence botDefence,
            WriteRateLimitStore.Factory rateLimitStores,
            @Value("${draazy.security.rate-limit.enabled:true}") boolean rateLimitEnabled,
            @Value("${draazy.security.rate-limit.writes-per-window:120}") int writeBudget,
            @Value("${draazy.security.rate-limit.locality-resolves-per-window:10}") int localityResolveBudget,
            @Value("${draazy.security.rate-limit.property-reads-per-window:600}") int propertyReadBudget,
            @Value("${draazy.security.rate-limit.window-seconds:60}") long windowSeconds,
            @Value("${draazy.security.trusted-proxies:none}") String trustedProxies,
            @Value("${draazy.security.origin-secret}") String originSecret) {
        this.jwtService = jwtService;
        this.authEntryPoint = authEntryPoint;
        this.accessDeniedHandler = accessDeniedHandler;

        // Injected rather than resolved on demand so a misconfiguration producing no BotDefence
        // bean — or two — fails at startup rather than on the first anonymous form submission.
        this.botDefence = botDefence;

        this.rateLimitStores = rateLimitStores;
        this.rateLimitEnabled = rateLimitEnabled;
        this.writeBudget = writeBudget;
        this.localityResolveBudget = localityResolveBudget;
        this.propertyReadBudget = propertyReadBudget;
        this.rateLimitWindow = Duration.ofSeconds(windowSeconds);

        this.proxyAware = !TrustedProxyConfig.NO_PROXY.equalsIgnoreCase(trustedProxies.trim());
        this.originGate = OriginGateFilter.fromSetting(originSecret);
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
                        .dispatcherTypeMatchers(DispatcherType.ASYNC, DispatcherType.ERROR).permitAll()

                        // Public auth entry points (contract: security: []). The invite redeem is
                        // anonymous because the single-use token IS the credential.
                        .requestMatchers(HttpMethod.POST,
                                Routes.Auth.LOGIN, Routes.Auth.STAFF_LOGIN,
                                Routes.Auth.STAFF_LOGIN_VERIFY, Routes.Auth.STAFF_LOGIN_ENROL,
                                Routes.Auth.STAFF_LOGIN_ENROL_CONFIRM,
                                Routes.Auth.REFRESH,
                                Routes.Auth.STAFF_INVITE_REDEEM).permitAll()

                        // Public catalogue reads. Single-segment matcher keeps deeper writes
                        // (e.g. /{id}/archive) authenticated.
                        .requestMatchers(HttpMethod.GET,
                                Routes.Properties.BASE, Routes.Properties.FEATURED,
                                Routes.Properties.ANY_SINGLE).permitAll()

                        // The public seller card — the only public route that reads the users
                        // table. Capped in OwnerProfileResponse, mobile masked in the service.
                        .requestMatchers(HttpMethod.GET, Routes.Owners.ANY_SINGLE).permitAll()

                        // Public reference catalogue: the pages a visitor sees before deciding
                        // whether to sign up at all. Why each is public: cross-cutting.md §8.4.
                        .requestMatchers(HttpMethod.GET,
                                Routes.Localities.BASE, Routes.Localities.ANY_SINGLE,
                                Routes.Societies.BASE, Routes.Societies.ANY_SINGLE, Routes.Societies.ANY_BRIEF,
                                Routes.Fees.BASE,

                                // Flags, geo, cities, prices and plans: what a logged-out visitor's
                                // render depends on, each section scoped so /admin/settings stays admin.
                                Routes.Bootstrap.BASE).permitAll()

                        .requestMatchers(HttpMethod.POST, Routes.Cities.WAITLIST).permitAll()

                        // The locality picker runs before sign-in; WriteRateLimitFilter budgets every POST.
                        .requestMatchers(HttpMethod.POST, Routes.Localities.RESOLVE).permitAll()

                        // "Tell me when this launches". POST-only and no read at all; rate-limited
                        // in TicketService.joinWaitlist and challenged in BotDefenceFilter.
                        .requestMatchers(HttpMethod.POST, Routes.ServiceWaitlist.BASE).permitAll()

                        .requestMatchers(HttpMethod.POST, Routes.DemandSignals.BASE).permitAll()
                        .requestMatchers(HttpMethod.POST, Routes.PageViews.BASE).permitAll()

                        .requestMatchers(HttpMethod.POST, Routes.HelpFeedback.BASE).permitAll()

                        // The flatmates feed. Exact-path and GET-only: the writes beside it are
                        // role- or author-scoped, and the interest route releases a phone number.
                        .requestMatchers(HttpMethod.GET,
                                Routes.Flatmates.FEED,
                                Routes.Flatmates.GROUP_BY_ID,
                                Routes.Flatmates.ROOM_BY_ID,
                                Routes.Flatmates.POST_BY_ID).permitAll()

                        // Public editorial + reviews. Per-method because the two review routes
                        // serve a public GET and an authenticated POST on the identical path.
                        .requestMatchers(HttpMethod.GET,
                                Routes.Content.FAQS,
                                Routes.Reviews.FOR_PROPERTY,
                                Routes.Reviews.FOR_ENTITY).permitAll()

                        // Token-scoped document share: the expiring token IS the credential,
                        // checked in DocumentRequestService.shared. GET-only and exact-path.
                        .requestMatchers(HttpMethod.GET, Routes.Documents.SHARED,
                                Routes.Documents.SHARED_URL).permitAll()

                        .requestMatchers(HttpMethod.POST,
                                Routes.Webhooks.CASHFREE_PAYMENT).permitAll()

                        .requestMatchers("/", "/favicon.ico",
 "/docs", "/docs/**", "/swagger-ui/**", "/webjars/**",
 "/openapi/**", "/actuator/health/**", "/actuator/info").permitAll()

// CORS preflight.
.requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(authEntryPoint)
                        .accessDeniedHandler(accessDeniedHandler))

                .addFilterBefore(new JwtAuthFilter(jwtService, roles),
                        UsernamePasswordAuthenticationFilter.class);
        if (rateLimitEnabled) {

            // After the JWT filter, so the counter keys on a user id. Off for the test run, where
            // ~700 MockMvc tests share one anonymous bucket; WriteRateLimitTest turns it back on.
            http.addFilterAfter(
                    new WriteRateLimitFilter(writeBudget, rateLimitWindow, proxyAware,
                            rateLimitStores, localityResolveBudget, propertyReadBudget),
                    JwtAuthFilter.class);
        }

        // Registered unconditionally, unlike the rate limiter: which BotDefence bean was wired
        // decides whether it acts, so the enabled and disabled paths cannot drift.
        http.addFilterAfter(new BotDefenceFilter(botDefence), JwtAuthFilter.class);

        // Last, so the two cheap in-memory defences refuse a flood without a database query; after
        // the JWT filter because it is answered by a caller's role.
        http.addFilterAfter(new MaintenanceModeFilter(platformSettings), BotDefenceFilter.class);

        originGate.ifPresent(gate -> http.addFilterBefore(gate, JwtAuthFilter.class));
        return http.build();
    }

    @Bean
    RoleHierarchy roleHierarchy() {
        return RoleHierarchyImpl.withRolePrefix("ROLE_")
                .role(Roles.ADMIN).implies(Roles.MANAGER)
                .role(Roles.MANAGER).implies(Roles.STAFF)
                .build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
