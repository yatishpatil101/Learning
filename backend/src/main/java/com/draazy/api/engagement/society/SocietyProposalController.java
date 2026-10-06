package com.draazy.api.engagement.society;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** One lifecycle (propose, ops, apply), so the server picks the route; signed-out readers never see the invite. */
@RestController
public class SocietyProposalController {

    private final SocietyProposalService proposals;

    public SocietyProposalController(SocietyProposalService proposals) {
        this.proposals = proposals;
    }

    /**
     * {@code POST /societies/{slug}/proposals} — propose a detail, the group link, or the pin.
     *
     * <p>201 rather than 200 even though a re-submission overwrites this author's own pending row:
     * from the caller's side a proposal has been lodged either way, and the distinction between
     * "created" and "corrected" is one the composer does not draw and the author does not care
     * about.
     *
     * <p>A detail suggestion is open to anyone signed in; the group link and the pin need a
     * verified flat, and the service says so in the 403.
     */
    @PostMapping(Routes.Societies.PROPOSALS)
    @ResponseStatus(HttpStatus.CREATED)
    public SocietyProposalResponse propose(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug, @Valid @RequestBody SocietyProposalRequest body) {
        return proposals.propose(slug, principal.userId(), body);
    }
}
