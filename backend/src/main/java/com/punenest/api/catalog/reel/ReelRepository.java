package com.punenest.api.catalog.reel;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** Reads the reels feed. No writes: reels are seeded content, not user-generated here. */
public interface ReelRepository extends JpaRepository<Reel, UUID> {

    /** The whole feed, newest first. */
    List<Reel> findAllByOrderByCreatedAtDesc(Pageable pageable);

    /** The feed for one locality. Case-insensitive because the query value is user-supplied. */
    List<Reel> findByLocalityIgnoreCaseOrderByCreatedAtDesc(String locality, Pageable pageable);
}
