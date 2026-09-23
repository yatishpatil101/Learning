package com.draazy.api.engagement.helpfeedback;

import java.util.UUID;
import org.springframework.data.repository.Repository;

/**
 * Extends {@link Repository} rather than {@code JpaRepository} on purpose: inheriting the usual base
 * would hand the codebase {@code findAll} and {@code deleteAll} on an append-only table.
 */
public interface HelpFeedbackRepository extends Repository<HelpFeedback, UUID> {

    HelpFeedback save(HelpFeedback row);
}
