package com.draazy.api.engagement.society;

import com.draazy.api.common.web.PageResponse;

/** Each section is exactly what that section's own read answered before the hub merged them, or null when it could not be read. */
public record SocietyHubResponse(
        SocietyMembership membership,
        PageResponse<SocietyQuestionResponse> questions,
        PageResponse<SocietyBoardItemResponse> board,
        PageResponse<SocietyContributionResponse> contributions,
        SocietyProposalsView proposals) {
}
