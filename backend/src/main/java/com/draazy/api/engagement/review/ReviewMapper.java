package com.draazy.api.engagement.review;

import java.util.Collections;
import java.util.Map;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.Named;
import org.mapstruct.ReportingPolicy;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

/** The author name is passed in, resolved once per page rather than looked up per row. */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface ReviewMapper {

    /** A constant because a MapStruct interface has no constructor to inject into, same as
     * {@code SavedSearchMapper.FILTERS_JSON}. */
    ObjectMapper CATEGORIES_JSON = JsonMapper.builder().build();

    TypeReference<Map<String, Integer>> CATEGORY_MAP = new TypeReference<>() {
    };

    @Mapping(target = "id", source = "entity.id")
    @Mapping(target = "author", source = "authorName")
    @Mapping(target = "categories", source = "entity.categories", qualifiedByName = "jsonToCategories")
    ReviewResponse toResponse(Review entity, String authorName);

    /** Falls back to empty on malformed JSON so one corrupt row costs its sub-ratings, not a 500 on the
     * whole listing page. */
    @Named("jsonToCategories")
    default Map<String, Integer> jsonToCategories(String json) {
        if (json == null || json.isBlank()) {
            return Collections.emptyMap();
        }
        try {
            Map<String, Integer> parsed = CATEGORIES_JSON.readValue(json, CATEGORY_MAP);
            return parsed == null ? Collections.emptyMap() : parsed;
        } catch (RuntimeException malformed) {
            return Collections.emptyMap();
        }
    }

    default String map(java.util.UUID value) {
        return value == null ? null : value.toString();
    }
}
