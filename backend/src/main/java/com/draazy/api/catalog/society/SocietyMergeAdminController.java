package com.draazy.api.catalog.society;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /admin/society-merges} — ops folding a duplicate society into the one that survives it.
 *
 * <p>The fifth society queue answered out of the operator's own browser, and the one whose
 * browser-locality did visible damage rather than merely nothing. The other four were empty; this
 * one produced <em>divergent</em> answers. {@code mergeSocieties()} wrote to {@code localStorage},
 * so a second operator opening the candidates queue saw the same duplicate pair untouched, merged it
 * again, and could pick the opposite survivor without either of them ever finding out. Meanwhile the
 * duplicate stayed in the public directory splitting one building's listings, followers and reviews
 * across two cards.
 *
 * <p>Guarded by the same {@code societies:read} / {@code societies:write} atoms as the candidates,
 * claims, proposals and residents desks. A merge is a harder decision than the other four and it is
 * tempting to gate it more tightly, but a sixth atom would leave every existing ops account silently
 * unable to finish a job it already does — they reach a duplicate pair through the candidates queue,
 * which they can already clear. The protection against a bad merge is that it is reversible, not
 * that fewer people can make one.
 */
@RestController
public class SocietyMergeAdminController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";

    private static final String SOCIETIES_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_SOCIETIES_READ;

    private static final String SOCIETIES_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_SOCIETIES_WRITE;

    private final SocietyMergeService merges;

    public SocietyMergeAdminController(SocietyMergeService merges) {
        this.merges = merges;
    }

    /**
     * {@code GET /admin/society-merges} — every merge in force, newest first.
     *
     * <p>Newest first, and deliberately the other way round from the four work queues beside it.
     * Those are backlogs, where the oldest item is the one somebody is still waiting on. This is not
     * a backlog: it is a record of decisions already taken, and the one an operator comes here to
     * check is almost always the one just made — either their own, or the one that explains why a
     * society they were about to merge has vanished.
     */
    @GetMapping(Routes.SocietyMerges.BASE)
    @PreAuthorize(SOCIETIES_READ)
    public PageResponse<SocietyMergeResponse> list(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(merges.list(Pageables.unsorted(pageable)), m -> m);
    }

    /**
     * {@code POST /admin/society-merges} — record that one society is a duplicate of another.
     *
     * <p>201, because a merge is a thing that now exists and can be listed and deleted — not a
     * mutation of either society. Both slugs travel in the body rather than one of them in the path:
     * the two are not subject and object, they are the two halves of one statement, and putting
     * either in the path would suggest the request is an edit of that society.
     *
     * <p>422 for merging a society into itself, 409 for the two shapes of chain (merging into a
     * society that is itself merged away, or merging away one that has absorbed others) and for
     * losing a race with another operator. Each 409 names the merge that has to be undone first, so
     * the operator's next action is one corrected request rather than an investigation.
     */
    @PostMapping(Routes.SocietyMerges.BASE)
    @PreAuthorize(SOCIETIES_WRITE)
    @ResponseStatus(HttpStatus.CREATED)
    public SocietyMergeResponse merge(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody SocietyMergeRequest request) {
        return merges.merge(request, principal);
    }

    /**
     * {@code DELETE /admin/society-merges/{slug}} — undo one, addressed by the slug of the society
     * that was merged away.
     *
     * <p>This route is the reason the merge is a pointer rather than a rewrite of every row that
     * referenced the duplicate. The operator's input is two societies that differ by a typo, so
     * merging the wrong pair — or the right pair the wrong way round — is a mistake that will be
     * made. Here it costs one request; under a rewrite it would have cost a data recovery, because
     * nothing would record which listings had moved.
     *
     * <p>204, and 404 when the slug names a society that is not merged into anything: the resource
     * being deleted is the merge, and there is no merge here to delete.
     */
    @DeleteMapping(Routes.SocietyMerges.BY_SLUG)
    @PreAuthorize(SOCIETIES_WRITE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void undo(@CurrentUser AuthPrincipal principal, @PathVariable String slug) {
        merges.undo(slug, principal);
    }
}
