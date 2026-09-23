package com.draazy.api.engagement.flatmate;

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

// Keeps the anonymous group card shape a strict projection of the detail shape, so a "while I'm
// here" field cannot leak the masked owner number, address fingerprint or moderation verdict.
@DisplayName("D211 — the group feed shape is a projection of the detail shape, and stays one")
class FlatmateGroupShapeTest {

    // reviewStatus is here and modStatus is not: the first is Ops' verdict on the host's claim to
    // the flat, which the card's tier badge renders; the second is our verdict on the post.
    private static final List<String> FEED_FIELDS = List.of(
            "id", "title", "locality", "policy", "rent", "deposit", "noticePeriodDays",
            "lockInMonths", "maintenanceBilling", "electricityBilling",
            "perHead", "seatsTotal", "seatsOpen",
            "members", "propertyId", "hostRole", "verificationTier", "agreementDeclared",
            "ownerConsent", "reviewStatus", "tags", "note", "ownerName", "createdAt");

    // See {@link FlatmateGroupFeedDto} for the evidence behind each host-only field.
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
            // States *why* the next addition would be wrong, so the failure reads as a rule rather
            // than as a list that needs updating.
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
            // MapStruct cannot inherit @Mapping across differing target types, so seatsOpen,
            // perHead and ownerName are wired twice — editing one target only still compiles.
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
            // Both mappers get the same PartyView, number included: the detail shape puts it on
            // the wire, the feed shape has nowhere to put it.
            FlatmateMapper mapper = new FlatmateMapperImpl();
            FlatmateMapper.PartyView view = new FlatmateMapper.PartyView("Asha", "9876543210");

            assertThat(mapper.toDto(groupWithOneSeatLeft(), view).ownerMobile()).isEqualTo("9876543210");
            assertThat(componentsOf(FlatmateGroupFeedDto.class)).doesNotContainKey("ownerMobile");
        }

        // seatsOpen deliberately disagrees with seatsTotal - members; a memberless fixture would
        // let both mappers fall back to the same derivation and prove nothing.
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
