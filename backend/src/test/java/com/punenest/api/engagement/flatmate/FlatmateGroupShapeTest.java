package com.punenest.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * D211 — D80's split, applied to the other half of supply.
 *
 * <p>The group wire now has two shapes for the same reason the room wire does: the anonymous reads
 * render a card, and a card cannot show a field it never reads. Until this split, {@code GET
 * /flatmates/groups} and the group half of {@code GET /flatmates/feed} sent an unauthenticated
 * caller the flat owner's (masked) number, the anti-broker address fingerprint, the review flag and
 * the moderation verdict, because {@link FlatmateGroupDto} was the only shape there was.
 *
 * <p>The pin below is the thing that keeps it split. A 23-field DTO does not arrive in one commit;
 * it arrives one "while I'm here" field at a time. Adding a field to the card projection now
 * requires editing this list, which is the moment to ask whether a card actually renders it.
 *
 * <p>Deliberately plain JUnit — no Spring context, no database. The property under test is the
 * shape of two records, and a guard that takes twenty seconds to start is a guard people stop
 * running.
 */
@DisplayName("D211 — the group feed shape is a projection of the detail shape, and stays one")
class FlatmateGroupShapeTest {

    /**
     * What an anonymous group read carries. {@code ownerConsent} is on the list because
     * {@code GroupCard.jsx} renders the owner-consent trust cue from it — the boolean stays while
     * the number it was paired with goes, which is the whole point of the split.
     *
     * <p>{@code reviewStatus} is here and {@code modStatus} is not, which is the distinction this
     * list exists to make people state: one is Ops' verdict on the <em>host's claim to the flat</em>
     * and is the entire content of the tier badge a card renders, the other is our verdict on the
     * <em>post</em>, which every producer of this shape has already filtered on and so could only
     * ever say "this one passed".
     */
    private static final List<String> FEED_FIELDS = List.of(
            "id", "title", "locality", "policy", "rent", "perHead", "seatsTotal", "seatsOpen",
            "members", "propertyId", "hostRole", "verificationTier", "agreementDeclared",
            "ownerConsent", "reviewStatus", "tags", "note", "ownerName", "createdAt");

    /**
     * What only the host's own view of a group adds: a third party's contact, two anti-broker
     * forensics columns the client only ever writes, the moderation verdict, and the host's own
     * number — see {@link FlatmateGroupFeedDto} for the evidence behind each.
     */
    private static final List<String> DETAIL_ONLY_FIELDS = List.of(
            "ownerConsentMobile", "addressFingerprint", "flagForReview", "modStatus", "ownerMobile");

    private static Map<String, Class<?>> componentsOf(Class<?> record) {
        return Arrays.stream(record.getRecordComponents())
                .collect(Collectors.toMap(RecordComponent::getName, RecordComponent::getType,
                        (a, b) -> a, LinkedHashMap::new));
    }

    @Nested
    @DisplayName("The feed shape")
    class Feed {

        @Test
        @DisplayName("carries exactly the pinned field set — nothing quietly re-fattens it")
        void fieldSetIsPinned() {
            assertThat(componentsOf(FlatmateGroupFeedDto.class).keySet())
                    .containsExactlyInAnyOrderElementsOf(FEED_FIELDS);
        }

        @Test
        @DisplayName("carries no field whose name suggests contact or moderation")
        void hasNoContactOrVerdict() {
            // The pin above catches an addition by failing on the exact set. This one says *why*
            // the next addition would be wrong, so the failure reads as a rule rather than as a
            // list that needs updating.
            assertThat(componentsOf(FlatmateGroupFeedDto.class).keySet())
                    .as("an anonymous group read must not carry a phone number or a moderation "
                            + "verdict — contact is reached by expressing interest, and what Ops "
                            + "decided is the host's business")
                    .noneMatch(name -> name.toLowerCase().contains("mobile")
                            || name.toLowerCase().contains("modstatus"));
        }
    }

    @Nested
    @DisplayName("The detail shape")
    class Detail {

