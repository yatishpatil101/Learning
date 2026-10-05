package com.draazy.api.engagement.flatmate;

public record FlatmateModerationDetailDto(
        FlatmateModerationQueueDto item,
        FlatmateRoomDto room,
        FlatmateGroupDto group,
        FlatmateSeekerPostDto post,
        FlatmateReviewDto review) {
}
