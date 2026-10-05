package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class FlatmateDetailController {

    private final FlatmateDetailService service;

    public FlatmateDetailController(FlatmateDetailService service) {
        this.service = service;
    }

    @GetMapping(Routes.Flatmates.GROUP_BY_ID)
    public FlatmateDetailDto group(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        return service.group(principal, id);
    }

    @GetMapping(Routes.Flatmates.ROOM_BY_ID)
    public FlatmateDetailDto room(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        return service.room(principal, id);
    }

    @GetMapping(Routes.Flatmates.POST_BY_ID)
    public FlatmateDetailDto post(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        return service.post(principal, id);
    }
}
