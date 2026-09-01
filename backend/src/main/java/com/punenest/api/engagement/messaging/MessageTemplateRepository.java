package com.punenest.api.engagement.messaging;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/** Reads over the template library. */
@Repository
public interface MessageTemplateRepository extends JpaRepository<MessageTemplate, String> {

    /**
     * The library a staff member picks from, for one channel.
     *
     * <p>Ordered by category then name so the panel groups onboarding copy away from chasers without
     * the browser having to sort, and so two staff members comparing screens see the same order.
     */
    List<MessageTemplate> findByChannelAndActiveTrueOrderByCategoryAscNameAsc(String channel);
}
