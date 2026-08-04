package com.punenest.api.catalog.city;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/** Reads the curated city list. Read-only: seeded reference data. */
public interface CityRepository extends JpaRepository<City, String> {

    /** Live cities first, then alphabetical — the order a city picker wants without re-sorting. */
    List<City> findAllByOrderByLiveDescNameAsc();
}
