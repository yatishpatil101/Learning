package com.draazy.api.common.config;

import com.draazy.api.common.web.BuildStampFilter;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
public class CorsConfig {

    /** Shared verbatim (expression, so the default is shared too) with {@code RefreshOriginGate} — both
     * answer "may this origin talk to us with credentials", and two copies would drift silently. */
    public static final String ALLOWED_ORIGINS = "${draazy.web.cors.allowed-origins:http://localhost:5173}";

    @Bean
    CorsConfigurationSource corsConfigurationSource(
            @Value(ALLOWED_ORIGINS) List<String> allowedOrigins) {
        CorsConfiguration cfg = new CorsConfiguration();
        cfg.setAllowedOrigins(allowedOrigins);
        cfg.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cfg.setAllowedHeaders(List.of("*"));
        // Headers absent here are stripped by the browser silently — get() returns null, no error.
        // A wildcard is not an option: it is ignored outright when allowCredentials is true.
        cfg.setExposedHeaders(List.of(BuildStampFilter.BUILD_HEADER));
        cfg.setAllowCredentials(true);
        cfg.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", cfg);
        return source;
    }
}
