package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
class FlatmateModerationDetails {

    private final FlatmateSeekerPostRepository posts;
    private final FlatmateRoomRepository rooms;
    private final FlatmateGroupRepository groups;
    private final FlatmateReviewRepository reviews;
    private final UserRepository users;
    private final FlatmateMapper mapper;
    private final FlatmateRoomCards roomCards;

    FlatmateModerationDetails(FlatmateSeekerPostRepository posts, FlatmateRoomRepository rooms,
            FlatmateGroupRepository groups, FlatmateReviewRepository reviews, UserRepository users,
            FlatmateMapper mapper, FlatmateRoomCards roomCards) {
        this.posts = posts;
        this.rooms = rooms;
        this.groups = groups;
        this.reviews = reviews;
        this.users = users;
        this.mapper = mapper;
        this.roomCards = roomCards;
    }

    @Transactional(readOnly = true)
    public FlatmateModerationDetailDto find(UUID id) {
        return posts.findById(id).map(this::ofPost)
                .or(() -> rooms.findById(id).map(this::ofRoom))
                .or(() -> groups.findById(id).map(this::ofGroup))
                .orElseThrow(() -> NotFoundException.of("Flatmate post"));
    }

    private FlatmateModerationDetailDto ofPost(FlatmateSeekerPost post) {
        User author = user(post.getUserId());
        return new FlatmateModerationDetailDto(
                FlatmateModerationQueueDto.of(post, nameOf(author)), null, null,
                mapper.toDto(post, new FlatmateMapper.SeekerView(mobileOf(author))), null);
    }

    private FlatmateModerationDetailDto ofRoom(FlatmateRoom room) {
        User host = user(room.getHostId());
        FlatmateReview review = reviews.findByRoomId(room.getId()).orElse(null);
        FlatmateMapper.RoomView view = roomCards
                .ownerViews(List.of(room), nameOf(host), mobileOf(host)).get(room.getId());
        return new FlatmateModerationDetailDto(
                FlatmateModerationQueueDto.of(room, nameOf(host)), mapper.toDto(room, view), null,
                null, reviewOf(review, host));
    }

    private FlatmateModerationDetailDto ofGroup(FlatmateGroup group) {
        User host = user(group.getHostId());
        FlatmateReview review = reviews.findByGroupId(group.getId()).orElse(null);
        FlatmateMapper.PartyView view = new FlatmateMapper.PartyView(nameOf(host),
                mobileOf(host), review == null ? null : review.getStatus());
        return new FlatmateModerationDetailDto(
                FlatmateModerationQueueDto.of(group, nameOf(host)), null, mapper.toDto(group, view),
                null, reviewOf(review, host));
    }

    private static FlatmateReviewDto reviewOf(FlatmateReview review, User host) {
        return review == null ? null
                : FlatmateReviewDto.of(review, nameOf(host), mobileOf(host));
    }

    private User user(UUID id) {
        return id == null ? null : users.findById(id).orElse(null);
    }

    private static String nameOf(User user) {
        return user == null ? null : user.getName();
    }

    private static String mobileOf(User user) {
        return user == null ? null : user.getMobile();
    }
}
