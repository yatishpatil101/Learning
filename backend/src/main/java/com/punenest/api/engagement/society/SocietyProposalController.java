package com.punenest.api.engagement.society;

import com.punenest.api.common.web.Routes;
import com.punenest.api.security.AuthPrincipal;
import com.punenest.api.security.CurrentUser;
import com.punenest.api.security.Roles;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /societies/{slug}/proposals} — what the community says this society is.
 *
 * <p>One resource for three things the hub used to keep in three {@code localStorage} keys: missing
 * details, the resident WhatsApp group, and a corrected map pin. They are one lifecycle — propose,
 * ops screen, apply — and a client that has to know which of three URLs a form posts to has been
 * handed a decision the server is better placed to make.
 *
 * <p>The read is public because the hub calls it before it knows who is looking; what it publishes
 * is not. A signed-out reader is told a resident group exists and is nudged to verify their flat,
 * and never sees the invite.
 */
@RestController
public class SocietyProposalController {

    private final SocietyProposalService proposals;

    public SocietyProposalController(SocietyProposalService proposals) {
        this.proposals = proposals;
    }

    /**
     * {@code GET /societies/{slug}/proposals} — every pending proposal plus the group's status.
     *
     * <p>One read rather than three, so the page cannot render half a state: a banner saying your
     * pin correction is pending beside a map that has already been corrected.
     */
    @GetMapping(Routes.Societies.PROPOSALS)
    public SocietyProposalsView view(@CurrentUser AuthPrincipal principal,
            @PathVariable String slug) {
        return proposals.view(slug, viewerId(principal), isStaff(principal));
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

    private static java.util.UUID viewerId(AuthPrincipal principal) {
        return principal == null ? null : principal.userId();
    }

    private static boolean isStaff(AuthPrincipal principal) {
        return principal != null
                && (Roles.Wire.STAFF.equals(principal.role())
                        || Roles.Wire.ADMIN.equals(principal.role()));
    }
}
