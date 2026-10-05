package com.draazy.api.common.config;

import org.springframework.boot.jackson.autoconfigure.JsonFactoryBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.core.StreamReadConstraints;

@Configuration
public class JsonBodyLimitsConfig {

    public static final int MAX_JSON_STRING_CHARS = 5_000_000;
    public static final long MAX_JSON_DOCUMENT_CHARS = 6_000_000L;

    @Bean
    JsonFactoryBuilderCustomizer jsonBodyReadConstraints() {
        StreamReadConstraints constraints = StreamReadConstraints.builder()
                .maxStringLength(MAX_JSON_STRING_CHARS)
                .maxDocumentLength(MAX_JSON_DOCUMENT_CHARS)
                .build();
        return builder -> builder.streamReadConstraints(constraints);
    }
}
