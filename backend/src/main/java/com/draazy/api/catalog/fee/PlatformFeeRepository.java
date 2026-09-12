package com.draazy.api.catalog.fee;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/** Reads the published per-deal fee breakdown. Read-only: the table is seeded reference data. */
public interface PlatformFeeRepository extends JpaRepository<PlatformFee, String> {

    /**
     * Every published breakdown, ordered by deal so the array the contract returns is stable.
     *
     * <p>A stable order matters more than it looks: this response is compared field-by-field by the
     * parity tests, and an unordered two-row read from Postgres is free to come back either way
     * round.
     */
    List<PlatformFee> findAllByOrderByDealAsc();
}
