package com.punenest.api.catalog.society;

import com.punenest.api.common.error.BadRequestException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.web.Ids;
import java.util.UUID;import org.springframework.stereotype.Component;

/**
 * Checks that a society id arriving on a request names a society that exists.
 *
 * <p>Any feature may let a user attach their post to a building from the catalogue, and every one of
 * them has to answer the same question about the id it was handed. This exists so that they answer
 * it identically: two endpoints that both take a society id should not disagree about what a stale
 * one means.
 *
 * <p><strong>Two different failures share this one guard</strong>, and on the flatmate path neither
 * was visible to the person who caused it.
 *
 * <p><strong>A malformed id was silently dropped.</strong> {@code FlatmateMapper} binds the field
 * through {@code uuidOrNull}, which is {@code Ids.parseUuid(value).orElse(null)} — so {@code "abc"},
 * or a slug sent where an id belongs, became {@code null} and the room was created <strong>201
 * Created, attached to no society at all</strong>. The host is told it worked, their room never
 * appears on the society's hub, and nothing anywhere records that they asked for one. Silent data
 * loss behind a success is worse than any error, so this is the half worth fixing first.
 *
 * <p><strong>A well-formed id naming nothing became a 409.</strong> It reached {@code saveAndFlush},
 * violated {@code flatmate_rooms_society_id_fkey}, and surfaced through {@code
 * GlobalExceptionHandler} as "That request conflicts with existing data" — a conflict message for a
 * request that conflicts with nothing, naming no field. {@code ListingEditRules.requireSociety}
 * already answered this for {@code properties} (D218) with {@code 404 Society}, and this answers it
 * the same way on purpose.
 *
 * <p>Not a duplicate of the foreign key. The FK stops the write; what it cannot do is stop it with
 * an error the caller can act on, and it never runs at all for the malformed case, because {@code
 * null} is a legal value for these columns — a society is optional wherever this is used, since a
 * room or a listing can be offered in a building the catalogue has never heard of.
 */
@Component
public class SocietyReference {

    private final SocietyRepository societies;

    public SocietyReference(SocietyRepository societies) {
        this.societies = societies;
    }

    /**
     * Passes silently for a blank or absent id, throws otherwise unless the society exists.
     *
     * @throws BadRequestException if the id is present but not a UUID
     * @throws NotFoundException if the id is well formed but names no society
     */
    public void require(String societyId) {
        String raw = societyId == null || societyId.isBlank() ? null : societyId.trim();
        if (raw == null) {
            return;
        }
        UUID parsed = Ids.parseUuid(raw)
                .orElseThrow(() -> new BadRequestException("societyId is not a valid id"));
        if (!societies.existsById(parsed)) {
            throw NotFoundException.of("Society");
        }
    }
}
