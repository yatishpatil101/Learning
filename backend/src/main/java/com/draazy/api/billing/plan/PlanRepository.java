package com.draazy.api.billing.plan;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Plans, in a stable order — the price list is rendered cheapest first. */
public interface PlanRepository extends JpaRepository<Plan, UUID> {

    List<Plan> findAllByOrderByPriceAsc();
}
