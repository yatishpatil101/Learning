package com.draazy.api.catalog.property;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PropertyPhotoHashRepository
        extends JpaRepository<PropertyPhotoHash, PropertyPhotoHash.Key> {

    /**
     * Photo hashes belonging to <em>other</em> owners' live listings that might be the same shot.
     *
     * <p>Might, not are. This is the band pre-filter described in V116: it returns everything sharing
     * any one of the four 16-bit bands with any of the submitted hashes, and the caller checks the
     * actual Hamming distance on what comes back. Band equality alone is not the match — a shared
     * band happens by chance roughly once in 65,536 per band per pair, which over a real catalogue is
     * plenty of candidates that are not duplicates at all.
     *
     * <p>The four {@code in} lists rather than one query per photo: a listing carries up to
     * {@link PhotoHash#MAX_PER_LISTING} photos, and twenty index probes on the write path to answer a
     * question that is usually "no" is twenty times the cost of one.
     *
     * <p>Same status and archived clauses as {@link PropertyRepository#findDuplicateCandidates}, for
     * the same reason spelled out there: a duplicate of something already taken down is not a live
     * conflict, and flagging one teaches the desk to ignore the flag. Kept in step with that method
     * by hand — if the definition of "live enough to collide with" moves, it moves in both.
     *
     * <p>Capped by the caller. Unlike the address arm, whose keys are exact, a band hit is cheap to
     * manufacture: an image whose hash happens to share a band with a popular stock photo would
     * otherwise pull every listing carrying it into memory on someone else's create.
     */
    @Query("""
            select h from PropertyPhotoHash h, Property p
            where p.id = h.propertyId
              and p.owner.id <> :ownerId
              and p.archived = false
              and p.status in :statuses
              and (
                    h.band0 in :bands0
                 or h.band1 in :bands1
                 or h.band2 in :bands2
                 or h.band3 in :bands3
              )
            """)
    List<PropertyPhotoHash> findBandCandidates(
            @Param("ownerId") UUID ownerId,
            @Param("statuses") Collection<String> statuses,
            @Param("bands0") Collection<Integer> bands0,
            @Param("bands1") Collection<Integer> bands1,
            @Param("bands2") Collection<Integer> bands2,
            @Param("bands3") Collection<Integer> bands3,
            Pageable pageable);

    /**
     * Drop a listing's hashes so the write path can replace them.
     *
     * <p>Replace rather than merge, because a photo the owner removed must stop being evidence. An
     * edit that swaps every photo for new ones is the exact case an append-only table would get
     * wrong: the listing would keep matching a set of images it no longer shows, and the ops desk
     * would be sent to look for photos that are not there.
     */
    @Modifying
    void deleteByPropertyId(UUID propertyId);

    List<PropertyPhotoHash> findByPropertyId(UUID propertyId);

    /**
     * Every hash held by any of the given listings, in one round trip.
     *
     * <p>For the ops desk's clustering read (D255), which is the one caller that needs the photo
     * evidence for a whole population rather than for one listing. {@link #findBandCandidates} is
     * the wrong shape for it: that asks "who matches <em>this</em> listing", so clustering through
     * it would be one query per member and would ask each question twice, once from each side.
     *
     * <p>Returns hashes rather than pairs deliberately — the banding and the exact
     * {@code PhotoHash.sameShot} verification stay in the service, where the union-find that
     * consumes them lives, instead of being half in SQL and half in Java.
     */
    List<PropertyPhotoHash> findByPropertyIdIn(Collection<UUID> propertyIds);
}
