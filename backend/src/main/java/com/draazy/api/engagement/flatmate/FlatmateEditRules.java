package com.draazy.api.engagement.flatmate;

import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.common.web.Ids;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.stereotype.Component;

/** Classify-only twin of {@code catalog.listing.ListingEditRules}: it must run before
 * {@code mapper.applyTo}, or the stored values it compares against are gone. */
@Component
class FlatmateEditRules {

    /* Silent fields: {@code ownerConsentMobile} is not stored, {@code occupants}/{@code maxOccupants} are not in the mapper allowlist,
       {@code society} derives from {@code societyId}, and {@code localitySlug} folds into the compared canonical locality name. */
    static final Map<Class<?>, Set<String>> SILENT = Map.of(
            FlatmateRoomCreateRequest.class,
            Set.of("attachedBath", "lookingFor", "foodPref", "hostRole", "propertyId",
                    "agreementDeclared", "agreementDoc", "ownerConsentMobile", "ownerConsent",
                    "occupants", "maxOccupants", "gatedCommunity", "details", "society", "localitySlug"),
            FlatmateGroupCreateRequest.class,
            Set.of("policy", "seatsOpen", "name", "role", "propertyId", "agreement",
                    "agreementDoc", "localitySlug"),
            FlatmateSeekerPostCreateRequest.class,
            Set.of("gender", "age", "flatPref", "roomPref", "verifiedContactOnly"));

    /** {@code locality} is foundation here but only a re-check on a seeker post: a room's locality
     * asserts where a physical flat is and feeds the duplicate fingerprint. */
    FlatmateEditImpact classify(FlatmateRoom room, FlatmateRoomCreateRequest in) {
        boolean remoderationRequired = false;
        List<String> rechecked = new ArrayList<>();

        if (!same(room.getLocality(), in.locality())) {
            remoderationRequired = true;
        }

        // A single room that became a whole flat, or a 2BHK that became a 4BHK, answers filters it
        // was never checked for — and both are how a broker relabels a room into a better slot.
        if (!same(room.getRoomType(), in.roomType()) || !same(room.getBhk(), in.bhk())) {
            remoderationRequired = true;
        }

        /** The address is what the guardrail fingerprints. The society *reference* counts too:
         * `societyReference.require` proves the id names *a* society, not this host's. */
        if (!same(room.getFlatNumber(), in.flatNumber())
                || in.societyId() != null
                && !Objects.equals(room.getSocietyId(), Ids.parseUuid(in.societyId().trim()).orElse(null))) {
            rechecked.add("address");
        }

        if (!Objects.equals(room.getLat(), in.lat()) || !Objects.equals(room.getLng(), in.lng())) {
            rechecked.add("map pin");
        }
        if (!Objects.equals(room.getBudget(), in.rentShare())) {
            rechecked.add("rent");
        }
        if (!same(room.getFurnishing(), in.furnishing())) {
            rechecked.add("furnishing");
        }

        /** Not foundation, because nothing filters on it — but it is the card's headline claim about
         * what the building is, so a flat relabelled a villa is the BHK relabel minus the filter. */
        if (!same(room.getHomeTypeLabel(), in.homeTypeLabel())) {
            rechecked.add("home type");
        }
        if (!Objects.equals(room.getAvailableFrom(), in.availableFrom())) {
            rechecked.add("availability");
        }

        // Photos and prose are the evidence the moderator approved against, so swapping them
        // re-sells that approval — the exact bait-and-switch this class exists to stop.
        if (!sameList(room.getPhotos(), in.photos())) {
            rechecked.add("photos");
        }
        if (!same(room.getNote(), in.note())) {
            rechecked.add("note");
        }
        if (!same(room.getTitle(), in.title())) {
            rechecked.add("title");
        }

        /** These read like facets because the wizard offers chips, but the *endpoint* takes `@Size`
         * strings checked against no vocabulary and renders them on the anonymous feed. */
        if (!same(room.getFacing(), in.facing())
                || !same(room.getOverlooking(), in.overlooking())) {
            rechecked.add("details");
        }
        if (!sameList(room.getTags(), in.lifestyle())) {
            rechecked.add("lifestyle");
        }

        // Deposit and terms are the other half of the ask: watching `rentShare` alone would leave a
        // host free to move the money, or to add a lock-in, without tripping anything.
        if (!Objects.equals(room.getDeposit(), in.deposit())
                || !Objects.equals(room.getNoticePeriodDays(), in.noticePeriodDays())
                || !Objects.equals(room.getLockInMonths(), in.lockInMonths())
                || !same(room.getMaintenanceBilling(), in.maintenanceBilling())
                || !same(room.getElectricityBilling(), in.electricityBilling())) {
            rechecked.add("deposit");
        }

        // Everything else is silent, and named in SILENT so the test can hold the two together.
        return impact(remoderationRequired, rechecked);
    }

