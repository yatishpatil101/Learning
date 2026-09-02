package com.draazy.api.common.config;

import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * CORS for the React frontend. Origins are env-driven ({@code draazy.web.cors.allowed-origins},
 * comma-separated) so dev (localhost:5173) and prod differ by config, not code. Spring Security's
 * {@code http.cors()} picks up this {@link CorsConfigurationSource} bean automatically.
 */
@Configuration
public class CorsConfig {

    /**
     * The allow-list, as a placeholder expression rather than a raw property name.
     *
     * <p>Shared because a second component has to judge the same set:
     * {@link com.draazy.api.identity.auth.RefreshOriginGate} decides which origins may rotate a
     * refresh token, and "may this origin talk to us with credentials" is the same question this
     * bean answers. Two independently-written {@code @Value} strings would be two answers to it, and
     * they would drift in the direction that is hardest to notice — the gate silently permitting an
     * origin CORS refuses, or refusing one CORS permits, on a deployment where nobody re-read both
     * files. Sharing the whole expression rather than just the key also shares the <em>default</em>,
     * which is where that drift would actually have happened: the key is spelled once in config, the
     * default is spelled in code.
     *
     * <p>A compile-time constant, so it is legal in an annotation.
     */
    public static final String ALLOWED_ORIGINS = "${draazy.web.cors.allowed-origins:http://localhost:5173}";

    @Bean
    CorsConfigurationSource corsConfigurationSource(
            @Value(ALLOWED_ORIGINS) List<String> allowedOrigins) {
        CorsConfiguration cfg = new CorsConfiguration();
        cfg.setAllowedOrigins(allowedOrigins);
        cfg.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cfg.setAllowedHeaders(List.of("*"));
        cfg.setAllowCredentials(true);
        cfg.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cfg);
        return source;
    }
}
