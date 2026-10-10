package com.draazy.api.identity.user;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record SelfResponse(
        String id,
        String name,
        String mobile,
        String email,
        String role,
        boolean verified,
        String city,
        boolean verifiedContactOnly,
        boolean hideNumber,
        boolean shareActivityStatus,
        boolean shareReadReceipts,
        int listingsCount,
        List<String> permissions,
        List<String> desks) implements SessionUser {
}
