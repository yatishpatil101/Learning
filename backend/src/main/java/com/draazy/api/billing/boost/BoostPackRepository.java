package com.draazy.api.billing.boost;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Boost packs, cheapest first — the order the pack picker renders. */
public interface BoostPackRepository extends JpaRepository<BoostPack, UUID> {

    List<BoostPack> findAllByOrderByPriceAsc();
}
