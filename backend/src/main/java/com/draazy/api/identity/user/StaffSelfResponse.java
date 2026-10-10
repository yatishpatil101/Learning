package com.draazy.api.identity.user;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record StaffSelfResponse(
        String id,
        String name,
        String mobile,
        String email,
        String role,
        List<String> permissions,
        List<String> desks) implements SessionUser {
}
