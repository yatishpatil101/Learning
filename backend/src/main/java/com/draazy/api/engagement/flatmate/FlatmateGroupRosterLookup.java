package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.trust.FlatmateGroupRoster;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@Transactional(readOnly = true)
class FlatmateGroupRosterLookup implements FlatmateGroupRoster {

    private final FlatmateGroupRepository groups;

    FlatmateGroupRosterLookup(FlatmateGroupRepository groups) {
        this.groups = groups;
    }

    @Override
    public boolean isMember(UUID groupId, UUID userId) {
        return groups.hasMember(groupId, userId);
    }

    @Override
    public List<UUID> memberIds(UUID groupId) {
        return groups.memberUserIds(groupId);
    }

    @Override
    public List<UUID> groupsOf(UUID userId) {
        return groups.groupIdsWithMember(userId);
    }

    @Override
    public Map<UUID, Summary> summaries(Collection<UUID> groupIds) {
        Map<UUID, Summary> out = new HashMap<>();
        if (groupIds.isEmpty()) {
            return out;
        }
        for (Object[] row : groups.titlesAndSizes(groupIds)) {
            out.put((UUID) row[0], new Summary((String) row[1], ((Number) row[2]).intValue()));
        }
        return out;
    }
}
