package com.draazy.api.services.support;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class IdentityDisputeController {

    private final IdentityDisputeService service;

    public IdentityDisputeController(IdentityDisputeService service) {
        this.service = service;
    }

    @PostMapping(Routes.Verification.IDENTITY_DISPUTE)
    @ResponseStatus(HttpStatus.CREATED)
    public IdentityDisputeResponse dispute(@CurrentUser AuthPrincipal principal,
            @RequestBody IdentityDisputeRequest body) {
        return service.open(principal, body);
    }
}
