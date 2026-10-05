package com.draazy.api.catalog.locality;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

/** Consumer finders return active localities only; retired rows must not receive new listings. */
public interface LocalityRepository extends JpaRepository<Locality, String> {

    /** Exact slug hit — the fast path when the client already sends a canonical key. */
    Optional<Locality> findBySlugAndActiveTrue(String slug);

    /** Case-insensitive display-name match (names are not unique, hence a list, not an Optional). */
    List<Locality> findByNameIgnoreCaseAndActiveTrue(String name);

    /** Load all because nearest-neighbour matching needs every curated locality candidate. */
    List<Locality> findByActiveTrue();

    /** Unpaged because the public contract has no page parameters and the table is curated. */
    List<Locality> findByActiveTrueOrderByNameAsc();
}
