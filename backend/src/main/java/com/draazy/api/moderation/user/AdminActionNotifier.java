package com.draazy.api.moderation.user;

import com.draazy.api.common.trust.Notifier;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import org.springframework.stereotype.Component;

@Component
class AdminActionNotifier {

    private static final String TYPE = "team.manager-action";
    private static final String LINK = "/admin/team";

    private final UserRepository users;
    private final Notifier notifier;

    AdminActionNotifier(UserRepository users, Notifier notifier) {
        this.users = users;
        this.notifier = notifier;
    }

    void managerAction(AuthPrincipal actor, String action, User target) {
        if (!Roles.Wire.MANAGER.equals(actor.role())) {
            return;
        }
        users.findLiveByRole(Roles.Wire.ADMIN).stream().findFirst()
                .ifPresent(admin -> notifier.notify(admin.getId(), TYPE, "Manager changed team access",
                        action + ": " + target.getName(), LINK));
    }
}
