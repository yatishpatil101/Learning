package com.draazy.api.content;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.Roles;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * CMS authoring (contract tag {@code Admin &amp; Analytics}, five operations).
 *
 * <p>Staff and admin both, because keeping the FAQ list current is ops work, not a privileged one.
 * The class-level {@code @PreAuthorize} is what enforces that — {@code SecurityConfig} only
 * requires authentication for {@code /admin/**}, and a per-method annotation on five methods is
 * five chances to forget one.
 *
 * <p><strong>The per-account atoms (D192/D13) do have to be per method</strong>, because the split
 * they exist to express is read from write and that is not a property of the class. Each method
 * annotation therefore repeats the role term: a method-level {@code @PreAuthorize} replaces the
 * class-level one rather than adding to it, so dropping the role here would have quietly turned the
 * narrowing into a substitution — the exact failure the whole slice is written to prevent. The
 * class-level annotation is kept as the answer for any method added without one.
 */
@RestController
@PreAuthorize("hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')")
public class AdminContentController {

    private static final String STAFF_OR_ADMIN =
            "hasAnyRole('" + Roles.STAFF + "', '" + Roles.ADMIN + "')";
    private static final String CONTENT_READ =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_CONTENT_READ;
    private static final String CONTENT_WRITE =
            STAFF_OR_ADMIN + " and " + BackOfficePermissions.REQUIRE_CONTENT_WRITE;

    private final AdminContentService service;

    public AdminContentController(AdminContentService service) {
        this.service = service;
    }

    /** {@code GET /admin/content/{type}} (contract {@code adminListContent}). */
    @GetMapping(Routes.Admin.CONTENT)
    @PreAuthorize(CONTENT_READ)
    public List<ContentItem> list(@PathVariable String type) {
        return service.list(type);
    }

    /** {@code POST /admin/content/{type}} (contract {@code adminCreateContent}). */
    @PostMapping(Routes.Admin.CONTENT)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize(CONTENT_WRITE)
    public ContentItem create(@CurrentUser AuthPrincipal principal, @PathVariable String type,
            @Valid @RequestBody ContentWrite body) {
        return service.create(principal, type, body);
    }

    /** {@code PATCH /admin/content/{type}/{id}} (contract {@code adminUpdateContent}). */
    @PatchMapping(Routes.Admin.CONTENT_ITEM)
    @PreAuthorize(CONTENT_WRITE)
    public ContentItem update(@CurrentUser AuthPrincipal principal, @PathVariable String type,
            @PathVariable String id, @Valid @RequestBody ContentWrite body) {
        return service.update(principal, type, id, body);
    }

    /** {@code POST /admin/content/{type}/{id}/archive} (contract {@code adminArchiveContent}). */
    @PostMapping(Routes.Admin.CONTENT_ARCHIVE)
    @PreAuthorize(CONTENT_WRITE)
    public ContentItem archive(@CurrentUser AuthPrincipal principal, @PathVariable String type,
            @PathVariable String id) {
        return service.archive(principal, type, id);
    }

    /** {@code POST /admin/content/{type}/{id}/restore} (contract {@code adminRestoreContent}). */
    @PostMapping(Routes.Admin.CONTENT_RESTORE)
    @PreAuthorize(CONTENT_WRITE)
    public ContentItem restore(@CurrentUser AuthPrincipal principal, @PathVariable String type,
            @PathVariable String id) {
        return service.restore(principal, type, id);
    }
}
