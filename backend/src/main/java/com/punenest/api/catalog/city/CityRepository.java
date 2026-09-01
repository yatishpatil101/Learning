package com.punenest.api.catalog.city;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/** Reads and writes the curated city list. The roster is seeded; launch state is admin-owned. */
public interface CityRepository extends JpaRepository<City, String> {

    /** Live cities first, then alphabetical — the order a city picker wants without re-sorting. */
    List<City> findAllByOrderByLiveDescNameAsc();
}
