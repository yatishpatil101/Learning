package com.punenest.api.engagement.follow;

import com.punenest.api.catalog.society.Society;
import com.punenest.api.catalog.society.SocietyRepository;
import com.punenest.api.common.error.NotFoundException;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Follow/unfollow a society — a personal preference that feeds the discovery surface and the
 * society hub's follower count.
 *
 * <p>Follows are hard-deleted (D8.9) and deduplicated at the database level (D8.10), not by
 * catching exceptions or by read-then-write checks.
 */
@Service
public class SocietyFollowService {

    private final SocietyFollowRepository followRepo;
    private final SocietyRepository societyRepo;

    public SocietyFollowService(SocietyFollowRepository followRepo,
            SocietyRepository societyRepo) {
        this.followRepo = followRepo;
        this.societyRepo = societyRepo;
    }

    /**
     * Follow a society by slug. Validates existence first so we never write a dangling FK.
     *
     * @throws NotFoundException if no society with this slug exists
     */
    @Transactional
    public void follow(UUID userId, String slug) {
        Society society = societyRepo.findBySlug(slug)
                .orElseThrow(() -> NotFoundException.of("Society"));
        followRepo.insertIfAbsent(userId, society.getId());
    }

    /** Unfollow. Idempotent: answers 204 whether or not the row existed. */
    @Transactional
    public void unfollow(UUID userId, String slug) {
        societyRepo.findBySlug(slug).ifPresent(society ->
                followRepo.deleteByUserAndSociety(userId, society.getId()));
    }
}
