package com.draazy.api.catalog.society;

import com.draazy.api.catalog.locality.LocalityBinding;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.error.ValidationException;
import com.draazy.api.provider.PlacesLookup;
import com.draazy.api.provider.PlacesLookup.Place;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.Roles;
import com.draazy.api.security.WriteRateLimitStore;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/** A duplicate Place ID is for an operator to merge: listings, follows and reviews accumulate against both rows until then. */
@Service
public class SocietyMintService {

    /** The most duplicate hints one candidate may ask for; the console shows a few chips, not a report. */
    private static final int MAX_DUPE_HINTS = 25;

    /** Google lookups one member may cause a day; a place we already hold costs none. */
    private static final int LOOKUPS_PER_DAY = 20;

    private static final Logger log = LoggerFactory.getLogger(SocietyMintService.class);

    private final SocietyRepository societies;
    private final SocietyService societyService;
    private final LocalityBinding localities;
    private final PlacesLookup places;
    private final TransactionTemplate tx;
    private final WriteRateLimitStore lookupBudget;

    public SocietyMintService(SocietyRepository societies, SocietyService societyService,
            LocalityBinding localities, PlacesLookup places,
            TransactionTemplate tx, WriteRateLimitStore.Factory stores) {
        this.societies = societies;
        this.societyService = societyService;
        this.localities = localities;
        this.places = places;
        this.tx = tx;
        this.lookupBudget = stores.create("sm", LOOKUPS_PER_DAY, Duration.ofDays(1));
    }

    /** Not one transaction: the Google call must not hold a database connection, so the lookup runs between two short ones. */
    public MintedSociety mint(SocietyMintRequest request, AuthPrincipal caller) {
        UUID authorId = caller.userId();
        String placeId = SocietySpecs.trimmed(request.placeId());
        if (placeId == null) {
            throw new ValidationException("Pick the society on Google Maps.");
        }
        String origin = mintOrigin(request.mintOrigin());
        SocietyPlaceRules.requireServed(request.lat(), request.lng());

        MintedSociety known = tx.execute(status -> known(placeId, authorId));
        if (known != null) {
            return known;
        }

        Place place = verified(placeId, request, caller);
        if (!place.placeId().equals(placeId)) {
            MintedSociety canonical = tx.execute(status -> known(place.placeId(), authorId));
            if (canonical != null) {
                return canonical;
            }
        }
        return tx.execute(status -> insertAndRead(place, request, origin, authorId));
    }

    private MintedSociety known(String placeId, UUID authorId) {
        Optional<Society> existing = societies.findByPlaceId(placeId);
        if (existing.isEmpty()) {
            return null;
        }
        return new MintedSociety(summary(existing.get(), authorId), false);
    }

    private MintedSociety insertAndRead(Place place, SocietyMintRequest request, String origin, UUID authorId) {
        String placeId = place.placeId();
        String slug = slugify(place.name(), request.localityLabel());
        if (slug.isEmpty()) {
            throw new ValidationException("That name cannot be turned into a web address.");
        }
        String suffixed = slug + "-" + digest(placeId);
        String locality = knownLocality(request.localitySlug());

        int inserted = insert(societies.findBySlug(slug).isPresent() ? suffixed : slug, place, locality, origin, authorId);
        Optional<Society> row = societies.findByPlaceId(placeId);
        if (row.isEmpty()) {
            inserted = insert(suffixed, place, locality, origin, authorId);
            row = societies.findByPlaceId(placeId);
        }
        Society minted = row.orElseThrow(() -> new IllegalStateException("society vanished after mint: " + placeId));
        return new MintedSociety(summary(minted, authorId), inserted == 1);
    }

    private int insert(String slug, Place place, String locality, String origin, UUID authorId) {
        return societies.mintCommunity(slug, place.name(), place.placeId(), locality,
                place.lat(), place.lng(), origin, authorId);
    }

    private Place verified(String placeId, SocietyMintRequest request, AuthPrincipal caller) {
        spendLookup(caller);
        Place hint = new Place(placeId, request.name(), request.lat(), request.lng(), null, List.of());
        Place place;
        try {
            place = places.details(placeId, hint)
                    .orElseThrow(() -> new ValidationException("We couldn't find that place on Google Maps."));
        } catch (PlacesLookup.UnavailableException e) {
            log.warn("Places lookup unavailable: {}", e.getMessage());
            throw new ValidationException("Adding societies is temporarily unavailable.");
        }
        SocietyPlaceRules.requireServed(place.lat(), place.lng());
        SocietyPlaceRules.requireBuilding(place);
        return place;
    }

