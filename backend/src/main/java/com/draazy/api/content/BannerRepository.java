package com.draazy.api.content;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Non-archived banners, ordered by position. */
public interface BannerRepository extends JpaRepository<BannerEntity, UUID> {
}