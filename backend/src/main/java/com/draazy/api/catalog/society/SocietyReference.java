package com.draazy.api.catalog.society;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Ids;
import java.util.UUID;import org.springframework.stereotype.Component;

/** Single guard so every endpoint answers a stale society id with 404; a malformed id is rejected rather than
 * silently nulled by {@code uuidOrNull}, which would 201 a room attached to no society. */
@Component
public class SocietyReference {

    private final SocietyRepository societies;

    public SocietyReference(SocietyRepository societies) {
        this.societies = societies;
    }

    /** Passes silently for a blank or absent id; a non-UUID is a bad request, an unknown or archived society a not-found. */
    public void require(String societyId) {
        nameOf(societyId);
    }

    public record Binding(UUID id, String name) {
    }

    /** PATCH semantics: null keeps the binding, blank removes it, and an id is checked only when it changes, so a post bound to an archived society stays editable. */
    public Binding rebind(UUID currentId, String currentName, String societyId) {
        if (societyId == null) {
            return new Binding(currentId, currentName);
        }
        if (societyId.isBlank()) {
            return new Binding(null, null);
        }
        UUID parsed = Ids.parseUuid(societyId.trim())
                .orElseThrow(() -> new BadRequestException("societyId is not a valid id"));
        if (parsed.equals(currentId)) {
            return new Binding(currentId, currentName);
        }
        return new Binding(parsed, nameOf(societyId));
    }

    /** The one source of the free-text "society" a room or managed record shows, so a client never types it. */
    public String nameOf(String societyId) {
        String raw = societyId == null || societyId.isBlank() ? null : societyId.trim();
        if (raw == null) {
            return null;
        }
        UUID parsed = Ids.parseUuid(raw)
                .orElseThrow(() -> new BadRequestException("societyId is not a valid id"));
        return societies.findById(parsed).filter(s -> s.getArchivedAt() == null)
                .orElseThrow(() -> NotFoundException.of("Society"))
                .getName();
    }
}
