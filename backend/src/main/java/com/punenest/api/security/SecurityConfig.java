package com.punenest.api.security;

import com.punenest.api.common.web.Routes;
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
 * The one stateless resource-server chain every request flows through. No sessions, no CSRF (there
 * are no cookies — auth is a Bearer token); the JWT filter runs before the username/password filter
 * slot; failures render the contract error envelope via {@link RestAuthEntryPoint} (401) and
 * {@link RestAccessDeniedHandler} (403).
 *
 * <p>Default posture is deny (authenticated); the contract's {@code security: []} public operations
 * — the two logins, refresh, and the docs/health infra — are the only permitted-anonymous routes.
 * Public catalog GETs are opened per-slice as those controllers land.
 *
 * <p>Application routes are referenced through {@link Routes} rather than string literals: this file
 * and the controllers must agree on every path, and a silent typo here is a security defect (an
 * endpoint left guarded that should be public, or a matcher too broad). The docs/actuator paths below
 * stay literal — they belong to the framework and have no controller to drift from.
 *
 * <p>Three filters are added, in the order they must run: {@link JwtAuthFilter} resolves the bearer
 * token, then {@link WriteRateLimitFilter} counts the request against whoever that turned out to be.
 * The reverse order would leave every authenticated caller sharing an address-keyed bucket. Last,
 * {@link BotDefenceFilter} challenges the small set of writes anyone on the internet may post to —
 * last of the three because it is the only one that can make a network call, so a flood should have
 * been refused by the counter before it gets here.
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
            @Value("${punenest.security.rate-limit.enabled:true}") boolean rateLimitEnabled,
            @Value("${punenest.security.rate-limit.writes-per-window:120}") int writeBudget,
            @Value("${punenest.security.rate-limit.window-seconds:60}") long windowSeconds,
            @Value("${punenest.security.trusted-proxies:none}") String trustedProxies) {
        this.jwtService = jwtService;
        this.authEntryPoint = authEntryPoint;
        this.accessDeniedHandler = accessDeniedHandler;
        // Exactly one BotDefence bean always exists: the Turnstile one when the flag is on, the
        // no-op otherwise (matchIfMissing). Injected rather than resolved on demand so a
        // misconfiguration that produced none — or both — fails at startup rather than on the first
        // anonymous form submission in production.
        this.botDefence = botDefence;
        // Where the counters live (D158): per-instance memory by default, Redis when configured.
        // Resolved once at startup so the filter never has to ask.
        this.rateLimitStores = rateLimitStores;
        this.rateLimitEnabled = rateLimitEnabled;
        this.writeBudget = writeBudget;
        this.rateLimitWindow = Duration.ofSeconds(windowSeconds);
        // Not used to resolve addresses — TrustedProxyConfig does that — only so the filter knows
        // whether a forwarded header arriving at runtime is expected or is evidence of a
        // misconfiguration it should complain about.
        this.proxyAware = !TrustedProxyConfig.NO_PROXY.equalsIgnoreCase(trustedProxies.trim());
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, RoleSource roles) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                // Spring Security's own defaults already send nosniff, DENY and no-store. The one
                // it does not send is Referrer-Policy, and this API has a route that needs it:
                // GET /documents/shared carries a bearer credential in its query string (D42), so
                // any URL of ours a browser has in hand is a secret it must not forward. `no-referrer`
                // rather than the frontend's `strict-origin-when-cross-origin`, because that policy
                // still sends the full URL — path and query — on same-origin requests, and an API
                // has no navigation for a Referer to be useful to. The static frontend sets its own,
                // looser policy in netlify.toml; the two are independent hosts and independent
                // decisions.
                .headers(headers -> headers.referrerPolicy(referrer ->
                        referrer.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER)))
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // Public auth entry points (contract: security: []).
                        .requestMatchers(HttpMethod.POST,
                                Routes.Auth.LOGIN, Routes.Auth.STAFF_LOGIN,
                                Routes.Auth.REFRESH,
                                // D206: a newly minted colleague setting their own password. It is
                                // unauthenticated for the same reason /auth/refresh is — the caller
                                // holds no session, and the single-use token they present IS the
                                // credential, verified in StaffInviteService.
                                Routes.Auth.STAFF_INVITE_REDEEM).permitAll()
                        // Public catalogue reads (contract: security: []): search, featured, detail
                        // and the trust headline. Single-segment matcher keeps deeper writes
                        // (e.g. /{id}/archive) authenticated. TRUST_STATS is named explicitly even
                        // though ANY_SINGLE would already match it: relying on that would make a
                        // public endpoint public by accident of path depth rather than by decision,
                        // and the next reader would have no way to tell which it was.
                        .requestMatchers(HttpMethod.GET,
                                Routes.Properties.BASE, Routes.Properties.FEATURED,
                                Routes.Properties.TRUST_STATS,
                                Routes.Properties.ANY_SINGLE).permitAll()
                        // The rooms a flat has been split into (contract: security: []). Needs its
                        // own line precisely because ANY_SINGLE is single-segment: a two-segment
                        // path does not inherit the public read above, which is the property that
                        // keeps /{id}/archive and /{id}/split authenticated. GET-only — POST and
                        // DELETE on /{id}/split remain owner-scoped. The payload is the anonymous
                        // room view and carries no host number; see FlatmateSupplyService.roomsInFlat.
                        .requestMatchers(HttpMethod.GET, Routes.Properties.ROOMS).permitAll()
                        // The public seller card (contract: security: []). Its own line rather than
                        // a member of the catalogue block above, because it is the only public route
                        // that reads the users table — and a reviewer scanning this file for what a
                        // stranger can learn about a person should find it under its own heading
                        // rather than folded in among the property reads. The response is capped in
                        // OwnerProfileResponse and the mobile is masked before it leaves the service.
                        .requestMatchers(HttpMethod.GET, Routes.Owners.ANY_SINGLE).permitAll()
                        // Public reference catalogue (contract: security: []): the pages a visitor
                        // sees before deciding whether to sign up at all. Same constants the
                        // controllers map, so a route rename cannot leave this matcher behind.
                        .requestMatchers(HttpMethod.GET,
                                Routes.Cities.BASE,
                                Routes.Localities.BASE, Routes.Localities.ANY_SINGLE,
                                Routes.Societies.BASE, Routes.Societies.ANY_SINGLE,
                                Routes.Reels.BASE,
                                Routes.Fees.BASE,
                                // Which features the client should render (contract: security: []).
                                // Necessarily public: these toggles gate what a logged-out visitor
                                // sees — the map view, the EMI calculator, the referral offer,
                                // whether signups are open — so an admin-only reader cannot be the
                                // client's source for them. Scoped to the `flags` block alone; the
                                // rest of /admin/settings (fees, permissions, adminFlags) stays
                                // admin-only, which is why this is a separate route rather than a
                                // public projection of that one.
                                Routes.Flags.BASE,
                                // The price lists (contract: security: []). Same reason as /fees:
                                // what a plan, a boost or a service costs is a reason to sign up,
                                // not something to hide behind signing up. GET-only — buying any
                                // of them is authenticated and caller-scoped.
                                Routes.Plans.BASE,
                                Routes.Boosts.PACKS,
                                Routes.ServiceCatalog.BASE).permitAll()
                        // The catalogue's only public write: joining a waitlist for a city we do
                        // not serve. Necessarily unauthenticated — the people it exists for are
                        // not users and may never become any.
                        .requestMatchers(HttpMethod.POST, Routes.Cities.WAITLIST).permitAll()
                        // The B2B pipeline's front door. Also necessarily unauthenticated: the
                        // person filling it in is a building secretary who has never signed in, and
                        // asking a 400-flat society to create an account before it can say hello
                        // defeats the entire purpose of the form. POST-only — reading the leads back
                        // is staff/admin, because the list is a name and a mobile number per row.
                        // Rate-limited per mobile in SocietyLeadService, since there is no session
                        // to hang a limit on.
                        .requestMatchers(HttpMethod.POST, Routes.SocietyLeads.BASE).permitAll()
                        // "Tell me when this launches" (D4). Unauthenticated for the same reason as
                        // the two above: the person filling it in is deciding whether this company
                        // is worth an account, and a service that has not launched is a poor moment
                        // to insist on one. POST-only and there is no read — the rows land on the ops
                        // board and are read through the guarded /tickets routes, so nothing here
                        // hands out a page of unverified phone numbers. Rate-limited per mobile in
                        // TicketService.joinWaitlist, and challenged in BotDefenceFilter.
                        .requestMatchers(HttpMethod.POST, Routes.ServiceWaitlist.BASE).permitAll()
                        // The flatmates feed (contract: security: []). A person deciding whether
                        // PuneNest is worth an account needs to see whether anyone is actually
                        // posting. Exact-path and GET-only: POST /flatmates/posts is authenticated
                        // and role-gated, PATCH/DELETE are author-scoped, and the interest route
                        // below it releases a phone number -- so a path-prefix matcher here would
                        // be a serious mistake. Nothing on the public payload carries contact;
                        // see FlatmateSeekerPostDto.
                        .requestMatchers(HttpMethod.GET, Routes.Flatmates.POSTS).permitAll()
                        // The rest of the public flatmates discovery surface, on the same terms:
                        // GET-only and exact-path, one matcher per route. Listed individually
                        // rather than as /flatmates/** because every write in this family sits on
                        // a path that differs from its read only by method or one suffix, and
                        // several of them release a phone number.
                        .requestMatchers(HttpMethod.GET,
                                Routes.Flatmates.FEED,
                                Routes.Flatmates.ROOMS,
                                Routes.Flatmates.GROUPS).permitAll()
                        // Public editorial + reviews (contract: security: []). GET-only, and the
                        // matchers are per-method for a reason: the two review routes serve a public
                        // GET and an authenticated POST on the identical path, so a path-only
                        // permitAll here would silently open the write side too.
                        .requestMatchers(HttpMethod.GET,
                                Routes.Content.ANNOUNCEMENTS, Routes.Content.SERVICES,
                                Routes.Content.FAQS, Routes.Content.BANNERS,
                                Routes.Reviews.FOR_PROPERTY, Routes.Reviews.SUMMARY_FOR_PROPERTY,
                                Routes.Reviews.FOR_ENTITY,
                                Routes.Reviews.SUMMARY_FOR_ENTITY).permitAll()
                        // Token-scoped document share (contract: security: []). Anonymous because
                        // the link is forwarded to a lawyer or a banker with no PuneNest account;
                        // the unguessable, expiring share token IS the credential and is checked
                        // in DocumentRequestService.shared. GET-only and exact-path, so no other
                        // /documents route is opened.
                        .requestMatchers(HttpMethod.GET, Routes.Documents.SHARED).permitAll()
                        // Server-to-server callback (contract: security: []). It carries no user
                        // session; authenticity is an HMAC over the raw body, verified in the handler.
                        .requestMatchers(HttpMethod.POST,
                                Routes.Webhooks.CASHFREE_DIGILOCKER,
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
                // The role source is a bean-method parameter rather than a constructor field: it is
                // backed by a JPA repository, and a @Configuration class that holds one forces the
                // persistence infrastructure to initialise ahead of the bean post-processors that
                // are meant to decorate it. Resolved here instead, at chain-assembly time, where it
                // is an ordinary singleton lookup.
                .addFilterBefore(new JwtAuthFilter(jwtService, roles),
                        UsernamePasswordAuthenticationFilter.class);
        if (rateLimitEnabled) {
            // After the JWT filter, so the counter keys on a user id. Switched off for the test run
            // (see src/test/resources/application.properties): ~700 MockMvc tests all present as one
            // anonymous caller from 127.0.0.1, so a shared bucket would fail whichever test happened
            // to run 121st. The behaviour is proved by WriteRateLimitTest, which turns it back on
            // with a budget small enough to reach deliberately.
            http.addFilterAfter(
                    new WriteRateLimitFilter(writeBudget, rateLimitWindow, proxyAware,
                            rateLimitStores),
                    JwtAuthFilter.class);
        }
        // Registered unconditionally, unlike the rate limiter above: whether it does anything is
        // decided by which BotDefence bean was wired, not by whether the filter is in the chain. One
        // shape in every environment means the enabled and disabled paths cannot drift, and with the
        // no-op the per-request cost is a single boolean read.
        http.addFilterAfter(new BotDefenceFilter(botDefence), JwtAuthFilter.class);
        return http.build();
    }

    /** BCrypt for the internal staff/admin password path; buyers/owners stay passwordless (OTP). */
    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
