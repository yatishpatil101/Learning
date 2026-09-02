package com.draazy.api.catalog.society;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.ValidationException;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Minting a society that is not in the catalogue yet, and the ops queue that promotes it.
 *
 * <p><strong>What this replaces.</strong> A lister who could not find their society, and a searcher
 * who wanted to be told the moment a flat came up in one, were both offered "Add it". That mint
 * wrote a record to {@code dzCommunitySocieties} in the one browser that did it. The society existed
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

    /**
     * The weakest resemblance still worth putting in front of an operator.
     *
     * <p>Under {@link #score} this admits two of five distinct words, or one of two — and rejects
     * one of three. That is about where "these might be the same building" stops being a sentence a
     * person would say out loud.
     */
    private static final double DUPE_FLOOR = 0.34;

    /**
     * What sharing a locality is worth. Not proof — two societies can share a road.
     *
     * <p>Enough to lift an otherwise-rejected single shared word over the floor, which is
     * intentional: two buildings both called "Willow something" in the same suburb are worth an
     * operator's glance even though the names diverge, and the same pair in suburbs eleven
     * kilometres apart is not.
     */
    private static final double LOCALITY_BOOST = 0.25;

    /**
     * Words that carry no identity in a Pune society name.
     *
     * <p>Every third building is a Residency and every second one ends in CHS, so counting those as
     * shared evidence fills the duplicate column with pairs that have nothing in common but their
     * suffix — and an operator who sees three false hints stops reading the fourth, which is the
     * real one.
     */
    private static final Set<String> NAME_STOPWORDS = Set.of(
            "the", "of", "by", "and", "society", "apartments", "apartment", "residency",
            "residences", "homes", "phase", "wing", "tower", "towers", "co", "op", "chs",
            "ltd", "pune");

    /**
     * The most duplicate hints one candidate may ask for.
     *
     * <p>Not a performance bound — the scan is the same size whatever this is, because the limit is
     * applied after scoring and filtering. It is a bound on what the column can become. The hint is
     * three chips an operator glances at before deciding whether to merge; a request for fifty
     * turns it into a report, and a column that lists fifty possible duplicates is one nobody reads.
     */
    private static final int MAX_DUPE_HINTS = 25;

    private final SocietyRepository societies;
    private final SocietyService societyService;
    private final com.draazy.api.catalog.locality.LocalityRepository localities;

    public SocietyMintService(SocietyRepository societies, SocietyService societyService,
            com.draazy.api.catalog.locality.LocalityRepository localities) {
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
     * Societies a candidate might be a duplicate of, strongest match first.
     *
     * <p><strong>Why this is on the server at all.</strong> It was computed in the browser, over a
     * static file of 28 curated societies bundled with the app. Every duplicate the queue actually
     * produces is a community-minted row — that is what a candidate <em>is</em> — and none of those
     * were in the file, so a candidate that was a textbook duplicate of another candidate showed
     * "No obvious match". To an operator that reads as "no duplicate exists", and the junk row gets
     * verified into a permanent one. The scan has to run where the catalogue is.
     *
     * <p>The shape is the one the browser used — distinctive shared name tokens, plus a boost for
     * sharing a locality, keeping anything at or above {@link #DUPE_FLOOR}. The denominator is not:
     * see {@link #score} for what the real catalogue does to the browser's version of it. Verified
     * targets sort first because a merge canonicalises <em>into</em> the trusted row.
     *
     * @param limit how many to hand back; the console shows a handful of chips, not a report
     * @throws NotFoundException if the slug names no society — an operator on a stale queue should
     *     be told, rather than shown an empty hint list that reads as "nothing resembles this"
     */
    @Transactional(readOnly = true)
    public List<SocietyDuplicateSuggestion> duplicates(String slug, int limit) {
        // Refused rather than clamped, which is the same rule `?days=0` follows on the analytics
        // reports. `Math.max(1, limit)` stood here and quietly answered a request nobody made: a
        // caller asking for zero hints got one, and a caller asking for a thousand got a silently
        // different number back with nothing saying so.
        if (limit < 1 || limit > MAX_DUPE_HINTS) {
            throw new BadRequestException("limit must be between 1 and " + MAX_DUPE_HINTS);
        }
        Society candidate = societies.findBySlug(slug)
                .orElseThrow(() -> NotFoundException.of("Society"));

        Set<String> mine = tokens(candidate.getName());
        if (mine.isEmpty()) {
            // A name of nothing but stopwords — "The Society", "Apartments". Every comparison would
            // divide by zero tokens and score 1.0 against anything, so the whole catalogue would be
            // proposed as a duplicate. No hint is the honest answer; a hint that matches everything
            // is worse than none, because the operator stops reading the column.
            return List.of();
        }

        return societies.duplicateScan(candidate.getId()).stream()
                .map(row -> score(row, mine, candidate.getLocalitySlug()))
                .filter(s -> s != null && s.score() >= DUPE_FLOOR)
                .sorted(Comparator.comparing(SocietyDuplicateSuggestion::verified).reversed()
                        .thenComparing(Comparator.comparingDouble(SocietyDuplicateSuggestion::score)
                                .reversed()))
                .limit(limit)
                .toList();
    }

    /** One scan row scored against the candidate, or null if it has no comparable name. */
    private static SocietyDuplicateSuggestion score(Object[] row, Set<String> mine,
            String myLocality) {
        String slug = (String) row[0];
        String name = (String) row[1];
        String localitySlug = (String) row[2];
        boolean verified = row[3] != null || !SocietySources.COMMUNITY.equals((String) row[4]);

        Set<String> theirs = tokens(name);
        if (theirs.isEmpty()) {
            return null;
        }
        long shared = theirs.stream().filter(mine::contains).count();
        /*
         * Shared words over the words in either name — not over the shorter of the two.
         *
         * The browser divided by the shorter name, and against a bundled file of 28 curated
         * societies it never showed. Against the real catalogue it collapses: "Willow Towers"
         * reduces to the single distinctive token `willow`, so dividing by 1 scores it a flat 1.0
         * against "Willow Crest", "Willow Avenue", "Willow Grove" and everything else on that root
         * — and because RERA rows are verified, all of them sort *above* the actual duplicate. The
         * operator's first six hints are wrong and the real one is off the list.
         *
         * Counting the union instead charges for the words that differ. "Willow Crest" against
         * "Willow Towers" is one word in three and falls under the floor; "Kumar Pinnacle" against
         * "Kumar Pinnacle Wakad" is two in three and does not, which is the phase-and-suffix case
         * the shorter-name denominator was there to protect.
         */
        long union = mine.size() + theirs.size() - shared;
        double base = union == 0 ? 0 : (double) shared / union;
        boolean sameLocality = myLocality != null && myLocality.equals(localitySlug);
        return new SocietyDuplicateSuggestion(slug, name, localitySlug, verified,
                base + (sameLocality ? LOCALITY_BOOST : 0));
    }

    /**
     * The distinctive words in a society's name.
     *
     * <p>The stopword list is what makes the score mean anything. Without it "Green Acres Society"
     * and "Blue Ridge Society" share a token and score 0.33 — and since every third society in Pune
     * is called something Residency, the column would be full of pairs that have nothing in common
     * but the suffix. Single characters go too: a wing letter is not evidence.
     */
    private static Set<String> tokens(String name) {
        return Arrays.stream(String.valueOf(name == null ? "" : name)
                        .toLowerCase(Locale.ROOT).split("[^a-z0-9]+"))
                .filter(t -> t.length() > 1 && !NAME_STOPWORDS.contains(t))
                .collect(Collectors.toCollection(LinkedHashSet::new));
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
     * the caller's screen says "Added" or "Already on Draazy" accordingly. Collapsing the two
     * would tell somebody they had added a society that has existed for two years.
     */
    public record MintedSociety(SocietyResponse society, boolean created) {
    }
}
