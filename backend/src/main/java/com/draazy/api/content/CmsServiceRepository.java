package com.draazy.api.content;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CmsServiceRepository extends JpaRepository<CmsServiceEntity, UUID> {
}