    FlatmateEditImpact classify(FlatmateGroup group, FlatmateGroupCreateRequest in, String locality,
            int seats) {
        boolean remoderationRequired = false;
        List<String> rechecked = new ArrayList<>();
        FlatmateGroupPreferences wanted = in.hunting() ? in.preferences().normalised() : null;

        if (group.isHunting() != in.hunting()
                || (!in.hunting() && !same(group.getLocality(), locality))) {
            remoderationRequired = true;
        }

        if (!same(group.getTitle(), in.title())) {
            rechecked.add("title");
        }
        if (!Objects.equals(group.getRent(), wanted == null ? in.rent() : wanted.rentMax())) {
            rechecked.add("rent");
        }
        if (wanted != null && !wanted.equals(group.getPreferences())) {
            rechecked.add("preferences");
        }

        if (wanted == null && (!Objects.equals(group.getDeposit(), in.deposit())
                || !Objects.equals(group.getNoticePeriodDays(), in.noticePeriodDays())
                || !Objects.equals(group.getLockInMonths(), in.lockInMonths())
                || !same(group.getMaintenanceBilling(), in.maintenanceBilling())
                || !same(group.getElectricityBilling(), in.electricityBilling()))) {
            rechecked.add("deposit");
        }
        if (!same(group.getNote(), in.note())) {
            rechecked.add("note");
        }

        if (!sameList(group.getTags(), in.tags())) {
            rechecked.add("lifestyle");
        }

        /** Seats, because the card advertises `rent / seatsTotal`: halving them halves the per-head
         * price a reader sees without touching `rent`. */
        if (group.getSeatsTotal() != seats) {
            rechecked.add("seats");
        }

        if (wanted == null
                && !same(group.getOwnerConsentMobile(), MobileMask.normalise(in.consentMobile()))) {
            rechecked.add("owner consent");
        }

        return impact(remoderationRequired, rechecked);
    }

    /** Nothing here is foundation: there is no address, tier or document, so a seeker post cannot
     * stop being the thing that was approved. */
    FlatmateEditImpact classify(FlatmateSeekerPost post, FlatmateSeekerPostCreateRequest in) {
        List<String> rechecked = new ArrayList<>();

        if (!same(post.getName(), in.name())) {
            rechecked.add("name");
        }
        if (!same(post.getOccupation(), in.occupation())) {
            rechecked.add("occupation");
        }
        if (!same(post.getNote(), in.note())) {
            rechecked.add("note");
        }
        if (!same(post.getTitle(), in.title())) {
            rechecked.add("title");
        }
        if (!Objects.equals(post.getBudget(), in.budget())
                || !Objects.equals(post.getBudgetMax(), in.budgetMax())) {
            rechecked.add("budget");
        }

        /** Cleaned on the incoming side for the same reason `same` trims: `FlatmateSeekerService.clean`
         * runs on the way to the column, so one stray duplicate would look like an edit. */
        if (!sameList(post.getLocalities(), FlatmateSeekerService.clean(in.localities()))) {
            rechecked.add("localities");
        }

        if (!sameList(post.getTags(), FlatmateSeekerService.clean(in.tags()))
                || !same(post.getMoveIn(), in.moveIn())) {
            rechecked.add("details");
        }

        return impact(false, rechecked);
    }

    private static FlatmateEditImpact impact(boolean remoderationRequired, List<String> rechecked) {
        if (!remoderationRequired && rechecked.isEmpty()) {
            return FlatmateEditImpact.SILENT;
        }

        // A full re-moderation supersedes a re-check, so the two flags are never both true.
        return new FlatmateEditImpact(remoderationRequired,
                !remoderationRequired, List.copyOf(rechecked));
    }

    /** Compared the way it will be stored: the edit paths strip what they write, and a field cleared
     * to {@code ""} means the same as one never filled. */
    private static boolean same(String stored, String incoming) {
        return Objects.equals(FlatmateVocabulary.blankToNull(stored),
                FlatmateVocabulary.blankToNull(incoming));
    }

    /** Order matters: the first photo is the cover, so a re-order puts a picture in front of people
     * that was approved as the fourth one down. */
    private static boolean sameList(List<String> stored, List<String> incoming) {
        return Objects.equals(stored == null ? List.of() : stored,
                incoming == null ? List.of() : incoming);
    }
}
