package com.draazy.api.identity.verification;

import java.time.Instant;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface IdentityStorageDeleteRepository extends JpaRepository<IdentityStorageDelete, String> {

    @Modifying
    @Query(value = """
            insert into identity_storage_deletes (storage_key, queued_at)
            values (:key, :queuedAt)
            on conflict (storage_key) do nothing
            """, nativeQuery = true)
    void queue(String key, Instant queuedAt);

    @Query(value = """
            select * from identity_storage_deletes
             where queued_at + ((attempts + 1) * interval '5 minutes') <= :now
             order by queued_at
            """, nativeQuery = true)
    List<IdentityStorageDelete> findDue(Instant now, Pageable pageable);

    @Modifying
    @Query("""
            update IdentityStorageDelete d
               set d.attempts = d.attempts + 1,
                   d.lastError = :lastError
             where d.storageKey = :key
            """)
    int recordFailure(String key, String lastError);
}
