package com.draazy.api.engagement.follow;

import com.draazy.api.catalog.society.Society;
import com.draazy.api.catalog.society.SocietyRepository;
import com.draazy.api.catalog.society.SocietyResponse;
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

/**
 * Follow/unfollow a society, and read back what the caller follows — a personal preference that
 * feeds the discovery surface and the society hub's follower count.
 *
 * <p>Follows are hard-deleted (D8.9) and deduplicated at the database level (D8.10), not by
 * catching exceptions or by read-then-write checks.
 *
 * <p><strong>D227 — why the read had to exist before any of this could be used.</strong> The two
 * writes here shipped in slice 8 and were never called: the browser kept its own
 * {@code dzFollowedSocieties} list instead, so following on a laptop did not follow on a phone. The
 * blocker was not the writes but the absence of this read. Four of the five follow surfaces do not
 * start from a page of societies — the dashboard panel, the dashboard tile and the finder all ask
 * "which ones do I follow?" with nothing to scope the question to — and {@code followedByMe} can
 * only answer it for societies you already have in hand. That is why the surfaces could not be
 * ported one at a time, and why the register entry said to add this route first.
 */
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

    /**
     * The societies this caller follows, most recently followed first.
     *
     * <p>Paged, not a bare array. {@code api-standards.md} §5.1 permits an array where growth is
     * bounded or explicitly capped in the service, and this is neither — nothing stops a user
     * following every society in Pune, and "one user's clicks" is a rate, not a bound. The same
     * ruling produced the paged {@code GET /me/saved}.
     *
     * <p>Two steps rather than a join: page the ids, then fetch that page's entities. The ordering
     * lives in the id query ({@code created_at desc} on the join row), and {@code findAllById}
     * discards it, so it is restored through a {@link LinkedHashMap} keyed in id order. Sorting the
     * entities instead would need a follow timestamp on {@code Society}, which is not a property of
     * a society at all — it is a property of one person's relationship to it.
     *
     * <p>Cards are built by {@link SocietyService#summarise}, the same assembly the public directory
     * uses, so a society renders identically wherever it is found. {@code followedByMe} is therefore
     * computed rather than assumed true; it costs nothing extra (the query is page-scoped and
     * already being run) and hard-coding it would make this the one endpoint that could not report
     * a follow being concurrently removed on another device — the exact class of bug the route
     * exists to fix.
     */
    @Transactional(readOnly = true)
    public Page<SocietyResponse> listFollowed(UUID userId, Pageable pageable) {
        Page<UUID> ids = followRepo.findFollowedSocietyIds(userId, pageable);
        if (ids.isEmpty()) {
            return new PageImpl<>(List.of(), pageable, ids.getTotalElements());
        }

        Map<UUID, Society> byId = new LinkedHashMap<>();
        ids.getContent().forEach(id -> byId.put(id, null));
        societyRepo.findAllById(ids.getContent()).forEach(s -> byId.put(s.getId(), s));

        // A null here means the join row outlived the society. The FK on society_id makes that
        // unreachable today, which is why there is no test for it: the case cannot be constructed
        // without dropping the constraint. It is filtered rather than trusted because the cost is a
        // stream operation and the failure mode is a card with no name. The page's total is
        // deliberately left alone — it counts follows, and a follow is real even when what it
        // points at has gone.
        List<Society> ordered = byId.values().stream().filter(Objects::nonNull).toList();
        return new PageImpl<>(societyService.summarise(ordered, userId), pageable,
                ids.getTotalElements());
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
