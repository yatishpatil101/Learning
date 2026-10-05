package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.common.trust.OwnerBadgeSink;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.Roles;
import com.draazy.api.support.AbstractApiTest;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@DisplayName("A badge flip reaches flatmate cards, not just listings")
class FlatmateBadgeCopyTest extends AbstractApiTest {

    @Autowired OwnerBadgeSink badgeSink;
    @Autowired UserRepository users;
    @Autowired FlatmateSeekerPostRepository posts;
    @Autowired FlatmateGroupRepository groups;

    @Test
    void revokeClearsTheSeekerCardAndGroupSeatThenApprovalRestoresThem() {
        User person = saveUser("9876000390");
        User bystander = saveUser("9876000391");
        UUID postId = savePost(person, true);
        UUID otherPostId = savePost(bystander, true);
        UUID groupId = saveGroupWith(bystander, person);

        badgeSink.markOwnerUnverified(person.getId());

        assertThat(postVerified(postId)).isFalse();
        assertThat(memberVerified(groupId, person.getId())).isFalse();
        assertThat(postVerified(otherPostId)).isTrue();
        assertThat(memberVerified(groupId, bystander.getId())).isTrue();

        badgeSink.markOwnerVerified(person.getId());

        assertThat(postVerified(postId)).isTrue();
        assertThat(memberVerified(groupId, person.getId())).isTrue();
    }

    private User saveUser(String mobile) {
        User user = new User(mobile, Roles.Wire.BUYER);
        user.setMobileVerified(true);
        return users.saveAndFlush(user);
    }

    private UUID savePost(User author, boolean verified) {
        FlatmateSeekerPost post = new FlatmateSeekerPost(author.getId(), "Seeker", 15_000L);
        post.setVerified(verified);
        return posts.saveAndFlush(post).getId();
    }

    private UUID saveGroupWith(User host, User member) {
        FlatmateGroup group = new FlatmateGroup(host.getId(), "Two seats in Baner", "Baner", 12_000L);
        group.addMember(new FlatmateGroupMember("Host", host.getId(), true));
        group.addMember(new FlatmateGroupMember("Member", member.getId(), true));
        return groups.saveAndFlush(group).getId();
    }

    private boolean postVerified(UUID postId) {
        return jdbc.queryForObject("select verified from flatmate_seeker_posts where id = ?",
                Boolean.class, postId);
    }

    private boolean memberVerified(UUID groupId, UUID userId) {
        return jdbc.queryForObject(
                "select verified from flatmate_group_members where group_id = ? and user_id = ?",
                Boolean.class, groupId, userId);
    }
}
