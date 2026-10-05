package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.trust.VerifiedBadgeCopy;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
class FlatmateBadgeCopy implements VerifiedBadgeCopy {

    private final FlatmateSeekerPostRepository posts;
    private final FlatmateGroupRepository groups;

    FlatmateBadgeCopy(FlatmateSeekerPostRepository posts, FlatmateGroupRepository groups) {
        this.posts = posts;
        this.groups = groups;
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void copyBadge(UUID userId, boolean verified) {
        posts.copyBadge(userId, verified);
        groups.copyMemberBadge(userId, verified);
    }
}
