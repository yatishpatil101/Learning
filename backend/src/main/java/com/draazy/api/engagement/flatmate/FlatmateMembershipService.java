package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.persistence.RateLimitLock;
import com.draazy.api.common.settings.PlatformSettings;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FlatmateMembershipService {

    private final FlatmateGroupRepository groups;
    private final FlatmateRequestRepository requests;
    private final PlatformSettings settings;
    private final RateLimitLock locks;
    private final UserRepository users;
    private final Notifier notifier;
    private final AuditService audit;

    FlatmateMembershipService(FlatmateGroupRepository groups, FlatmateRequestRepository requests,
            PlatformSettings settings, RateLimitLock locks, UserRepository users, Notifier notifier,
            AuditService audit) {
        this.groups = groups;
        this.requests = requests;
        this.settings = settings;
        this.locks = locks;
        this.users = users;
        this.notifier = notifier;
        this.audit = audit;
    }

    void requireRoomToAsk(UUID userId) {
        int limit = settings.maxGroupsPerPerson();
        if (groups.countJoinedBy(userId) + requests.countPendingGroupAsks(userId) >= limit) {
            throw FlatmateConflicts.groupLimit("You can be in " + limit + " groups at a time. "
                    + "Leave a group or cancel a request first.");
        }
    }

    void requireRoomToAccept(UUID userId) {
        locks.holdUntilCommit(RateLimitLock.Limit.FLATMATE_INTEREST, userId.toString());
        if (groups.countJoinedBy(userId) >= settings.maxGroupsPerPerson()) {
            throw FlatmateConflicts.groupLimit("This person is already in as many groups as allowed.");
        }
    }

    @Transactional
    public void leave(AuthPrincipal caller, UUID groupId) {
        FlatmateGroup group = groups.lockLive(groupId)
                .orElseThrow(() -> NotFoundException.of("Group"));
        if (group.getHostId().equals(caller.userId())) {
            throw new ConflictException("You host this group. Delete it from My listings instead.");
        }
        FlatmateGroupMember me = group.getMembers().stream()
                .filter(m -> caller.userId().equals(m.getUserId()))
                .findFirst()
                .orElseThrow(() -> NotFoundException.of("Group membership"));

        int open = group.openSeats();
        group.removeMember(me);
        group.setSeatsOpen(Math.min(group.getSeatsTotal(), open + 1));
        groups.saveAndFlush(group);

        requests.findByKindAndTargetIdAndRequesterId("group", groupId, caller.userId())
                .ifPresent(requests::delete);

        String name = users.findById(caller.userId()).map(User::getName)
                .map(FlatmateVocabulary::blankToNull).orElse(null);
        notifier.notify(group.getHostId(), "flatmate.group.left",
                (name == null ? "A member" : name) + " left " + group.getTitle(),
                "A seat is open again.",
                FlatmateLinks.of("group", groupId));
        audit.record(caller, "flatmate.group.leave", "flatmategroup", groupId.toString(),
                "host", group.getHostId().toString());
    }

    @Transactional
    public void remove(AuthPrincipal caller, UUID groupId, UUID memberId) {
        FlatmateGroup group = groups.lockLive(groupId)
                .filter(g -> g.getHostId().equals(caller.userId()))
                .orElseThrow(() -> NotFoundException.of("Group"));
        FlatmateGroupMember member = group.getMembers().stream()
                .filter(m -> m.getId().equals(memberId))
                .findFirst()
                .orElseThrow(() -> NotFoundException.of("Group member"));
        if (caller.userId().equals(member.getUserId())) {
            throw new ConflictException("You host this group, so you can't remove yourself.");
        }
        int open = group.openSeats();
        group.removeMember(member);
        group.setSeatsOpen(Math.min(group.getSeatsTotal(), open + 1));
        groups.saveAndFlush(group);

        UUID removed = member.getUserId();
        if (removed != null) {
            requests.findByKindAndTargetIdAndRequesterId("group", groupId, removed)
                    .ifPresent(r -> r.decide("declined"));
            notifier.notify(removed, "flatmate.group.removed",
                    "You're no longer in " + group.getTitle(),
                    "The host removed you from this group.",
                    FlatmateLinks.of("group", groupId));
        }
        audit.record(caller, "flatmate.group.remove_member", "flatmategroup", groupId.toString(),
                "member", memberId.toString());
    }
}
