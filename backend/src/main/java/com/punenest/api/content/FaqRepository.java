package com.punenest.api.content;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Non-archived FAQs. */
public interface FaqRepository extends JpaRepository<FaqEntity, UUID> {
    List<FaqEntity> findByArchivedFalse();
}
