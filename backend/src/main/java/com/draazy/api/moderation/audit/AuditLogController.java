package com.draazy.api.moderation.audit;

import com.draazy.api.common.audit.AuditLog;
import com.draazy.api.common.audit.AuditLogRepository;
import com.draazy.api.common.web.PageResponse;
import com.draazy.api.common.web.Pageables;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.BackOfficePermissions;
import com.draazy.api.security.Roles;
import java.time.Instant;
import java.util.Map;
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

/**
 * {@code GET /admin/audit-log} (contract {@code adminAuditLog}) — the maker-checker trail.
 *
 * <p><strong>Admin only, not staff</strong>, and that is a deliberate departure from the rest of the
 * Moderation surface, which staff can read. The log's whole purpose is to hold privileged users to
 * account; a staff member who can both act and read the record of their own actions has been handed
 * the means to check whether anyone noticed. Read access here is therefore narrower than write
 * access to the things it records.
 *
 * <p>Read-only by construction: there is no write endpoint, no update and no delete. Rows arrive
 * only through {@code AuditService}, whose entity has no {@code updated_at} and marks every column
 * {@code updatable = false}.
 */
@RestController
public class AuditLogController {

    private static final ObjectMapper METADATA_JSON = JsonMapper.builder().build();
    private static final TypeReference<Map<String, Object>> METADATA_TYPE = new TypeReference<>() {
    };

    private final AuditLogRepository repository;

    public AuditLogController(AuditLogRepository repository) {
        this.repository = repository;
    }

    /**
     * <p>{@code entityId} narrows the trail to one record — typically one person, since
     * {@code entity=user} plus their id is how the user directory answers "what has happened to
     * this account". Without it the log is only browsable by time, which is fine for the daily
     * review and useless for a case.
     */
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
        return PageResponse.of(
                repository.search(actor, entity, entityId, from, to, Pageables.unsorted(pageable)),
                AuditLogController::toResponse);
    }

    private static AuditEntryResponse toResponse(AuditLog row) {
        return new AuditEntryResponse(
                row.getId().toString(),
                row.getActor(),
                row.getActorRole(),
                row.getAction(),
                row.getEntity(),
                row.getEntityId(),
                row.getChecker(),
                row.getAt(),
                metadata(row.getMetadata()));
    }

    /**
     * A row whose metadata cannot be parsed must not take the whole page down with it. The audit log
     * is the surface an operator reaches for when something has already gone wrong, so degrading to
     * an empty context object is strictly better than a 500 that hides every other entry.
     */
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
