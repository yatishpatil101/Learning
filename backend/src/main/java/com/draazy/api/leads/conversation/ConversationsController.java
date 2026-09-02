package com.draazy.api.leads.conversation;

import com.draazy.api.common.attachment.MessageAttachmentDto;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * {@code /messages} — the in-app inbox.
 *
 * <p>No {@code @PreAuthorize} anywhere: every guard on this resource is about <em>who the caller is
 * to the other party</em>, not what role they hold, and roles cannot express that. The service owns
 * all four decisions.
 *
 * <p>The inbox is paged. It was a bare array on §5.1's "grows with one user's own activity"
 * reasoning, which holds for a seeker and fails for an owner: a row appears every time somebody
 * else enquires about their listing, so the collection is driven by demand rather than by the
 * caller.
 */
@RestController
public class ConversationsController {

    private final ConversationService service;

    /**
     * Opening a thread is a different use-case from carrying one on, and after §4.1 a different
     * service — see {@link ConversationOpeningService}. Only {@code POST /messages} reaches it.
     */
    private final ConversationOpeningService opening;

    public ConversationsController(ConversationService service, ConversationOpeningService opening) {
        this.service = service;
        this.opening = opening;
    }

    /**
     * {@code GET /messages} (contract {@code myMessages}) — paged.
     *
     * <p>Most-recent-first is fixed in the query, so a client sort is stripped rather than honoured;
     * see {@code ConversationRepository.inboxOf}.
     */
    @GetMapping(Routes.Conversations.BASE)
    public PageResponse<ConversationDto> inbox(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.inbox(principal, Pageables.unsorted(pageable)), c -> c);
    }

    /**
     * {@code POST /messages} (contract {@code startConversation}, spec fix S48).
     *
     * <p>201 when the thread was created, 200 when it already existed — hence {@code ResponseEntity}
     * rather than {@code @ResponseStatus}. Both carry the same body, so a client that ignores the
     * distinction still behaves correctly; one that honours it can tell a new chat from a resumed one
     * without a second request.
     */
    @PostMapping(Routes.Conversations.BASE)
    public ResponseEntity<ConversationDto> start(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ConversationCreate body) {
        ConversationOpeningService.Started started = opening.start(principal, body);
        return ResponseEntity
                .status(started.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(started.conversation());
    }

    /** {@code GET /messages/{id}} (contract {@code getConversation}). */
    @GetMapping(Routes.Conversations.BY_ID)
    public ConversationDto get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.get(principal, id);
    }

    /** {@code POST /messages/{id}/reply} (contract {@code replyConversation}) — 201. */
    @PostMapping(Routes.Conversations.REPLY)
    @ResponseStatus(HttpStatus.CREATED)
    public MessageDto reply(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody MessageCreate body) {
        return service.reply(principal, id, body.body(), body.attachments());
    }

    /**
     * {@code POST /messages/{id}/attachments} (contract {@code attachToConversation}) — 201.
     *
     * <p>Multipart, and {@code consumes} is pinned so a JSON body is refused with a 415 by the
     * routing table rather than by handler code — the same reason {@code MeDocumentsController}
     * pins it. The response is an attachment id the caller then names in a
     * {@link MessageCreate#attachments()}; the bytes are not visible to anyone until that reply
     * lands.
     */
    @PostMapping(value = Routes.Conversations.ATTACHMENTS,
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public MessageAttachmentDto attach(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestParam("file") MultipartFile file) {
        return service.attach(principal, id, file);
    }

    /** {@code POST /messages/{id}/read} (contract {@code readConversation}) — 204. */
    @PostMapping(Routes.Conversations.READ)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.markRead(principal, id);
    }

    /**
     * Contract schema {@code MessageCreate}.
     *
     * <p>{@code attachments} names uploads the caller has already made against this thread via
     * {@link #attach}; it is not a list of URLs and never was one, because a client-supplied
     * location stored and re-served by the platform is a request-forgery surface (D49). Each entry
     * is an attachment id, and the service refuses any that is not the caller's own, on this thread,
     * and unsent.
     *
     * <p>The size cap is duplicated from {@code MessageAttachmentUploads.MAX_PER_MESSAGE} rather
     * than referenced because {@code @Size} needs a constant expression; the service enforces the
     * same number, and that is the one that decides.
     */
    public record MessageCreate(
            @NotBlank @Size(max = 4000) String body,
            @Size(max = 5, message = "A message can carry at most 5 attachments")
            List<String> attachments) {
    }
}
