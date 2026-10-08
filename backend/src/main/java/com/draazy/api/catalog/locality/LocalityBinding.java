package com.draazy.api.catalog.locality;

import com.draazy.api.common.error.ValidationException;
import java.util.Collection;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/** The one rule for tying a record to a locality: a live row the user picked, never typed text. */
@Component
public class LocalityBinding {

    public record Bound(String slug, String name) {
    }

    private final LocalityRepository localities;

    public LocalityBinding(LocalityRepository localities) {
        this.localities = localities;
    }

    /** A new record: the slug must be live, or the name must match exactly one live locality. */
    @Transactional(readOnly = true)
    public Bound require(String slug, String name) {
        return require(slug, name, null);
    }

    /** An edit may keep {@code existingSlug} even when that locality is not live. */
    @Transactional(readOnly = true)
    public Bound require(String slug, String name, String existingSlug) {
        if (StringUtils.hasText(slug)) {
            String key = slug.trim();
            return localities.findById(key)
                    .filter(l -> !l.isArchived() || key.equals(existingSlug))
                    .map(l -> new Bound(l.getSlug(), l.getName()))
                    .orElseThrow(LocalityBinding::refusal);
        }
        Locality l = live(name);
        return new Bound(l.getSlug(), l.getName());
    }

    /** A flatmate record stores a name: the picked slug's name when given, else the typed name's. */
    @Transactional(readOnly = true)
    public String canonicalName(String slug, String name) {
        return canonicalName(slug, name, List.of());
    }

    /** As above; the slug of a non-live row passes when its name is one the record already stores. */
    @Transactional(readOnly = true)
    public String canonicalName(String slug, String name, Collection<String> stored) {
        if (!StringUtils.hasText(slug)) {
            return canonicalNames(List.of(name), stored).getFirst();
        }
        return localities.findById(slug.trim())
                .filter(l -> !l.isArchived() || stored.contains(l.getName()))
                .map(Locality::getName)
                .orElseThrow(LocalityBinding::refusal);
    }

    /** Names in a list, each canonicalised; duplicates collapse. */
    @Transactional(readOnly = true)
    public List<String> canonicalNames(List<String> names) {
        return canonicalNames(names, List.of());
    }

    /** As {@link #canonicalNames(List)}, but a name the record already stores stays even when its locality is not live. */
    @Transactional(readOnly = true)
    public List<String> canonicalNames(List<String> names, Collection<String> stored) {
        Collection<String> keep = stored == null ? List.of() : stored;
        return names.stream().map(n -> keep.contains(n) ? n : live(n).getName()).distinct().toList();
    }

    /** Like {@link #require(String, String)} but empty instead of 422, for pre-checks that must not fail. */
    @Transactional(readOnly = true)
    public String slugOrNull(String slug, String name) {
        if (StringUtils.hasText(slug)) {
            return localities.findBySlugAndArchivedAtIsNull(slug.trim()).map(Locality::getSlug).orElse(null);
        }
        if (!StringUtils.hasText(name)) {
            return null;
        }
        List<Locality> hits = localities.findByNameIgnoreCaseAndArchivedAtIsNull(name.trim());
        return hits.size() == 1 ? hits.getFirst().getSlug() : null;
    }

    private Locality live(String name) {
        if (!StringUtils.hasText(name)) {
            throw refusal();
        }
        List<Locality> hits = localities.findByNameIgnoreCaseAndArchivedAtIsNull(name.trim());
        if (hits.size() != 1) {
            throw refusal();
        }
        return hits.getFirst();
    }

    private static ValidationException refusal() {
        return new ValidationException(LocalityPlaceService.PICK_MESSAGE);
    }
}