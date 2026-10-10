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

/** Paged because notifications accrue for years. */
@RestController
public class NotificationController {

    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    /** Strip client sort so unknown properties cannot reach the query as a 500. */
    @GetMapping(Routes.Engagement.NOTIFICATIONS)
    public PageResponse<NotificationResponse> list(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(
                notificationService.list(principal.userId(), Pageables.unsorted(pageable)),
                dto -> dto);
    }

    @GetMapping(Routes.Engagement.NOTIFICATIONS_UNREAD_COUNT)
    public CountResponse unreadCount(@CurrentUser AuthPrincipal principal) {
        return new CountResponse(notificationService.unreadCount(principal.userId()));
    }

    /** Reject malformed ids; skipping them could turn a typo into "mark all read". */
    @PostMapping(Routes.Engagement.NOTIFICATIONS_READ)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@CurrentUser AuthPrincipal principal,
            @RequestBody(required = false) MarkReadRequest request) {
        List<UUID> ids = (request != null && request.ids() != null)
                ? request.ids().stream().map(NotificationController::parseId).toList()
                : List.of();
        notificationService.markRead(principal.userId(), ids);
    }

    /** Foreign well-formed ids return 404, never 403, so status codes cannot probe the id space. */
    @DeleteMapping(Routes.Engagement.NOTIFICATION_BY_ID)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void dismiss(@CurrentUser AuthPrincipal principal, @PathVariable UUID id) {
        notificationService.dismiss(principal.userId(), id);
    }

    @PostMapping(Routes.Engagement.NOTIFICATIONS_DISMISS)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void dismissMany(@CurrentUser AuthPrincipal principal, @RequestBody MarkReadRequest request) {
        if (request.ids() == null || request.ids().isEmpty() || request.ids().size() > 100) {
            throw new BadRequestException("Send between 1 and 100 notification ids.");
        }
        notificationService.dismiss(principal.userId(),
                request.ids().stream().map(NotificationController::parseId).toList());
    }

    /** Body ids get 400 because the client sent a malformed list, not a missing resource path. */
    private static UUID parseId(String token) {
        return Ids.parseUuid(token)
                .orElseThrow(() -> new BadRequestException(
                        "Every id in the list must be a notification id."));
    }

    public record CountResponse(long count) {
    }
}
