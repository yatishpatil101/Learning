package com.draazy.api.engagement.society;

import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Resolves a page's worth of society-hub authors into a display name and a live resident badge.
 *
 * <p>Every surface on the hub — questions, answers, the noticeboard, community contributions and
 * their replies — needs exactly the same two facts about whoever wrote each row, and needs them for
 * a whole page at once. Without somewhere shared to put it, the second service to need it copies
 * the first, and the copy is where the badge quietly stops being recomputed.
 *
 * <p><strong>The badge is derived on every read, never stored.</strong> A {@code resident} column
 * frozen at posting time — which is what the browser build kept — goes on asserting "verified
 * resident" after the committee has rejected the person, and that is the one claim a trust badge
 * must not keep making. The cost is one extra query per page; the benefit is that a rejection
 * retracts the badge retroactively, everywhere, with no backfill.
 */
@Component
public class SocietyAuthors {

    private final UserRepository users;
    private final SocietyResidentRepository residents;

    public SocietyAuthors(UserRepository users, SocietyResidentRepository residents) {
        this.users = users;
        this.residents = residents;
    }

    /**
     * Two queries for a whole page, whatever its size.
     *
     * @param societyId the society whose residency register decides the badge
     * @param authorIds may repeat and may contain nulls' worth of noise; de-duplicated here
     */
    public Directory of(UUID societyId, Collection<UUID> authorIds) {
        List<UUID> ids = authorIds == null ? List.of()
                : authorIds.stream().filter(java.util.Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) {
            return new Directory(Map.of(), Set.of());
        }
        Map<UUID, User> byId = new LinkedHashMap<>();
        users.findAllById(ids).forEach(u -> byId.put(u.getId(), u));
        return new Directory(byId, residents.verifiedAmong(societyId, ids));
    }

    /** The answers, for one page. */
    public record Directory(Map<UUID, User> users, Set<UUID> verified) {

        /**
         * A display name, however little of one there is.
         *
         * <p>Two different absences, one label. An <strong>erased</strong> account leaves its posts
         * behind — the DSR path detaches rather than cascades, because a thread with holes in it is
         * unreadable — so the row is gone. A <strong>nameless</strong> account is somebody who
         * signed in with a mobile and never filled in a profile, which is most people on their
         * first visit. Either would otherwise put a null on the wire and render a blank byline next
         * to a real sentence, which reads as a broken page rather than an anonymous one.
         *
         * <p>"A resident" rather than "Anonymous": on a society page the honest thing to say about
         * somebody whose name we do not have is that we do not have it. {@link #isResident} carries
         * the part a reader is actually weighing.
         */
        public String name(UUID authorId) {
            User user = users.get(authorId);
            if (user == null || user.getName() == null || user.getName().isBlank()) {
                return "A resident";
            }
            return user.getName();
        }

        public boolean isResident(UUID authorId) {
            return verified.contains(authorId);
        }
    }
}
