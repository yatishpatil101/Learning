package com.draazy.api.engagement.follow;

import com.draazy.api.catalog.society.Society;
import com.draazy.api.catalog.society.SocietyRepository;
import com.draazy.api.catalog.society.SocietyService;
import com.draazy.api.common.error.NotFoundException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Hard-deleted and deduplicated by the database, not by catching exceptions or read-then-write checks. */
@Service
public class SocietyFollowService {

    private final SocietyFollowRepository followRepo;
    private final SocietyRepository societyRepo;
    private final SocietyService societyService;

    public SocietyFollowService(SocietyFollowRepository followRepo,
            SocietyRepository societyRepo, SocietyService societyService) {
        this.followRepo = followRepo;
        this.societyRepo = societyRepo;
        this.societyService = societyService;
    }

    /** Paged because a user can follow every society (unbounded). {@code findAllById} drops id order,
     * so it is restored via a {@link LinkedHashMap}. */
    @Transactional(readOnly = true)
    public Page<FollowedSociety> listFollowed(UUID userId, Pageable pageable) {
        Page<UUID> ids = followRepo.findFollowedSocietyIds(userId, pageable);
        if (ids.isEmpty()) {
            return new PageImpl<>(List.of(), pageable, ids.getTotalElements());
        }

        Map<UUID, Society> byId = new LinkedHashMap<>();
        ids.getContent().forEach(id -> byId.put(id, null));
        societyRepo.findAllById(ids.getContent()).forEach(s -> byId.put(s.getId(), s));

        // Filtered, not trusted: the FK makes an orphan join row unreachable; the total still counts follows.
        List<Society> ordered = byId.values().stream().filter(Objects::nonNull).toList();
        Map<UUID, Long> homes = societyService.homeCounts(ordered.stream().map(Society::getId).toList());
        return new PageImpl<>(ordered.stream()
                .map(s -> new FollowedSociety(s.getSlug(), s.getName(), s.getLocalitySlug(),
                        homes.getOrDefault(s.getId(), 0L)))
                .toList(), pageable, ids.getTotalElements());
    }

    @Transactional
    public void follow(UUID userId, String slug) {
        Society society = societyRepo.findBySlugAndArchivedAtIsNull(slug)
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
