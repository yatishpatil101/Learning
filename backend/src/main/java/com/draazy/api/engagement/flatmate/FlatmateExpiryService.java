package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.trust.Notifier;
import com.draazy.api.security.AuthPrincipal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FlatmateExpiryService {

    static final String DASHBOARD = "/dashboard#listings";

    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;
    private final FlatmateSeekerPostRepository posts;
    private final Notifier notifier;

    public FlatmateExpiryService(FlatmateRoomRepository rooms, FlatmateGroupRepository groups,
            FlatmateSeekerPostRepository posts, Notifier notifier) {
        this.rooms = rooms;
        this.groups = groups;
        this.posts = posts;
        this.notifier = notifier;
    }

    @Transactional
    public int remindExpiring() {
        Instant soon = Instant.now().plus(FlatmateExpiry.REMIND_DAYS_BEFORE, ChronoUnit.DAYS);
        int count = 0;
        for (FlatmateRoom r : rooms.findPublicActiveUntil(soon, false)) {
            r.getExpiry().markReminded();
            tellExpiring(r.getHostId(), "room");
            count++;
        }
        for (FlatmateGroup g : groups.findPublicActiveUntil(soon, false)) {
            g.getExpiry().markReminded();
            tellExpiring(g.getHostId(), "group");
            count++;
        }
        for (FlatmateSeekerPost p : posts.findPublicActiveUntil(soon, false)) {
            p.getExpiry().markReminded();
            tellExpiring(p.getUserId(), "post");
            count++;
        }
        return count;
    }

    @Transactional
    public int expireLapsed() {
        Instant now = Instant.now();
        int count = 0;
        for (FlatmateRoom r : rooms.findPublicActiveUntil(now, true)) {
            r.setModStatus(r.getExpiry().expire(r.getModStatus()));
            tellExpired(r.getHostId(), "room");
            count++;
        }
        for (FlatmateGroup g : groups.findPublicActiveUntil(now, true)) {
            g.setModStatus(g.getExpiry().expire(g.getModStatus()));
            tellExpired(g.getHostId(), "group");
            count++;
        }
        for (FlatmateSeekerPost p : posts.findPublicActiveUntil(now, true)) {
            p.setModStatus(p.getExpiry().expire(p.getModStatus()));
            tellExpired(p.getUserId(), "post");
            count++;
        }
        return count;
    }

    @Transactional
    public void renew(AuthPrincipal caller, String kind, UUID id) {
        switch (kind == null ? "" : kind) {
            case "room" -> {
                FlatmateRoom r = rooms.findById(id).filter(x -> !x.isArchived())
                        .orElseThrow(() -> NotFoundException.of("Flatmate room"));
                requireOwner(caller, r.getHostId());
                r.setModStatus(r.getExpiry().revive(r.getModStatus()));
            }
            case "group" -> {
                FlatmateGroup g = groups.findById(id).filter(x -> !x.isArchived())
                        .orElseThrow(() -> NotFoundException.of("Flatmate group"));
                requireOwner(caller, g.getHostId());
                g.setModStatus(g.getExpiry().revive(g.getModStatus()));
            }
            case "post" -> {
                FlatmateSeekerPost p = posts.findById(id).filter(x -> !x.isArchived())
                        .orElseThrow(() -> NotFoundException.of("Flatmate post"));
                requireOwner(caller, p.getUserId());
                p.setModStatus(p.getExpiry().revive(p.getModStatus()));
            }
            default -> throw NotFoundException.of("Flatmate post");
        }
    }

    private static void requireOwner(AuthPrincipal caller, UUID ownerId) {
        if (!ownerId.equals(caller.userId())) {
            throw new ForbiddenException("You can only renew your own flatmate post.");
        }
    }

    private void tellExpiring(UUID ownerId, String what) {
        notifier.notify(ownerId, "flatmate." + what + ".expiring",
                "Your flatmate " + what + " comes off the board in "
                        + FlatmateExpiry.REMIND_DAYS_BEFORE + " days",
                "Renew it from your dashboard to keep it up for another "
                        + FlatmateExpiry.LIFETIME_DAYS + " days.",
                DASHBOARD);
    }

    private void tellExpired(UUID ownerId, String what) {
        notifier.notify(ownerId, "flatmate." + what + ".expired",
                "Your flatmate " + what + " is off the board",
                "It went " + FlatmateExpiry.LIFETIME_DAYS + " days without an update. Renew it from"
                        + " your dashboard to put it back up.",
                DASHBOARD);
    }
}
