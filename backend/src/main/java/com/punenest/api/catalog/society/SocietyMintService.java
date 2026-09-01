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

        // Validated here rather than beside the insert, so a caller sending an unknown origin is
        // told so whether or not their society happens to already exist. A check that only fires on
        // the mint path is one a client can pass by accident and then fail in production the first
        // time it adds a building nobody had.
        String origin = mintOrigin(request.mintOrigin());

        String slug = slugify(name, request.localityLabel());
        if (slug.isEmpty()) {
            // A name of nothing but punctuation. It passed the length check and slugifies to the
            // empty string, which would be an unroutable society nobody could ever open.
            throw new ValidationException("That name cannot be turned into a web address.");
        }

        Society existing = canonical(slug, name);
        if (existing != null) {
            // The existing row keeps the origin it was minted with. A searcher reaching a society a
            // lister already added is real demand and goes unrecorded here, but overwriting
            // `listing` with `demand` would be worse than losing it: it would tell an operator no
            // flat has ever been posted in a building that exists in the catalogue precisely
            // because one was. Wanting a society that already exists is what following it is for,
            // and that signal is kept in `society_follows`.
            return new MintedSociety(societyService.summarise(List.of(existing), authorId).getFirst(), false);
        }

        // `on conflict (slug) do nothing`, then re-read. Two people adding the same missing society
        // in the same second is not exotic — it is what happens the day a new tower gets possession
        // — and the loser of that race should be told their society exists, not shown an error
        // about a race they were not part of.
        societies.mintCommunity(slug, name, knownLocality(request.localitySlug()),
                request.lat(), request.lng(), origin, authorId);

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
     *     who did — or if it has been merged away
     */
    @Transactional
    public SocietyResponse verify(String slug, UUID operatorId) {
        Society society = societies.findBySlug(slug)
                .orElseThrow(() -> NotFoundException.of("Society"));

        if (!SocietySources.COMMUNITY.equals(society.getSource())) {
            throw new ValidationException("Only a member-added society needs verifying.");
        }

        // A merged-away society is not in the candidates queue, so this is somebody acting on a
        // stale screen or a bookmarked slug. Verifying it would stamp a named operator's confidence
        // onto a row another operator has just judged not to be a separate building — and it would
        // do so invisibly, because the row is not rendered anywhere a reader could notice.
        if (society.getMergedInto() != null) {
            Society survivor = SocietyMergePointer.survivor(societies, society);
            throw new ConflictException("This society has been merged into " + survivor.getName()
                    + " (" + survivor.getSlug() + "). Verify that one instead.");
        }

        if (societies.markVerified(society.getId(), operatorId) == 0) {
            throw new ConflictException("This society has already been verified.");
        }

        Society fresh = societies.findBySlug(slug).orElseThrow(() -> NotFoundException.of("Society"));
        return societyService.summarise(List.of(fresh), operatorId).getFirst();
    }

    /**
     * The mint origin to store, defaulting an absent one rather than refusing it.
     *
     * <p><strong>Why an unknown value is a 422 and an absent one is not.</strong> Absent is a
     * client that predates the field, and there are shipped ones; refusing them would take a working
     * mint away from a caller for the sake of a column ops reads. Unknown is a caller that meant to
     * say something and got it wrong — {@code "Demand"}, {@code "search"}, {@code "demmand"} — and
     * that must fail loudly here, because the database CHECK would reject it as a 500 and, worse,
     * anything the CHECK did admit would simply never match {@code 'demand'} downstream. The
     * building would sit in the queue looking like supply forever and nothing would have complained.
     *
     * <p>The default is {@link SocietyMintOrigins#LISTING} and the asymmetry is deliberate. Every
     * shipped mint surface but the finder is on the listing side, and the finder states its origin,
     * so this can under-report demand and can never invent it. Under-reported demand is a queue
     * quieter than reality; invented demand sends an operator to source inventory in a building
     * nobody asked about, and they only find that out after going.
     */
    private static String mintOrigin(String supplied) {
        String value = blankToNull(supplied);
        if (value == null) {
            return SocietyMintOrigins.LISTING;
        }
        if (!SocietyMintOrigins.DEMAND.equals(value) && !SocietyMintOrigins.LISTING.equals(value)) {
            throw new ValidationException("Unknown mint origin: " + value);
        }
        return value;
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
     *
     * <p><strong>Then the merge pointer is followed</strong> (V111), and this is the step without
     * which a merge would not hold. The duplicate an operator merged away still occupies its slug
     * and its name — nothing was deleted — so both lookups keep finding it. Handing it back would
     * mean the next person to type that name gets the row that was just retired, files a listing
     * against it, and puts the pair straight back in front of the operator who thought they had
     * dealt with it. Returning the survivor instead is what makes minting agree with the merge.
     */
    private Society canonical(String slug, String name) {
        return SocietyMergePointer.survivor(societies, societies.findBySlug(slug)
                .orElseGet(() -> societies.findByNameIgnoringCase(name).stream()
                        .findFirst().orElse(null)));
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
