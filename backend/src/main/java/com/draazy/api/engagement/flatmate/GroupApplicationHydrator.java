package com.draazy.api.engagement.flatmate;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Turns {@link FlatmateGroupApplication} rows into {@link GroupApplicationDto}s.
 *
 * <p>An application row holds two foreign keys, two statuses and two timestamps. Everything a
 * screen actually renders — the listing's title, its locality, its rent, the group's title, how
 * many people are in it — lives on the listing and the group. It is <strong>read</strong> rather
 * than denormalised onto the row so that no screen can show a price that stopped being true the
 * moment the owner edited their listing.
 *
 * <p>Its own class because two services need it and they answer to different people: the admin
 * board ({@link FlatmateModerationService#applications}) and the owner inbox
 * ({@link FlatmateApplicationService#inbox}). Duplicating the join would have meant two places to
 * forget the batching, and the batching is the point — a per-row lookup here is three extra
 * queries per application on a screen that renders fifty.
 *
 * <p><strong>A missing join target is not an error.</strong> A listing can be archived and a group
 * disbanded while an application still points at them; the row is still a true record of something
 * that happened. Those fields come back null rather than throwing, because a moderator needs to
 * see the orphaned row in order to clear it.
 */
@Component
class GroupApplicationHydrator {

    private final PropertyRepository properties;
    private final FlatmateGroupRepository groups;
    private final UserRepository users;

    GroupApplicationHydrator(PropertyRepository properties, FlatmateGroupRepository groups,
            UserRepository users) {
        this.properties = properties;
        this.groups = groups;
        this.users = users;
    }

    /** Join the listing and group facts each row renders, batched rather than per row. */
    List<GroupApplicationDto> hydrate(List<FlatmateGroupApplication> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        Map<UUID, Property> listings = properties.findAllById(
                        rows.stream().map(FlatmateGroupApplication::getListingId).distinct().toList())
                .stream().collect(Collectors.toMap(Property::getId, p -> p));
        Map<UUID, FlatmateGroup> byGroup = groups.findAllById(
                        rows.stream().map(FlatmateGroupApplication::getGroupId).distinct().toList())
                .stream().collect(Collectors.toMap(FlatmateGroup::getId, g -> g));
        Map<UUID, User> applicants = users.findAllById(
                        rows.stream().map(FlatmateGroupApplication::getApplicantId).distinct().toList())
                .stream().collect(Collectors.toMap(User::getId, u -> u));

        return rows.stream().map(row -> {
            Property listing = listings.get(row.getListingId());
            FlatmateGroup group = byGroup.get(row.getGroupId());
            User applicant = applicants.get(row.getApplicantId());
            return GroupApplicationDto.of(row,
                    listing == null ? null : listing.getTitle(),
                    listing == null ? null : listing.getLocality(),
                    listing == null ? null : listing.getPrice(),
                    group == null ? null : group.getTitle(),
                    applicant == null ? null : applicant.getName(),
                    group == null ? 0 : group.getMembers().size(),
                    group == null ? 0 : group.getSeatsTotal());
        }).toList();
    }

    /** One row, for the two write paths that return the thing they just changed. */
    GroupApplicationDto hydrateOne(FlatmateGroupApplication row) {
        return hydrate(List.of(row)).getFirst();
    }
}
