package com.punenest.api.security;

import com.punenest.api.common.web.Routes;
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
 */
@Configuration
@EnableMethodSecurity
@EnableConfigurationProperties(JwtProperties.class)
public class SecurityConfig {

    private final JwtService jwtService;
    private final RestAuthEntryPoint authEntryPoint;
    private final RestAccessDeniedHandler accessDeniedHandler;

    public SecurityConfig(JwtService jwtService, RestAuthEntryPoint authEntryPoint,
            RestAccessDeniedHandler accessDeniedHandler) {
        this.jwtService = jwtService;
        this.authEntryPoint = authEntryPoint;
        this.accessDeniedHandler = accessDeniedHandler;
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // Public auth entry points (contract: security: []).
                        .requestMatchers(HttpMethod.POST,
                                Routes.Auth.LOGIN, Routes.Auth.STAFF_LOGIN,
                                Routes.Auth.REFRESH).permitAll()
                        // Public catalogue reads (contract: security: []): search, featured, detail.
                        // Single-segment matcher keeps deeper writes (e.g. /{id}/archive) authenticated.
                        .requestMatchers(HttpMethod.GET,
                                Routes.Properties.BASE, Routes.Properties.FEATURED,
                                Routes.Properties.ANY_SINGLE).permitAll()
                        // The rooms a flat has been split into (contract: security: []). Needs its
                        // own line precisely because ANY_SINGLE is single-segment: a two-segment
                        // path does not inherit the public read above, which is the property that
                        // keeps /{id}/archive and /{id}/split authenticated. GET-only — POST and
                        // DELETE on /{id}/split remain owner-scoped. The payload is the anonymous
                        // room view and carries no host number; see FlatmateSupplyService.roomsInFlat.
                        .requestMatchers(HttpMethod.GET, Routes.Properties.ROOMS).permitAll()
                        // Public reference catalogue (contract: security: []): the pages a visitor
                        // sees before deciding whether to sign up at all. Same constants the
                        // controllers map, so a route rename cannot leave this matcher behind.
                        .requestMatchers(HttpMethod.GET,
                                Routes.Cities.BASE,
                                Routes.Localities.BASE, Routes.Localities.ANY_SINGLE,
                                Routes.Societies.BASE, Routes.Societies.ANY_SINGLE,
                                Routes.Reels.BASE,
                                Routes.Fees.BASE,
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
                                Routes.Reviews.FOR_PROPERTY, Routes.Reviews.FOR_ENTITY).permitAll()
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
                .addFilterBefore(new JwtAuthFilter(jwtService),
                        UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    /** BCrypt for the internal staff/admin password path; buyers/owners stay passwordless (OTP). */
    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
