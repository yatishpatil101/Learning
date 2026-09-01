package com.punenest.api.engagement.flatmate;

import com.punenest.api.identity.user.User;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * Native access to the {@code flatmate_saves} table — the same shape, and the same reasoning, as
 * {@code SavedPropertyRepository}.
 *
 * <p>No JPA entity: the table is a composite PK with no surrogate id, and mapping it would mean
 * {@code @IdClass} boilerplate whose only consumers are one list, one insert and one delete.
 *
 * <p><strong>D8.9 — hard delete.</strong> A shortlist toggle is a user preference, not a business
 * record. A tombstone would defeat the PK's natural dedupe and provide no audit value.
 *
 * <p>Extends the bare {@link Repository} marker rather than {@code JpaRepository} for the reason its
 * sibling states: the domain type parameter exists only because Spring Data requires one, and
 * inheriting the CRUD surface would publish {@code findAll()}/{@code delete()} operating on the
 * <em>users</em> table.
 */
public interface FlatmateSaveRepository extends Repository<User, UUID> {

    /** One saved row: which table it points at, and at what. */
    interface SaveRow {
        String getKind();

        UUID getPostId();
    }

    /**
     * The caller's saved rows, newest save first, paged.
     *
     * <p>Paged here rather than in the service so the entity fetches below it only ever load one
     * page's worth. A native paged query needs an explicit {@code countQuery} — Spring Data can
     * derive one from JPQL but not from raw SQL.
     */
    @Query(value = "select kind as kind, post_id as postId from flatmate_saves"
            + " where user_id = :userId order by created_at desc, post_id",
            countQuery = "select count(*) from flatmate_saves where user_id = :userId",
            nativeQuery = true)
    Page<SaveRow> findSaves(@Param("userId") UUID userId, Pageable pageable);

    /**
     * Every save the caller holds, unpaged — the id set the board needs to render its bookmarks
     * filled in.
     *
     * <p>Separate from {@link #findSaves} because the two questions are different sizes: the Saved
     * page renders twenty cards, while the flatmates board needs to know about every save the caller
     * has in order to decide the state of a bookmark on any card it happens to show.
     */
    @Query(value = "select kind as kind, post_id as postId from flatmate_saves"
            + " where user_id = :userId order by created_at desc, post_id",
            nativeQuery = true)
    List<SaveRow> findAllSaves(@Param("userId") UUID userId);

    /**
     * Idempotent save via {@code ON CONFLICT DO NOTHING} (D8.10). Returns 1 if inserted, 0 if already
     * present — no exception, no race, no rollback-only transaction on a repeat tap.
     */
    @Modifying
    @Query(value = "insert into flatmate_saves (user_id, kind, post_id) values (:userId, :kind, :postId)"
            + " on conflict do nothing",
            nativeQuery = true)
    int insertIfAbsent(@Param("userId") UUID userId, @Param("kind") String kind,
            @Param("postId") UUID postId);

    /** Hard delete. Returns 0 if nothing existed — the controller answers 204 either way. */
    @Modifying
    @Query(value = "delete from flatmate_saves where user_id = :userId and kind = :kind and post_id = :postId",
            nativeQuery = true)
    int delete(@Param("userId") UUID userId, @Param("kind") String kind,
            @Param("postId") UUID postId);
}
