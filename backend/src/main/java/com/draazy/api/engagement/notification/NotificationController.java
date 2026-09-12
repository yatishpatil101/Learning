package com.draazy.api.engagement.notification;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.web.Ids;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /notifications} — the caller's notification inbox.
 *
 * <p>The only paged endpoint in this slice: notifications accrue with time and are never culled,
 * so a five-year user could have thousands. Everything else in this slice is a bare array per
 * api-standards.md §5.1.
 */
@RestController
public class NotificationController {

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    /**
     * {@code GET /notifications} (contract {@code listNotifications}) — paged, newest first.
     *
     * <p>Applies the shared {@link Pageables#unsorted(Pageable)} guard: Spring binds {@code ?sort=}
     * even when no sort parameter is in the spec, and an unknown property would propagate to the
     * query as a 500. Rebuilding the pageable strips it.
     */
    @GetMapping(Routes.Engagement.NOTIFICATIONS)
    public PageResponse<NotificationResponse> list(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                notificationService.list(principal.userId(), Pageables.unsorted(pageable)),
                dto -> dto);
    }

    /**
     * {@code POST /notifications/read} (contract {@code markNotificationsRead}) — 204.
     *
     * <p>Body is optional: absent or empty ids means "mark all of the caller's notifications read".
     * This matches the frontend mock's {@code markAllNotifsRead} function.
     *
     * <p>A malformed id is rejected with a 400 rather than skipped. Skipping would be worse than it
     * sounds: if every id in the list were unparseable the list would arrive empty, and an empty
     * list is the signal for "mark <em>all</em> read" — so a typo would silently clear the whole
     * inbox. Raw {@link UUID#fromString} is not an option either; it throws
     * {@link IllegalArgumentException}, which the global handler can only render as a 500.
     */
    @PostMapping(Routes.Engagement.NOTIFICATIONS_READ)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@CurrentUser AuthPrincipal principal,
            @RequestBody(required = false) MarkReadRequest request) {
        List<UUID> ids = (request != null && request.ids() != null)
                ? request.ids().stream().map(NotificationController::parseId).toList()
                : List.of();
        notificationService.markRead(principal.userId(), ids);
    }

    /**
     * {@code DELETE /notifications/{id}} (contract {@code dismissNotification}) — 204.
     *
     * <p>Dismisses one notification: a hard delete, scoped to the caller. A non-UUID id is answered
     * 404 by the shared path-id handler, and a well-formed id that is not the caller's own is also
     * 404 (never 403) — the resource-scoping convention {@code deleteSavedSearch} uses, so an id
     * space cannot be probed by status code.
     */
    @DeleteMapping(Routes.Engagement.NOTIFICATION_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void dismiss(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        notificationService.dismiss(principal.userId(), id);
    }

    /**
     * Parse a notification id, or reject the request.
     *
     * <p><strong>400, and deliberately not the 404 that {@link Ids} prescribes.</strong> That rule
     * governs ids in the <em>path</em>: {@code GET /properties/{id}} with a non-UUID is answered 404
     * because the caller named a resource that does not exist, and a 400 there would tell a prober
     * that the id space is UUIDs and that their string was rejected before any authorisation ran.
     * None of that applies here. The id arrives as an element of a request body, the endpoint it
     * addresses exists, and there is nothing to be 404. A malformed body field is a bad request,
     * which is what this says (tech-debt D74 — the divergence was flagged as an inconsistency; it is
     * a different question with a different answer, and the reasoning is recorded here so it is not
     * flagged a third time).
     *
     * <p>The offending token is <em>not</em> echoed back. It told the caller nothing they did not
     * already know — they sent it — and reflecting unvalidated input into a response body is a habit
     * worth not having, however inert it is behind JSON encoding.
     *
     * @throws BadRequestException if the token is not a UUID
     */
    private static UUID parseId(String token) {
        return Ids.parseUuid(token)
                .orElseThrow(() -> new BadRequestException(
                        "Every id in the list must be a notification id."));
    }
}
