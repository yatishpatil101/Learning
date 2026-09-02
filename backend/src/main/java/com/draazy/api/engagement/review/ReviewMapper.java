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

/**
 * Entity→wire mapper for reviews.
 *
 * <p>Two things cannot be derived from the entity alone, and both are passed in rather than looked
 * up here: the author's display name (a join the service does once per page, not once per row) and
 * nothing else. {@code categories} is stored as a jsonb string and rendered as a parsed object, so
 * it needs the same deserialisation step as {@code saved_searches.filters}.
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface ReviewMapper {

    /**
     * Reader for the stored {@code categories} document. A constant for the same reason as
     * {@code SavedSearchMapper.FILTERS_JSON}: a MapStruct interface has no constructor to inject
     * into, and re-reading an already-validated column needs no application-specific configuration.
     */
    ObjectMapper CATEGORIES_JSON = JsonMapper.builder().build();

    TypeReference<Map<String, Integer>> CATEGORY_MAP = new TypeReference<>() {
    };

    /**
     * @param entity     the stored review
     * @param authorName the reviewer's display name, resolved in bulk by the service
     */
    @Mapping(target = "id", source = "entity.id")
    @Mapping(target = "author", source = "authorName")
    @Mapping(target = "categories", source = "entity.categories", qualifiedByName = "jsonToCategories")
    @Mapping(target = "status", ignore = true)
    ReviewResponse toResponse(Review entity, String authorName);

    /**
     * The same review, plus its moderation state.
     *
     * <p><strong>Why a second method rather than a parameter.</strong> {@code status} is meaningful
     * on exactly one read — {@code GET /admin/reviews}. Every other path filters
     * {@code status = 'published'} before it maps, so the field would be a constant there, and a
     * constant is worse than an absence: it reads like something a client could branch on.
     *
     * <p>The alternative was a boolean argument on {@link #toResponse}. That would have put the
     * decision at each of the five call sites and made "did this path mean to publish the
     * moderation state?" a question you answer by reading arguments. Here the public method
     * <em>cannot</em> emit it — {@code ignore = true} is checked by the compiler-generated
     * implementation — and the moderation method is named for the only place it belongs.
     */
    @Mapping(target = "id", source = "entity.id")
    @Mapping(target = "author", source = "authorName")
    @Mapping(target = "categories", source = "entity.categories", qualifiedByName = "jsonToCategories")
    @Mapping(target = "status", source = "entity.status")
    ReviewResponse toModerationResponse(Review entity, String authorName);

    /**
     * Parse the stored category map.
     *
     * <p>Falls back to empty on malformed JSON rather than throwing. The column is written only
     * through {@link ReviewCategories#validated}, so malformed content should be impossible; if it
     * ever happens, one corrupt row should cost that row's sub-ratings, not 500 the whole listing
     * page for every visitor.
     */
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
