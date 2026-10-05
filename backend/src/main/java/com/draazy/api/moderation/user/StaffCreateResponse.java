package com.draazy.api.moderation.user;

import com.draazy.api.identity.user.UserResponse;

public record StaffCreateResponse(UserResponse user, String inviteUrl) {
}
