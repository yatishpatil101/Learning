package com.punenest.api.catalog.society;

import com.punenest.api.common.error.NotFoundException;

/**
 * Following a merge pointer — the one definition of "which society is this slug really?".
 *
 * <p><strong>Why this is a single lookup and not a traversal.</strong> {@link SocietyMergeService}
 * refuses both shapes of chain: it will not merge into a society that is itself merged away, and it
 * will not merge away a society that has absorbed others. So {@code merged_into} is a forest of
 * depth one and this needs no loop, no visited set and no depth cap. The alternative — allowing
 * chains and collapsing them on read — is the version the browser had, and it is one bad row away
 * from a request that never returns.
 *
 * <p><strong>Why a class and not a method on {@link SocietyService}.</strong> Three callers need it,
 * and one of them is {@link SocietyMintService}: a duplicate name that resolves to a merged-away row
 * must hand the caller the <em>survivor</em>, or the mint guard politely returns the very duplicate
 * an operator just merged and the pair comes straight back. A rule with three callers and one place
 * it can be forgotten belongs in one place.
 *
 * <p>Named for the column rather than for the route group so it does not read as
 * {@code Routes.SocietyMerges}, which is a different thing in the same sentence.
 */
final class SocietyMergePointer {

    private SocietyMergePointer() {
    }

    /**
     * The society that actually serves this record — itself, or the one it was merged into.
     *
     * @param societies the repository, so this stays a function rather than a second component
     * @param society   the row as stored; may be null, which is passed straight back so a caller
     *                  holding a nullable does not have to unwrap it twice
     * @return the surviving society
     * @throws NotFoundException if the pointer names a society that no longer exists. That is
     *     unreachable through the API — {@code merged_into} is a foreign key and nothing deletes
     *     societies — so it is a corrupt-data signal, and failing loudly is right: the quiet
     *     alternative is serving the merged-away duplicate as though the merge had never happened
     */
    static Society survivor(SocietyRepository societies, Society society) {
        if (society == null || society.getMergedInto() == null) {
            return society;
        }
        return societies.findById(society.getMergedInto())
                .orElseThrow(() -> NotFoundException.of("Society"));
    }
}
