package com.draazy.api.content;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FaqRepository extends JpaRepository<FaqEntity, UUID> {
    List<FaqEntity> findByArchivedFalseOrderByCategoryAscCreatedAtAscIdAsc();

    Page<FaqEntity> findByArchived(boolean archived, Pageable pageable);
}
