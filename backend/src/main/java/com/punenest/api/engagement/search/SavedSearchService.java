package com.punenest.api.engagement.search;

import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.catalog.property.PropertyStatus;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * CRUD for saved searches — a user's persisted queries with alert preferences.
 *
 * <p>The collection is structurally bounded (one user's own actions) and returned as a bare array.
 *
 * <p><strong>D8.8 — {@code newCount} is served as stored (currently always 0).</strong> Computing
 * it truly would require a {@code last_viewed_at} column that does not exist, plus re-running
 * every saved search on every list read — an N+1 of full-text searches on a user-facing read
 * endpoint. The frontend mock also stores {@code newCount: 0}, so parity holds. This is a
 * deliberate, revisitable decision: when a scheduler exists that can write meaningful counts,
 * and a {@code last_viewed_at} column is added, this becomes a single-read from the row.
 */
@Service
public class SavedSearchService {

    private static final int SWEEP_BATCH_SIZE = 200;

    private final SavedSearchRepository repo;
    private final PropertyRepository properties;
    private final SavedSearchMapper mapper;
    private final ObjectMapper objectMapper;

    public SavedSearchService(SavedSearchRepository repo, PropertyRepository properties,
            SavedSearchMapper mapper, ObjectMapper objectMapper) {
        this.repo = repo;
        this.properties = properties;
        this.mapper = mapper;
        this.objectMapper = objectMapper;
    }

    /** All of the caller's saved searches, newest first. */
    @Transactional(readOnly = true)
    public List<SavedSearchResponse> list(UUID userId) {
        return repo.findByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(mapper::toResponse)
                .toList();
    }

    /**
     * The largest {@code filters} blob accepted, in serialized characters.
     *
     * <p>{@code filters} is typed {@code Object} because the contract declares a free-form object,
     * so Bean Validation has nothing to hang a {@code @Size} on and the column is unbounded
     * {@code jsonb}. Without a bound, an authenticated caller can store a multi-megabyte document
     * per saved search, unbounded in count — cheap to send, permanent to keep, and re-serialized
     * into the response on every list read. 8 KB is far beyond any genuine facet set (the frontend
     * sends a handful of scalar fields) while still being obviously not a payload.
     */
    private static final int MAX_FILTERS_CHARS = 8192;

    /**
     * The most saved searches one user may keep.
     *
     * <p>{@link #MAX_FILTERS_CHARS} bounds the size of each blob; this bounds the count. Without it
     * an authenticated caller can create rows without limit — each one cheap to send, permanent to
     * keep, and re-run by any future alert scheduler on a cadence, so an unbounded count is an
     * unbounded standing workload, not just unbounded storage. Ten is far beyond any genuine set of
     * standing searches (the UI renders them as a short list) while still being unmistakably a
     * person's alerts rather than a script's. Enforced as a {@code 409} — the request is well-formed
     * and conflicts only with the caller's current state, which they resolve by deleting one.
     */
    private static final int MAX_SAVED_SEARCHES = 10;

    /** Create a new saved search. Returns 201 with the created resource. */
    @Transactional
    public SavedSearchResponse create(UUID userId, SavedSearchCreateRequest request) {
        if (repo.countByUserId(userId) >= MAX_SAVED_SEARCHES) {
            throw new ConflictException("You can keep at most " + MAX_SAVED_SEARCHES
                    + " saved searches. Delete one to add another.");
        }
        String kind = request.kind() == null || request.kind().isBlank()
                ? "listings" : request.kind().strip();
        if (!"listings".equals(kind) && !"flatmates".equals(kind)) {
            throw new BadRequestException(
                    "Unknown alert kind: '" + kind + "'. Expected listings or flatmates.");
        }

        // Which payload each kind requires is asserted on the request record, so a missing one is
        // the contract's 422 with the field named rather than a 400 from here.
        SavedSearch entity = "flatmates".equals(kind)
                ? SavedSearch.forFlatmates(userId, serializeFilters(request.criteria()), label(request))
                : new SavedSearch(userId, request.query());

        entity.setName(request.name());
        if (request.filters() != null) {
            entity.setFilters(serializeFilters(request.filters()));
        }
        if (request.alertFrequency() != null) {
            entity.setAlertFrequency(request.alertFrequency());
        }
        if (request.channel() != null) {
            entity.setChannel(request.channel());
        }
        return mapper.toResponse(repo.saveAndFlush(entity));
    }

    /** The card's summary line. The user-given name wins; otherwise there is nothing to invent. */
    private static String label(SavedSearchCreateRequest request) {
        return request.name() == null || request.name().isBlank() ? null : request.name().strip();
    }

    /**
     * Update the alert preferences on a saved search. User-scoped, like {@link #delete}.
     *
     * <p><strong>Why this exists.</strong> Saved-search alerts were a complete consumer feature with
     * no update path in either the controller or the contract: a user could create an alert and
     * delete it, but the toggle the UI renders had nowhere to send its change. The frontend's mock
     * has carried a {@code toggleSearchAlert} operation since before the backend did, so this closed
     * the gap in the direction that keeps the mock honest rather than by deleting the gesture.
     *
     * <p>Null means "leave unchanged", so turning alerts off is {@code alertFrequency: "off"} — a
     * value in the vocabulary — rather than a null the record could not distinguish from absence
     * anyway (tech-debt D46).
     *
     * @throws NotFoundException if the id does not belong to the caller
     */
    @Transactional
    public SavedSearchResponse update(UUID userId, UUID searchId, SavedSearchUpdateRequest request) {
        SavedSearch entity = repo.findByIdAndUserId(searchId, userId)
                .orElseThrow(() -> NotFoundException.of("Saved search"));
        if (request.alertFrequency() != null) {
            entity.setAlertFrequency(request.alertFrequency());
        }
        if (request.channel() != null) {
            entity.setChannel(request.channel());
        }
        return mapper.toResponse(repo.saveAndFlush(entity));
    }

    /**
     * Delete a saved search. User-scoped: acting on another user's id returns 404, never 403.
     *
     * @throws NotFoundException if the id does not belong to the caller
     */
    @Transactional
    public void delete(UUID userId, UUID searchId) {
        SavedSearch entity = repo.findByIdAndUserId(searchId, userId)
                .orElseThrow(() -> NotFoundException.of("Saved search"));
        repo.delete(entity);
    }

    /**
     * Serialize the free-form filter object, rejecting anything oversized.
     *
     * @throws BadRequestException if the serialized form exceeds {@link #MAX_FILTERS_CHARS}
     */
    private String serializeFilters(Object filters) {
        String json;
        try {
            json = objectMapper.writeValueAsString(filters);
        } catch (RuntimeException unserializable) {
            // Jackson 3 throws unchecked; an unserializable body degrades to an empty filter set.
            return "{}";
        }
        if (json.length() > MAX_FILTERS_CHARS) {
            throw new BadRequestException(
                    "filters is too large (max " + MAX_FILTERS_CHARS + " characters)");
        }
        return json;
    }

    /**
     * D7: periodic recomputation of saved-search {@code new_count}.
     *
     * <p>Counts only properties that satisfy each alert's core filters and were created since the
     * alert row's previous update timestamp. This keeps the count incremental without adding schema
     * (no {@code last_viewed_at} yet) and is deterministic under one scheduler tick.
     */
    @Transactional
    public long recomputeNewCounts(Instant now) {
        long updated = 0L;
        int page = 0;
        while (true) {
            List<SavedSearch> chunk = repo.findAllByOrderByIdAsc(PageRequest.of(page, SWEEP_BATCH_SIZE));
            if (chunk.isEmpty()) {
                return updated;
            }
            List<SavedSearch> changed = new ArrayList<>();
            for (SavedSearch search : chunk) {
                Instant baseline = search.getUpdatedAt() == null ? search.getCreatedAt() : search.getUpdatedAt();
                int count = countMatchingSince(search, baseline);
                if (search.getNewCount() != count) {
                    search.setNewCount(count);
                    changed.add(search);
                    updated++;
                }
            }
            if (!changed.isEmpty()) {
                repo.saveAll(changed);
            }
            page++;
        }
    }

    private int countMatchingSince(SavedSearch search, Instant baseline) {
        if (!"listings".equals(search.getKind())) {
            return 0;
        }
        String deal = textOrNull(filterText(search, "deal"));
        if (deal == null || baseline == null) {
            return 0;
        }
        List<String> localities = lowerList(search, "localities");
        List<Integer> bhk = intList(search, "bhk");

        List<String> localitiesParam = localities.isEmpty() ? List.of("__none__") : localities;
        List<Integer> bhkParam = bhk.isEmpty() ? List.of(Integer.MIN_VALUE) : bhk;

        long count = properties.countVisibleCreatedAfterWithFilters(
                PropertyStatus.APPROVED,
                baseline,
                deal.toLowerCase(Locale.ROOT),
                localities.isEmpty(),
                localitiesParam,
                bhk.isEmpty(),
                bhkParam);
        return (int) count;
    }

    @SuppressWarnings("unchecked")
    private String filterText(SavedSearch search, String key) {
        Object parsed = mapper.jsonStringToObject(search.getFilters());
        if (!(parsed instanceof Map<?, ?> map)) {
            return null;
        }
        Object raw = map.get(key);
        return raw == null ? null : String.valueOf(raw);
    }

    @SuppressWarnings("unchecked")
    private List<String> lowerList(SavedSearch search, String key) {
        Object parsed = mapper.jsonStringToObject(search.getFilters());
        if (!(parsed instanceof Map<?, ?> map)) {
            return List.of();
        }
        Object raw = map.get(key);
        if (!(raw instanceof List<?> list)) {
            return List.of();
        }
        return list.stream()
                .map(String::valueOf)
                .map(v -> v.toLowerCase(Locale.ROOT))
                .toList();
    }

    @SuppressWarnings("unchecked")
    private List<Integer> intList(SavedSearch search, String key) {
        Object parsed = mapper.jsonStringToObject(search.getFilters());
        if (!(parsed instanceof Map<?, ?> map)) {
            return List.of();
        }
        Object raw = map.get(key);
        if (!(raw instanceof List<?> list)) {
            return List.of();
        }
        return list.stream()
                .map(this::toInt)
                .filter(v -> v != null)
                .toList();
    }

    private Integer toInt(Object value) {
        if (value instanceof Number n) {
            return n.intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (RuntimeException bad) {
            return null;
        }
    }

    private static String textOrNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
