package com.punenest.api.catalog.city;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Writes city-waitlist signups.
 *
 * <p>No finders. Nothing in this slice reads the waitlist — it is written by the public endpoint and
 * read by whoever decides the next launch city, which is an admin surface that does not exist yet.
 * A read method added "for completeness" on a table of unverified public submissions is an
 * enumeration risk looking for a caller.
 */
public interface CityWaitlistRepository extends JpaRepository<CityWaitlistEntry, UUID> {

    /**
     * Insert a signup, or do nothing if this person already asked for this city.
     *
     * <p><strong>Why native SQL rather than save-and-catch.</strong> The obvious Java shape —
     * {@code save()} inside a {@code try}, catching {@code DataIntegrityViolationException} — is a
     * trap: the failed flush marks the surrounding transaction rollback-only, so swallowing the
     * exception produces a caller that believes it succeeded and a commit that then throws. And
     * checking "does it exist?" first is not a constraint at all, since two concurrent submissions
     * both find nothing and both insert.
     *
     * <p>{@code ON CONFLICT DO NOTHING} says precisely what is meant, in one statement the database
     * evaluates atomically: no exception, no race, no rollback.
     *
     * <p><strong>Why the conflict target is inferred rather than named.</strong> Naming the index
     * ({@code ON CONFLICT ON CONSTRAINT uq_city_waitlist_mobile_city}) is the more explicit form and
     * is simply not available here: Postgres accepts only true table constraints there, and a
     * {@code UNIQUE} constraint cannot be declared over an expression, which is what
     * {@code lower(city)} is. The inference form below is not the weaker option — it must match the
     * index's columns and expression exactly, so if that index is ever dropped or altered this fails
     * loudly with "no unique or exclusion constraint matching the ON CONFLICT specification" rather
     * than quietly re-admitting duplicates. The guarantee is the same; only the spelling differs.
     *
     * <p>{@code id} and {@code created_at} are left to their column defaults — the one place raw SQL
     * is allowed to rely on them.
     *
     * @return 1 if a row was inserted, 0 if the signup already existed
     */
    @Modifying
    @Query(value = """
            insert into city_waitlist (mobile, city, email)
            values (:mobile, :city, :email)
            on conflict (mobile, lower(city)) do nothing""",
            nativeQuery = true)
    int insertIfAbsent(@Param("mobile") String mobile,
            @Param("city") String city,
            @Param("email") String email);
}
