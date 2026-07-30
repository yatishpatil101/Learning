package com.punenest.api.common.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Serves API documentation for the PuneNest modular monolith.
 *
 * <p>The hand-authored OpenAPI 3.1 contract lives at
 * {@code src/main/resources/static/openapi/punenest-api.yaml} and is served as a
 * static asset at {@code /openapi/punenest-api.yaml}. Swagger UI (bundled via the
 * {@code org.webjars:swagger-ui} webjar) renders it from {@code /docs/}. Redirects
 * from {@code /} and {@code /swagger-ui} keep discovery simple.
 */
@Configuration
public class OpenApiDocsConfig implements WebMvcConfigurer {

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addRedirectViewController("/", "/docs/index.html");
        registry.addRedirectViewController("/docs", "/docs/index.html");
        registry.addRedirectViewController("/swagger-ui", "/docs/index.html");
        registry.addRedirectViewController("/swagger-ui.html", "/docs/index.html");
    }
}
