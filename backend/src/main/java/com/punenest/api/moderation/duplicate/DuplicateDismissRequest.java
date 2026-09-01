package com.punenest.api.moderation.duplicate;

import jakarta.validation.constraints.NotEmpty;
import java.util.List;

/**
 * "These are not the same flat."
 *
 * @param ids the cluster's members, as the operator saw them. The server derives the signature from
 *            these rather than accepting one, so the verdict is recorded against the set that was
 *            actually on screen — and a cluster that has since gained a member is a different set,
 *            which correctly comes back unanswered.
 */
public record DuplicateDismissRequest(@NotEmpty List<String> ids) {
}
