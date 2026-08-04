package com.punenest.api.catalog.locality;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Spring Data access for {@link Locality}. Reference data only — no write methods, because localities
 * are curated through migrations, not by application code.
 *
 * <p>Both finders are scoped to {@code active = true}: an archived/retired locality must never become
 * the resolution target for a new listing, even though existing rows may still point at it.
 */
public interface LocalityRepository extends JpaRepository<Locality, String> {

    /** Exact slug hit — the fast path when the client already sends a canonical key. */
    Optional<Locality> findBySlugAndActiveTrue(String slug);

    /** Case-insensitive display-name match (names are not unique, hence a list, not an Optional). */
    List<Locality> findByNameIgnoreCaseAndActiveTrue(String name);

    /**
     * The full active set, for the geo fallback. Deliberately unpaged and loaded whole: this is a
     * curated reference table of city-level areas (tens of rows, not thousands), and the caller needs
     * every candidate to compute a nearest-neighbour. Revisit only if it ever grows past a few
     * hundred rows, at which point this becomes a PostGIS/earthdistance query instead.
     */
    List<Locality> findByActiveTrue();

    /**
     * The public locality list, alphabetical.
     *
     * <p>Active only, for the same reason as the finders above, and unpaged for the same reason as
     * {@link #findByActiveTrue()} — the contract's {@code GET /localities} takes no page parameters
     * because there are tens of rows, not thousands.
     */
    List<Locality> findByActiveTrueOrderByNameAsc();
}
