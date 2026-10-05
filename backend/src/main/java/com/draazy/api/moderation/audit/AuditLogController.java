package com.draazy.api.moderation.audit;

import com.draazy.api.common.audit.AuditLog;
import com.draazy.api.common.audit.AuditLogRepository;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

// Admin-only by design: the audit trail holds privileged users to account.
@RestController
public class AuditLogController {

    private static final ObjectMapper METADATA_JSON = JsonMapper.builder().build();
    private static final TypeReference<Map<String, Object>> METADATA_TYPE = new TypeReference<>() {
    };

    private final AuditLogRepository repository;
    private final UserRepository users;

    public AuditLogController(AuditLogRepository repository, UserRepository users) {
        this.repository = repository;
        this.users = users;
    }

    // entityId makes the log useful for a case; time-only browsing is for daily review.
    @GetMapping(Routes.Admin.AUDIT_LOG)
    @PreAuthorize("hasRole('" + Roles.ADMIN + "') and "
            + BackOfficePermissions.REQUIRE_AUDIT_READ)
    public PageResponse<AuditEntryResponse> list(
            @RequestParam(required = false) String actor,
            @RequestParam(required = false) String entity,
            @RequestParam(required = false) String entityId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @PageableDefault(size = 20) Pageable pageable) {
        Page<AuditLog> rows = repository.search(actor, entity, entityId, from, to,
                Pageables.unsorted(pageable));
        Map<String, String> names = actorNames(rows);
        return PageResponse.of(rows, row -> toResponse(row, names));
    }

    private Map<String, String> actorNames(Page<AuditLog> rows) {
        Set<UUID> ids = new HashSet<>();
        for (AuditLog row : rows) {
            UUID id = uuidOrNull(row.getActor());
            if (id != null) {
                ids.add(id);
            }
        }
        Map<String, String> names = new HashMap<>();
        if (!ids.isEmpty()) {
            for (User u : users.findAllById(ids)) {
                names.put(u.getId().toString(), u.getName());
            }
        }
        return names;
    }

    private static UUID uuidOrNull(String actor) {
        try {
            return actor == null ? null : UUID.fromString(actor);
        } catch (IllegalArgumentException notAUserId) {
            return null;
        }
    }

    private static AuditEntryResponse toResponse(AuditLog row, Map<String, String> names) {
        String name = names.get(row.getActor());
        return new AuditEntryResponse(
                row.getId().toString(),
                row.getActor(),
                name == null || name.isBlank() ? row.getActor() : name,
                row.getActorRole(),
                row.getAction(),
                row.getEntity(),
                row.getEntityId(),
                row.getChecker(),
                row.getAt(),
                metadata(row.getMetadata()));
    }

    // Bad metadata must not hide the rest of the log when an operator is investigating.
    private static Map<String, Object> metadata(String raw) {
        if (raw == null || raw.isBlank()) {
            return Map.of();
        }
        try {
            return METADATA_JSON.readValue(raw, METADATA_TYPE);
        } catch (RuntimeException unparseable) {
            return Map.of();
        }
    }
}
