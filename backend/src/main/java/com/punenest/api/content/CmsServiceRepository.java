package com.punenest.api.content;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Non-archived CMS services. */
public interface CmsServiceRepository extends JpaRepository<CmsServiceEntity, UUID> {
    List<CmsServiceEntity> findByArchivedFalse();
}
