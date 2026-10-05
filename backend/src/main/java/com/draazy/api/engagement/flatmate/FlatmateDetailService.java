package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FlatmateDetailService {

    private final FlatmateGroupRepository groups;
    private final FlatmateRoomRepository rooms;
    private final FlatmateSeekerPostRepository posts;
    private final FlatmateRoomCards cards;
    private final FlatmateReviewStatuses reviewStatuses;
    private final FlatmateReviewRepository reviews;
    private final FlatmateMapper mapper;
    private final UserRepository users;

    FlatmateDetailService(FlatmateGroupRepository groups, FlatmateRoomRepository rooms,
            FlatmateSeekerPostRepository posts, FlatmateRoomCards cards,
            FlatmateReviewStatuses reviewStatuses, FlatmateReviewRepository reviews,
            FlatmateMapper mapper, UserRepository users) {
        this.groups = groups;
        this.rooms = rooms;
        this.posts = posts;
        this.cards = cards;
        this.reviewStatuses = reviewStatuses;
        this.reviews = reviews;
        this.mapper = mapper;
        this.users = users;
    }

    @Transactional(readOnly = true)
    public FlatmateDetailDto group(AuthPrincipal caller, UUID id) {
        FlatmateGroup group = groups.findById(id).filter(g -> !g.isArchived())
                .filter(g -> g.isVisible() || isHost(caller, g.getHostId()))
                .orElseThrow(() -> NotFoundException.of("Group"));
        String verdict = reviewStatuses.forGroups(List.of(group)).get(group.getId());
        if (isHost(caller, group.getHostId())) {
            User me = users.findById(caller.userId()).orElse(null);
            FlatmateGroupDto dto = mapper.toDto(group,
                    new FlatmateMapper.PartyView(nameOf(me), mobileOf(me), verdict));
            return FlatmateDetailDto.owned(FlatmateDetailDto.KIND_GROUP,
                    withConsentMobile(dto, group.getOwnerConsentMobile()), List.of(),
                    reviews.findByGroupId(group.getId()).map(FlatmateDetailDto.Verification::of)
                            .orElse(null));
        }
        String hostName = users.findById(group.getHostId()).map(User::getName).orElse(null);
        return FlatmateDetailDto.visitor(FlatmateDetailDto.KIND_GROUP,
                mapper.toFeedDto(group, FlatmateMapper.PartyView.anonymous(hostName, verdict)),
                List.of());
    }

    @Transactional(readOnly = true)
    public FlatmateDetailDto room(AuthPrincipal caller, UUID id) {
        FlatmateRoom room = rooms.findById(id).filter(r -> !r.isArchived())
                .filter(r -> r.isVisible() || isHost(caller, r.getHostId()))
                .orElseThrow(() -> NotFoundException.of("Room"));
        List<String> photos = List.copyOf(room.getPhotos());
        if (isHost(caller, room.getHostId())) {
            User me = users.findById(caller.userId()).orElse(null);
            Optional<FlatmateReview> review = reviews.findByRoomId(room.getId());
            FlatmateMapper.RoomView view = cards.ownerViews(List.of(room), nameOf(me), mobileOf(me))
                    .get(room.getId()).withHost(hostAnswers(room, review));
            return FlatmateDetailDto.owned(FlatmateDetailDto.KIND_ROOM,
                    mapper.toDto(room, view), photos,
                    review.map(FlatmateDetailDto.Verification::of).orElse(null));
        }
        return FlatmateDetailDto.visitor(FlatmateDetailDto.KIND_ROOM,
                cards.render(List.of(room)).get(0), photos);
    }

    @Transactional(readOnly = true)
    public FlatmateDetailDto post(AuthPrincipal caller, UUID id) {
        FlatmateSeekerPost post = posts.findById(id).filter(p -> !p.isArchived())
                .filter(p -> p.isVisible() || isHost(caller, p.getUserId()))
                .orElseThrow(() -> NotFoundException.of("Flatmate post"));
        if (isHost(caller, post.getUserId())) {
            String mobile = users.findById(caller.userId()).map(User::getMobile).orElse(null);
            return FlatmateDetailDto.owned(FlatmateDetailDto.KIND_POST,
                    mapper.toDto(post, new FlatmateMapper.SeekerView(mobile)), List.of(), null);
        }
        return FlatmateDetailDto.visitor(FlatmateDetailDto.KIND_POST,
                mapper.toDto(post, FlatmateMapper.SeekerView.ANONYMOUS), List.of());
    }

    private static boolean isHost(AuthPrincipal caller, UUID hostId) {
        return caller != null && caller.userId() != null && caller.userId().equals(hostId);
    }

    private static FlatmateRoomDto.Host hostAnswers(FlatmateRoom room, Optional<FlatmateReview> review) {
        AgreementRegistration agreement = review.map(FlatmateReview::getAgreement)
                .orElseGet(AgreementRegistration::new);
        return new FlatmateRoomDto.Host(room.getDetails(),
                review.map(FlatmateReview::getAgreementDoc).map(FlatmateDetailService::withoutBytes)
                        .orElse(null),
                agreement.getRegNo(), agreement.getRegisteredOn(), agreement.getValidTill(),
                room.getOwnerConsentMobile());
    }

    private static Map<String, Object> withoutBytes(Map<String, Object> doc) {
        Map<String, Object> named = new LinkedHashMap<>();
        for (String key : List.of("id", "name", "mime", "size")) {
            if (doc.get(key) != null) {
                named.put(key, doc.get(key));
            }
        }
        return named;
    }

    private static FlatmateGroupDto withConsentMobile(FlatmateGroupDto d, String mobile) {
        return new FlatmateGroupDto(d.id(), d.title(), d.locality(), d.policy(), d.rent(), d.deposit(),
                d.noticePeriodDays(), d.lockInMonths(), d.maintenanceBilling(), d.electricityBilling(),
                d.perHead(), d.seatsTotal(), d.seatsOpen(), d.members(), d.propertyId(), d.hostRole(),
                d.verificationTier(), d.agreementDeclared(), d.ownerConsent(), mobile, d.reviewStatus(),
                d.addressFingerprint(), d.flagForReview(), d.modStatus(), d.tags(), d.note(),
                d.ownerName(), d.ownerMobile(), d.createdAt(), d.preferences());
    }

    private static String nameOf(User user) {
        return user == null ? null : user.getName();
    }

    private static String mobileOf(User user) {
        return user == null ? null : user.getMobile();
    }
}
