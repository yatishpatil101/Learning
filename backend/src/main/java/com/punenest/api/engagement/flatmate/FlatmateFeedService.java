package com.punenest.api.engagement.flatmate;

import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The tab-aware mixed feed — the surface the consumer page actually renders.
 *
 * <p><strong>The tabs are keyed on seeker intent, not on our storage model</strong>, which is the
 * whole reason this service exists rather than the client calling three list endpoints and stitching
 * the results:
 *
 * <ul>
 *   <li>{@code move-in} — browse PLACES: rooms, plus groups that already hold an address.</li>
 *   <li>{@code team-up} — browse PEOPLE: solo seeker posts, plus groups still hunting.</li>
 * </ul>
 *
 * <p>A group appears in whichever tab matches where it has got to, and moves between them as its
 * search progresses. Splitting by table would have put "three people looking for a flat" next to
 * "a room in Baner" purely because both happen to be groups.
 *
 * <p><strong>Sorted as one list, then paged.</strong> Merging two pre-sorted lists would stack every
 * room above every group regardless of age. The cost is that a page is computed in memory rather
 * than by the database — acceptable while the market is one city, and called out here so the day it
 * stops being acceptable is recognisable rather than mysterious. A UNION view is the fix.
 */
@Service
public class FlatmateFeedService {

    /**
     * How many rows of each kind are gathered before merging.
     *
     * <p>A ceiling, not a page size: the merge needs enough of each kind that the sort is honest,
     * but reading every row of a growing table to render twenty cards is how a feed endpoint becomes
     * the slowest thing on the platform.
     */
    private static final int MERGE_CEILING = 200;

    private final FlatmateSeekerPostRepository posts;
    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;
    private final FlatmateMapper mapper;
    private final UserRepository users;

    public FlatmateFeedService(FlatmateSeekerPostRepository posts, FlatmateRoomRepository rooms,
            FlatmateGroupRepository groups, FlatmateMapper mapper, UserRepository users) {
        this.posts = posts;
        this.rooms = rooms;
        this.groups = groups;
        this.mapper = mapper;
        this.users = users;
    }

    /** {@code GET /flatmates/feed} — public. One feed per tab, sorted newest first. */
    @Transactional(readOnly = true)
    public org.springframework.data.domain.Page<Object> feed(String tab, String legacyView,
            String locality, Integer budget, boolean verifiedOnly, Pageable pageable) {

        String resolved = FlatmateVocabulary.resolveTab(tab, legacyView);
        String filter = FlatmateVocabulary.blankToNull(locality);
        Pageable gather = PageRequest.of(0, MERGE_CEILING);

        List<Entry> merged = new ArrayList<>();

        if (FlatmateVocabulary.TAB_MOVE_IN.equals(resolved)) {
            // Places: every room, plus the groups that have somewhere to live.
            rooms.feed(filter, gather).forEach(r -> merged.add(
                    new Entry(r.getCreatedAt(), r.getBudget(), r.isVerified(), r)));
            groups.feed(filter, gather).stream()
                    .filter(FlatmateGroup::hasAddress)
                    .forEach(g -> merged.add(new Entry(
                            g.getCreatedAt(), perHead(g), tierVerified(g), g)));
        } else {
            // People: solo seekers, plus the groups still hunting.
            posts.feed(filter, gather).forEach(p -> merged.add(
                    new Entry(p.getCreatedAt(), p.getBudget(), p.isVerified(), p)));
            groups.feed(filter, gather).stream()
                    .filter(g -> !g.hasAddress())
                    .forEach(g -> merged.add(new Entry(
                            g.getCreatedAt(), perHead(g), tierVerified(g), g)));
        }

        List<Entry> filtered = merged.stream()
                .filter(e -> budget == null || e.budget() == null || e.budget() <= budget)
                .filter(e -> !verifiedOnly || e.verified())
                .sorted(Comparator.comparing(Entry::createdAt).reversed())
                .toList();

        int from = (int) Math.min(pageable.getOffset(), filtered.size());
        int to = Math.min(from + pageable.getPageSize(), filtered.size());
        List<Object> window = filtered.subList(from, to).stream()
                .map(Entry::source)
                .toList();

        return new PageImpl<>(render(window), pageable, filtered.size());
    }

    /**
     * Map the merged window to wire DTOs.
     *
     * <p>Host names are resolved in one batch rather than per row: a page of twenty cards would
     * otherwise be twenty lookups of a table we already know the keys for.
     */
    private List<Object> render(List<Object> window) {
        List<UUID> hostIds = window.stream()
                .map(FlatmateFeedService::hostIdOf)
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, String> names = users.findAllById(hostIds).stream()
                .collect(Collectors.toMap(User::getId, User::getName));

        return window.stream().map(source -> switch (source) {
            case FlatmateRoom r -> (Object) mapper.toDto(r,
                    FlatmateMapper.RoomView.anonymous(names.get(r.getHostId())));
            case FlatmateGroup g -> (Object) mapper.toDto(g,
                    FlatmateMapper.PartyView.anonymous(names.get(g.getHostId())));
            case FlatmateSeekerPost p -> (Object) mapper.toDto(p,
                    FlatmateMapper.SeekerView.ANONYMOUS);
            default -> throw new IllegalStateException("Unmappable feed entry: " + source.getClass());
        }).toList();
    }

    private static UUID hostIdOf(Object source) {
        return switch (source) {
            case FlatmateRoom r -> r.getHostId();
            case FlatmateGroup g -> g.getHostId();
            case FlatmateSeekerPost p -> p.getUserId();
            default -> null;
        };
    }

    /** A group's rent is the whole flat's, so the comparable number is per head. */
    private static Long perHead(FlatmateGroup group) {
        return group.getSeatsTotal() > 0 ? group.getRent() / group.getSeatsTotal() : group.getRent();
    }

    /** A group carries no {@code verified} flag of its own; the owner tier is what earns the pill. */
    private static boolean tierVerified(FlatmateGroup group) {
        return FlatmateVocabulary.TIER_OWNER.equals(group.getVerificationTier());
    }

    /**
     * One merged row, reduced to just what the sort and the filters need.
     *
     * @param budget the per-head comparable price, so a group and a room sort on the same scale
     */
    private record Entry(Instant createdAt, Long budget, boolean verified, Object source) {
    }
}