        @Test
        @DisplayName("is the feed shape plus exactly the pinned host-only fields")
        void isFeedPlusHostOnlyFields() {
            assertThat(componentsOf(FlatmateGroupDto.class).keySet())
                    .containsExactlyInAnyOrderElementsOf(
                            java.util.stream.Stream.concat(FEED_FIELDS.stream(),
                                    DETAIL_ONLY_FIELDS.stream()).toList());
        }

        @Test
        @DisplayName("agrees with the feed shape on the type of every shared field")
        void sharedFieldsHaveTheSameType() {
            Map<String, Class<?>> feed = componentsOf(FlatmateGroupFeedDto.class);
            Map<String, Class<?>> detail = componentsOf(FlatmateGroupDto.class);
            // A projection that silently widens Long to String, or int to Integer, would change
            // the JSON a client already parses while still passing a name-only check.
            assertThat(feed).containsExactlyInAnyOrderEntriesOf(
                    detail.entrySet().stream()
                            .filter(e -> !Set.copyOf(DETAIL_ONLY_FIELDS).contains(e.getKey()))
                            .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue)));
        }
    }

    @Nested
    @DisplayName("The two mappers")
    class Mappers {

        @Test
        @DisplayName("produce the same value for every shared field, from the same row")
        void agreeOnEverySharedField() throws Exception {
            // This is the load-bearing one. MapStruct cannot inherit @Mapping across differing
            // target types, so seatsOpen, perHead and ownerName are wired twice — once per target.
            // Editing perHead's expression on toDto and not on toFeedDto compiles, generates, and
            // ships two different payloads for the same group. Nothing structural can prevent
            // that; this is what catches it.
            FlatmateGroup group = groupWithOneSeatLeft();
            FlatmateMapper mapper = new FlatmateMapperImpl();
            FlatmateMapper.PartyView view = new FlatmateMapper.PartyView("Asha", "9876543210");

            FlatmateGroupFeedDto feed = mapper.toFeedDto(group, view);
            FlatmateGroupDto detail = mapper.toDto(group, view);

            for (RecordComponent component : FlatmateGroupFeedDto.class.getRecordComponents()) {
                assertThat(component.getAccessor().invoke(feed))
                        .as("feed.%s should equal detail.%s", component.getName(), component.getName())
                        .isEqualTo(FlatmateGroupDto.class.getMethod(component.getName()).invoke(detail));
            }
        }

        @Test
        @DisplayName("the card never carries the host number the detail shape was given")
        void feedDropsTheContactTheViewOffered() {
            // Both mappers are handed the same PartyView, number included. The detail shape puts
            // it on the wire; the feed shape has nowhere to put it. That is the guarantee being
            // made structural rather than remembered — the anonymous producers pass null today,
            // and this stays true the day one of them stops.
            FlatmateMapper mapper = new FlatmateMapperImpl();
            FlatmateMapper.PartyView view = new FlatmateMapper.PartyView("Asha", "9876543210");

            assertThat(mapper.toDto(groupWithOneSeatLeft(), view).ownerMobile()).isEqualTo("9876543210");
            assertThat(componentsOf(FlatmateGroupFeedDto.class)).doesNotContainKey("ownerMobile");
        }

        /**
         * A group whose stored {@code seatsOpen} disagrees with {@code seatsTotal - members} — the
         * case {@link FlatmateGroup#openSeats()} exists for. A fixture with no members would let
         * both mappers fall back to the same derivation and prove nothing.
         */
        private FlatmateGroup groupWithOneSeatLeft() {
            FlatmateGroup group = new FlatmateGroup();
            group.setTitle("Three of us in Baner");
            group.setLocality("Baner");
            group.setRent(45000L);
            group.setSeatsTotal(4);
            group.setSeatsOpen(1);
            group.setPropertyId(UUID.randomUUID());
            group.setOwnerConsent(true);
            group.setOwnerConsentMobile("9820011223");
            group.setAgreementDeclared(true);
            return group;
        }
    }
}
