package com.draazy.api.common.trust;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface FlatmateGroupRoster {

    boolean isMember(UUID groupId, UUID userId);

    List<UUID> memberIds(UUID groupId);

    List<UUID> groupsOf(UUID userId);

    Map<UUID, Summary> summaries(Collection<UUID> groupIds);

    record Summary(String title, int memberCount) {
    }
}
