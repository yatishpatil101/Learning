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
                        // Server-to-server callback (contract: security: []). It carries no user
                        // session; authenticity is an HMAC over the raw body, verified in the handler.
                        .requestMatchers(HttpMethod.POST,
                                Routes.Webhooks.CASHFREE_DIGILOCKER).permitAll()
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
