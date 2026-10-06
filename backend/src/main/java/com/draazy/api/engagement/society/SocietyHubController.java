package com.draazy.api.engagement.society;

import com.draazy.api.catalog.society.SocietyRepository;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AccountPermissions;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import java.util.UUID;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Sections are isolated: one that cannot be read is null and does not blank the rest. */
@RestController
public class SocietyHubController {

    private static final Logger log = LoggerFactory.getLogger(SocietyHubController.class);

    private static final int QUESTIONS_SIZE = 20;
    private static final int BOARD_SIZE = 20;
    private static final int CONTRIBUTIONS_SIZE = 50;

    private final SocietyRepository societies;
    private final SocietyMembershipService memberships;
    private final SocietyCommunityService community;
    private final SocietyContributionService contributions;
    private final SocietyProposalService proposals;
    private final AccountPermissions permissions;
    private final int maxPageSize;

    public SocietyHubController(SocietyRepository societies, SocietyMembershipService memberships,
            SocietyCommunityService community, SocietyContributionService contributions,
            SocietyProposalService proposals, AccountPermissions permissions,
            @Value("${spring.data.web.pageable.max-page-size:100}") int maxPageSize) {
        this.societies = societies;
        this.memberships = memberships;
        this.community = community;
        this.contributions = contributions;
        this.proposals = proposals;
        this.permissions = permissions;
        this.maxPageSize = maxPageSize;
    }

    @GetMapping(Routes.Societies.HUB)
    public SocietyHubResponse hub(@CurrentUser AuthPrincipal principal, @PathVariable String slug,
            @RequestParam(required = false) String kind,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        societies.findBySlug(slug).orElseThrow(() -> NotFoundException.of("Society"));

        UUID viewer = principal != null ? principal.userId() : null;
        boolean backOffice = principal != null && Roles.isBackOffice(principal.role());
        boolean moderator = backOffice
                && permissions.granted(principal, BackOfficePermissions.SOCIETIES_WRITE);

        return new SocietyHubResponse(
                section("membership", () -> memberships.membership(slug, viewer)),
                section("questions", () -> PageResponse.of(
                        community.questions(slug, paging(page, size, QUESTIONS_SIZE)), q -> q)),
                section("board", () -> PageResponse.of(
                        community.board(slug, kind, viewer, moderator,
                                paging(page, size, BOARD_SIZE)), b -> b)),
                section("contributions", () -> PageResponse.of(
                        contributions.list(slug, viewer, moderator,
                                paging(page, size, CONTRIBUTIONS_SIZE)), c -> c)),
                section("proposals", () -> proposals.view(slug, viewer, backOffice)));
    }

    // What the standard Pageable argument does, for a read whose default differs per section.
    private Pageable paging(Integer page, Integer size, int fallback) {
        int pageSize = size == null || size < 1 ? fallback : Math.min(size, maxPageSize);
        return PageRequest.of(page == null ? 0 : Math.max(page, 0), pageSize);
    }

    private static <T> T section(String name, Supplier<T> read) {
        try {
            return read.get();
        } catch (RuntimeException e) {
            log.warn("society hub section {} failed; it is returned as null", name, e);
            return null;
        }
    }
}