    private void spendLookup(AuthPrincipal caller) {
        if (Roles.isBackOffice(caller.role())) {
            return;
        }
        int retryAfter = lookupBudget.tryAcquire(caller.userId().toString(), Instant.now());
        if (retryAfter > 0) {
            throw new RateLimitedException(
                    "You've added a lot of societies today. Please try again tomorrow.", retryAfter);
        }
    }

    private SocietyResponse summary(Society society, UUID viewerId) {
        Society survivor = SocietyMergePointer.survivor(societies, society);
        return societyService.summarise(List.of(survivor), viewerId).getFirst();
    }

    private static String digest(String placeId) {
        try {
            byte[] sha1 = MessageDigest.getInstance("SHA-1").digest(placeId.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(sha1).substring(0, 6);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    @Transactional(readOnly = true)
    public Page<SocietyResponse> candidates(Pageable pageable, UUID viewerId) {
        Page<Society> page = societies.candidates(pageable);
        return page.map(society -> societyService.summarise(List.of(society), viewerId).getFirst());
    }

    /** Computed on the server because the catalogue is: a hint list that cannot see community rows reads "no duplicate exists". */
    @Transactional(readOnly = true)
    public List<SocietyDuplicateSuggestion> duplicates(String slug, int limit) {
        if (limit < 1 || limit > MAX_DUPE_HINTS) {
            throw new BadRequestException("limit must be between 1 and " + MAX_DUPE_HINTS);
        }
        Society candidate = societies.findBySlug(slug)
                .orElseThrow(() -> NotFoundException.of("Society"));

        Set<String> mine = SocietyMatching.tokens(candidate.getName());
        if (mine.isEmpty()) {
            // A name of nothing but stopwords would score against everything; no hint beats a useless one.
            return List.of();
        }

        return societies.duplicateScan(candidate.getId()).stream()
                .map(row -> score(row, mine, candidate))
                .filter(s -> s != null && s.score() >= SocietyMatching.FLOOR)
                .sorted(Comparator.comparingDouble(SocietyDuplicateSuggestion::score).reversed())
                .limit(limit)
                .toList();
    }

    /** One scan row scored against the candidate, or null if it has no comparable name. */
    private static SocietyDuplicateSuggestion score(Object[] row, Set<String> mine, Society candidate) {
        String name = (String) row[1];
        String localitySlug = (String) row[2];

        Set<String> theirs = SocietyMatching.tokens(name);
        if (theirs.isEmpty()) {
            return null;
        }
        double score = SocietyMatching.nameScore(mine, theirs);
        if (candidate.getLocalitySlug() != null && candidate.getLocalitySlug().equals(localitySlug)) {
            score += SocietyMatching.LOCALITY_BOOST;
        }
        if (candidate.getLat() != null && candidate.getLng() != null && row[3] != null && row[4] != null
                && SocietyMatching.metresBetween(candidate.getLat(), candidate.getLng(),
                        (Double) row[3], (Double) row[4]) <= SocietyMatching.NEAR_METRES) {
            score += SocietyMatching.NEAR_BOOST;
        }
        return new SocietyDuplicateSuggestion((String) row[0], name, localitySlug, score);
    }

    /** Absent defaults to {@link SocietyMintOrigins#LISTING} for older clients; unknown is a 422 because the CHECK would otherwise 500. */
    private static String mintOrigin(String supplied) {
        String value = SocietySpecs.trimmed(supplied);
        if (value == null) {
            return SocietyMintOrigins.LISTING;
        }
        if (!SocietyMintOrigins.DEMAND.equals(value) && !SocietyMintOrigins.LISTING.equals(value)) {
            throw new ValidationException("Unknown mint origin: " + value);
        }
        return value;
    }

    /** Null when none was picked; a slug that is not a live locality is refused. */
    private String knownLocality(String slug) {
        String candidate = SocietySpecs.trimmed(slug);
        if (candidate == null) {
            return null;
        }
        return localities.require(candidate, null).slug();
    }

    static String slugify(String name, String locality) {
        String joined = (SocietySpecs.trimmed(name) == null ? "" : name.trim())
                + (SocietySpecs.trimmed(locality) == null ? "" : " " + locality.trim());
        return joined.toLowerCase(Locale.ROOT).trim()
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
    }

    /** The society and whether this call created it: the controller answers 201 for a mint and 200 for a match. */
    public record MintedSociety(SocietyResponse society, boolean created) {
    }
}
