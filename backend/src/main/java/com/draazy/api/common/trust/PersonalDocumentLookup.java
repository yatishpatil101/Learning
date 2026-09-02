package com.draazy.api.common.trust;

import java.util.Optional;
import java.util.UUID;

/**
 * Whether a document in the personal vault belongs to a given person.
 *
 * <p><strong>Why a port.</strong> The vault lives in {@code documents} and the society claim desk
 * lives in {@code engagement}, and the two sit at the <em>same</em> rank in the layering
 * {@code ArchitectureBoundaryTest} enforces — so neither may import the other, and a claim carrying
 * a vault reference has no legal way to check it. Declaring the question here and answering it in
 * {@code documents.vault} points the arrow the right way, as {@link ContactGate},
 * {@link RatingLookup} and {@link VerifiedTenantLookup} already do.
 *
 * <p><strong>Why the caller cannot simply trust the id it was handed.</strong> An unchecked
 * reference is a reference to anything: a claimant could name a stranger's Aadhaar scan and have an
 * operator open it while reviewing their claim. The database's foreign key would accept that, which
 * is exactly why the check cannot be left to it — the constraint enforces that the row exists, not
 * that it is the caller's.
 */
public interface PersonalDocumentLookup {

    /**
     * True when {@code documentId} names a live personal-vault row owned by {@code ownerId}.
     *
     * <p>One boolean rather than the row, deliberately. Handing back the document would put its
     * {@code storageKey} — a capability, not a description; see {@code DataExportScope} — into a
     * context that has no business minting URLs for someone's KYC papers. A caller storing a pointer
     * only needs to know whether the pointer is honest; if it later needs to <em>show</em> the file,
     * that is {@link #viewOwnedBy}, which mints the link inside the vault and still never surrenders
     * the key.
     *
     * <p>Answers {@code false} rather than distinguishing "no such document" from "not yours", so
     * that a caller cannot be turned into an oracle for the existence of other people's files. That
     * is the same choice {@code DocumentService.deletePersonal} makes when it answers 404 and never
     * 403.
     */
    boolean isOwnedBy(UUID documentId, UUID ownerId);

    /**
     * A viewable handle on {@code documentId}, but only if it is {@code ownerId}'s — empty otherwise.
     *
     * <p><strong>Why the owner is still a parameter.</strong> This is the read that finally lets a
     * document leave the vault, so it is the one place where "give me document X" would be a
     * catastrophic API: the vault holds Aadhaar, PAN, salary slips and agreements, and a method that
     * takes an id alone is a method that reads any of them for anyone who can reach it. Requiring
     * both halves of the key means the caller must already know, from its own records, whose file it
     * is asking for. A society claim knows: it recorded the claimant and the certificate together,
     * so it can name both, and a claim row that somehow pointed at a stranger's document produces
     * nothing rather than that stranger's Aadhaar.
     *
     * <p>The mismatch and the missing-row cases are one empty answer, for the same non-oracle reason
     * as {@link #isOwnedBy}.
     *
     * <p><strong>Every call is a disclosure.</strong> The URL is minted fresh and short-lived, so
     * this is not a lookup that can be cached or batched — callers are expected to invoke it when a
     * human actually asks to open the file, and to audit that they did.
     */
    Optional<PersonalDocumentView> viewOwnedBy(UUID documentId, UUID ownerId);
}
