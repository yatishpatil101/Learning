package com.punenest.api.services.support;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** The caller's own tickets. Serves {@code idx_support_tickets_user_created} (V22). */
public interface SupportTicketRepository extends JpaRepository<SupportTicket, UUID> {

    List<SupportTicket> findByUserIdOrderByCreatedAtDesc(UUID userId);
}
