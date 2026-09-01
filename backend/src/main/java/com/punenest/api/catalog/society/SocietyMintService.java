package com.punenest.api.catalog.society;

import com.punenest.api.common.error.ConflictException;
import com.punenest.api.common.error.NotFoundException;
import com.punenest.api.common.error.ValidationException;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Minting a society that is not in the catalogue yet, and the ops queue that promotes it.
 *
 * <p><strong>What this replaces.</strong> A lister who could not find their society, and a searcher
 * who wanted to be told the moment a flat came up in one, were both offered "Add it". That mint
 * wrote a record to {@code pnCommunitySocieties} in the one browser that did it. The society existed
 * for exactly one person: nobody else could find it, follow it, or list a flat in it, which is the
 * entire reason somebody adds one. Following it then 404'd against a server that had never heard of
 * the slug, so the follow context had to hold such follows locally and hope ops would promote them —
 * and ops could not, because the "Candidates" queue read the operator's own browser and was
 * permanently empty. Not one community society has ever been verified.
 *
 * <p><strong>The duplicate guard is the important part.</strong> A mint that slips past it writes a
 * permanent second copy of a society we already hold verified, and nothing automatic can undo that:
 * listings, follows, reviews and residency claims accumulate against both slugs until an operator
 * finds them and merges by hand. So this refuses on the name as well as on the slug — the slug folds
 * the locality in, so "Kumar Pinnacle" typed without one produces a different slug from the RERA
 * row's {@code kumar-pinnacle-wakad} and a slug-only check would wave the duplicate straight
 * through. When it does match, the caller is handed the canonical society rather than an error: they
 * asked for a society by name and there is one, which is the answer to their question.
 */
@Service
public class SocietyMintService {

    /** Below this a "name" is a keystroke, not a society. Mirrors the two-character UI gate. */
    private static final int MIN_NAME = 2;

    private final SocietyRepository societies;
    private final SocietyService societyService;
    private final com.punenest.api.catalog.locality.LocalityRepository localities;

    public SocietyMintService(SocietyRepository societies, SocietyService societyService,
            com.punenest.api.catalog.locality.LocalityRepository localities) {
        this.societies = societies;
        this.societyService = societyService;
        this.localities = localities;
    }

    /**
     * Add a society the catalogue does not have.
     *
     * <p>Answers the canonical society when one already matches, so the caller's next move — follow
     * it, list in it, open its hub — works against the real row instead of against a duplicate they
     * did not know they had created.
     *
     * @param authorId the member adding it; recorded so an operator reviewing the candidate can ask
     *     them about it, and so one account minting fifty societies is visible rather than suspected
     * @return the society, freshly minted or the canonical one that already existed
     */
    @Transactional
    public MintedSociety mint(SocietyMintRequest request, UUID authorId) {
        String name = request.name() == null ? "" : request.name().trim();
        if (name.length() < MIN_NAME) {
            throw new ValidationException("Give the society a name.");
        }

        String slug = slugify(name, request.localityLabel());
        if (slug.isEmpty()) {
            // A name of nothing but punctuation. It passed the length check and slugifies to the
            // empty string, which would be an unroutable society nobody could ever open.
            throw new ValidationException("That name cannot be turned into a web address.");
        }

        Society existing = canonical(slug, name);
        if (existing != null) {
            return new MintedSociety(societyService.summarise(List.of(existing), authorId).getFirst(), false);
        }

        // `on conflict (slug) do nothing`, then re-read. Two people adding the same missing society
        // in the same second is not exotic — it is what happens the day a new tower gets possession
        // — and the loser of that race should be told their society exists, not shown an error
        // about a race they were not part of.
        societies.mintCommunity(slug, name, knownLocality(request.localitySlug()),
                request.lat(), request.lng(), authorId);

        Society minted = societies.findBySlug(slug)
                .orElseThrow(() -> new IllegalStateException("society vanished after mint: " + slug));
        return new MintedSociety(societyService.summarise(List.of(minted), authorId).getFirst(), true);
    }

