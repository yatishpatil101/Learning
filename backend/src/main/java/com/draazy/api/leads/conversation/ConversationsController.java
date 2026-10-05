package com.draazy.api.leads.conversation;

import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

// Role guards cannot express conversation access; participant checks do.
@RestController
@Validated
public class ConversationsController {

    private final ConversationService service;

    // Opening a thread has separate trust rules from carrying one on.
    private final ConversationOpeningService opening;

    public ConversationsController(ConversationService service, ConversationOpeningService opening) {
        this.service = service;
        this.opening = opening;
    }

    @GetMapping(Routes.Conversations.BASE)
    public PageResponse<ConversationDto> inbox(@CurrentUser AuthPrincipal principal,
            @PageableDefault(size = 20) Pageable pageable) {
        return PageResponse.of(service.inbox(principal, Pageables.unsorted(pageable)), c -> c);
    }

    @GetMapping(Routes.Conversations.UNREAD_COUNT)
    public ConversationService.UnreadCount unreadCount(@CurrentUser AuthPrincipal principal) {
        return service.unreadCount(principal);
    }

    @GetMapping(Routes.Conversations.STREAM)
    public ResponseEntity<SseEmitter> stream(@CurrentUser AuthPrincipal principal) {
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_EVENT_STREAM)
                .header("X-Accel-Buffering", "no")
                .header(HttpHeaders.CACHE_CONTROL, "no-cache")
                .body(service.stream(principal));
    }

    @PostMapping(Routes.Conversations.BASE)
    public ResponseEntity<ConversationDto> start(@CurrentUser AuthPrincipal principal,
            @Valid @RequestBody ConversationCreate body) {
        ConversationOpeningService.Started started = opening.start(principal, body);
        return ResponseEntity
                .status(started.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(started.conversation());
    }

    @GetMapping(Routes.Conversations.BY_ID)
    public ConversationDto get(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        return service.get(principal, id);
    }

    @PostMapping(Routes.Conversations.REPLY)
    public ResponseEntity<MessageDto> reply(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @Valid @RequestBody MessageCreate body) {
        ConversationService.Sent sent = service.reply(principal, id,
                new ConversationService.ReplyCreate(body.body(), body.clientId(), body.replyToId()));
        return ResponseEntity.status(sent.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(sent.message());
    }

    @PostMapping(value = Routes.Conversations.PHOTOS, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<MessageDto> photo(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "clientId", required = false) @Size(max = 120) String clientId,
            @RequestParam(value = "caption", required = false) @Size(max = 1000) String caption) {
        ConversationService.Sent sent = service.photo(principal, id,
                new ConversationService.PhotoCreate(file, clientId, caption));
        return ResponseEntity.status(sent.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(sent.message());
    }

    @PostMapping(Routes.Conversations.READ)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.markRead(principal, id);
    }

    @PostMapping(Routes.Conversations.TYPING)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void typing(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.typing(principal, id);
    }

    @PatchMapping(Routes.Conversations.STATE)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void state(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @RequestBody ConversationService.ThreadState body) {
        service.updateState(principal, id, body);
    }

    @DeleteMapping(Routes.Conversations.ITEM)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteForMe(@CurrentUser AuthPrincipal principal, @PathVariable String id,
            @PathVariable String messageId) {
        service.deleteForMe(principal, id, messageId);
    }

    @PostMapping(Routes.Conversations.BLOCK)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void block(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.block(principal, id);
    }

    @DeleteMapping(Routes.Conversations.BLOCK)
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unblock(@CurrentUser AuthPrincipal principal, @PathVariable String id) {
        service.unblock(principal, id);
    }

    @PostMapping(Routes.Conversations.FLATMATE_GROUP)
    public ConversationDto openGroup(@CurrentUser AuthPrincipal principal,
            @PathVariable String groupId) {
        return service.openGroup(principal, groupId);
    }

    @PostMapping(Routes.Conversations.FLATMATE_REQUEST)
    public ConversationDto openForFlatmateRequest(@CurrentUser AuthPrincipal principal,
            @PathVariable String requestId) {
        return opening.openForFlatmateRequest(principal, requestId);
    }

    public record MessageCreate(@NotBlank @Size(max = 4000) String body,
            @Size(max = 120) String clientId, String replyToId) {
    }
    }
