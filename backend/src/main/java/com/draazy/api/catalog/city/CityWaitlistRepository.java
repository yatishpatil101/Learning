package com.draazy.api.catalog.city;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * Writes city-waitlist signups, and aggregates them for the one surface allowed to read them.
 *
 * <p><strong>One finder, and it returns counts.</strong> This table is unverified public
 * submissions carrying a mobile and an optional email, so a row-level finder added "for
 * completeness" would be an enumeration risk looking for a caller. {@link #demandByCity()} is not
 * that: it groups before it returns, so no contact detail can leave through it no matter who calls
 * it or what they pass. The distinction is the whole reason there is still no
 * {@code findAll}-shaped read here — the constraint is on the shape of the answer, not on the
 * guard in front of it.
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

    /**
     * Every city anybody has asked for, most-wanted first.
     *
     * <p><strong>Grouped by {@code lower(city)}, displayed as {@code min(city)}.</strong> The
     * grouping key matches {@code uq_city_waitlist_mobile_city} exactly, so "Mumbai" and "mumbai"
     * are one row here for the same reason they are one signup there — anything else would report
     * a single city twice and rank both halves below a city with fewer people wanting it. The key
     * itself is not what gets printed: a back-office table reading "mumbai" looks like a rendering
     * bug. {@code min(city)} is an arbitrary pick among the spellings that were actually submitted,
     * which is the point — every alternative (title-casing, a curated alias table) invents a
     * spelling nobody typed, and this table is free text precisely because these are cities
     * Draazy does not have a roster entry for.
     *
     * <p>No window parameter. Every other analytics read here takes {@code ?days=} and defaults to
     * 30; this one is all-time on purpose, because wanting a city is not an event that decays.
     * Somebody who asked eight months ago still wants Nashik, and a 30-day window on a signal that
     * arrives a handful of times a week would report noise as a trend. {@code lastRequestedAt}
     * carries the recency that a window would otherwise have to stand in for, without discarding
     * the rest of the history to do it.
     *
     * <p>Unpaged, and safe to be: the row count is the number of distinct cities people have named,
     * not the number of signups.
     */
    @Query("""
            select new com.draazy.api.catalog.city.CityWaitlistDemandRow(
                min(w.city), count(w), max(w.createdAt))
            from CityWaitlistEntry w
            group by lower(w.city)
            order by count(w) desc, max(w.createdAt) desc""")
    List<CityWaitlistDemandRow> demandByCity();
}
