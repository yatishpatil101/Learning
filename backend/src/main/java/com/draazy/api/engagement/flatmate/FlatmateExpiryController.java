package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class FlatmateExpiryController {

    private final FlatmateExpiryService service;

    public FlatmateExpiryController(FlatmateExpiryService service) {
        this.service = service;
    }

    @PostMapping(Routes.Flatmates.RENEW)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void renew(@CurrentUser AuthPrincipal principal,
            @PathVariable String kind, @PathVariable UUID id) {
        service.renew(principal, kind, id);
    }
}
