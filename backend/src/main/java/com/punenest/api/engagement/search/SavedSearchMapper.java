package com.punenest.api.engagement.search;

import java.util.Map;
import java.util.UUID;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.Named;
import org.mapstruct.ReportingPolicy;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/**
 * Entity→wire mapper for saved searches. The {@code filters} column is stored as a jsonb string
 * in the entity but rendered as a parsed JSON object on the wire, so the mapping includes a
 * deserialization step.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface SavedSearchMapper {

    /**
     * Reader for the stored {@code filters} document. A constant rather than an injected bean:
     * a MapStruct interface has no constructor to inject into, and reading an already-validated
     * jsonb column needs no application-specific Jackson configuration.
     */
    ObjectMapper FILTERS_JSON = JsonMapper.builder().build();

    /**
     * {@code matchCount} is ignored here on purpose: it is not a column, it is a count of other
     * rows, and this mapper sees one entity. {@link SavedSearchService#list} fills it in. The
     * ignore is spelled out rather than left implicit because {@code unmappedTargetPolicy = ERROR}
     * turns every unmapped field into a compile failure — which is exactly what should happen to a
     * field that genuinely was forgotten.
     */
    @Mapping(target = "filters", source = "filters", qualifiedByName = "jsonStringToObject")
    @Mapping(target = "criteria", source = "criteria", qualifiedByName = "jsonStringToNullableObject")
    @Mapping(target = "matchCount", ignore = true)
    SavedSearchResponse toResponse(SavedSearch entity);

    default String map(UUID value) {
        return value == null ? null : value.toString();
    }

    @Named("jsonStringToObject")
    default Object jsonStringToObject(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return FILTERS_JSON.readValue(json, Object.class);
        } catch (RuntimeException malformed) {
            return Map.of();
        }
    }

    /**
     * As above, but absent stays absent. {@code filters} defaults to an empty object because every
     * listings alert has some; {@code criteria} is genuinely null on a listings alert, and an empty
     * object there would read as "a flatmates alert that matches everything".
     */
    @Named("jsonStringToNullableObject")
    default Object jsonStringToNullableObject(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return FILTERS_JSON.readValue(json, Object.class);
        } catch (RuntimeException malformed) {
            return null;
        }
    }
}