    /**
     * Community societies nobody has checked yet, oldest first — the ops "Candidates" queue.
     *
     * <p>Curated and RERA rows never appear: they are verified by construction, and an operator
     * being asked to confirm 320 MahaRERA imports is an operator who stops reading the queue.
     */
    @Transactional(readOnly = true)
    public Page<SocietyResponse> candidates(Pageable pageable, UUID viewerId) {
        Page<Society> page = societies.candidates(pageable);
        return page.map(society -> societyService.summarise(List.of(society), viewerId).getFirst());
    }

    /**
     * Confirm a community society is real.
     *
     * <p>Deliberately does not touch {@code registration} or {@code conveyance}. Those describe the
     * building's legal state, not our confidence in the record; setting them here is how a
     * community-minted row would start telling a buyer its conveyance deed is done because somebody
     * confirmed the society exists.
     *
     * @throws ConflictException if it has already been verified — the second operator to clear the
     *     same queue should be told somebody already did this, not silently overwrite the record of
     *     who did
     */
    @Transactional
    public SocietyResponse verify(String slug, UUID operatorId) {
        Society society = societies.findBySlug(slug)
                .orElseThrow(() -> NotFoundException.of("Society"));

        if (!SocietySources.COMMUNITY.equals(society.getSource())) {
            throw new ValidationException("Only a member-added society needs verifying.");
        }

        if (societies.markVerified(society.getId(), operatorId) == 0) {
            throw new ConflictException("This society has already been verified.");
        }

        Society fresh = societies.findBySlug(slug).orElseThrow(() -> NotFoundException.of("Society"));
        return societyService.summarise(List.of(fresh), operatorId).getFirst();
    }

    /**
     * The locality slug if the catalogue has it, else null.
     *
     * <p>{@code societies.locality_slug} is a foreign key, so an area the caller invented is not a
     * field we can store — it is a constraint violation, and a 500 on a form somebody filled in
     * correctly. Dropping it is right rather than merely convenient: an unplaced society is a state
     * the schema already allows (most of the RERA import is in it), and the pin the caller may also
     * have sent is a better answer to "where is this" than a locality nobody recognises.
     */
    private String knownLocality(String slug) {
        String candidate = blankToNull(slug);
        if (candidate == null) {
            return null;
        }
        return localities.findBySlugAndActiveTrue(candidate).isPresent() ? candidate : null;
    }

    /**
     * The canonical society this name would duplicate, or null.
     *
     * <p>Two lookups rather than one, and both matter. The slug catches the same name typed with the
     * same locality; the case-insensitive name catches the same society typed without one, whose
     * slug does not collide at all.
     */
    private Society canonical(String slug, String name) {
        return societies.findBySlug(slug)
                .orElseGet(() -> societies.findByNameIgnoringCase(name).stream().findFirst().orElse(null));
    }

    /**
     * Name (plus locality, when given) to a URL-safe slug.
     *
     * <p>Character-for-character the browser's {@code slugifySociety}, because for a transition
     * period both mint paths exist and a server slug that differed by one hyphen would produce a
     * second society for the same building — the precise failure this endpoint exists to end.
     */
    static String slugify(String name, String locality) {
        String joined = (blankToNull(name) == null ? "" : name.trim())
                + (blankToNull(locality) == null ? "" : " " + locality.trim());
        return joined.toLowerCase(Locale.ROOT).trim()
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    /**
     * The minted society and whether it is new.
     *
     * <p>The flag is not cosmetic: the controller answers 201 for a mint and 200 for a match, and
     * the caller's screen says "Added" or "Already on PuneNest" accordingly. Collapsing the two
     * would tell somebody they had added a society that has existed for two years.
     */
    public record MintedSociety(SocietyResponse society, boolean created) {
    }
}
