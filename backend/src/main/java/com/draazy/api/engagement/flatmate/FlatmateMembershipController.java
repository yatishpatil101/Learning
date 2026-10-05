package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class FlatmateMembershipController {

    private final FlatmateMembershipService service;

    public FlatmateMembershipController(FlatmateMembershipService service) {
        this.service = service;
    }

    @DeleteMapping(Routes.Flatmates.GROUP_MEMBERSHIP)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void leave(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        service.leave(principal, id);
    }

    @DeleteMapping(Routes.Flatmates.GROUP_MEMBER)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void remove(@CurrentUser AuthPrincipal principal, @PathVariable UUID id,
            @PathVariable UUID memberId) {
        service.remove(principal, id, memberId);
    }
}
