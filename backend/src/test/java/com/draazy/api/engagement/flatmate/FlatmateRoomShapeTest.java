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

/** Pins the public projection so adding host-only fields requires an explicit contract decision. */
@DisplayName("D80 — the room feed shape is a projection of the detail shape, and stays one")
class FlatmateRoomShapeTest {

    // Public fields must serve a card, filter, map or flat ledger; host-only data stays below.
    private static final List<String> FEED_FIELDS = List.of(
            "id", "type", "propertyId", "roomKind", "roomType", "attachedBath", "priceBasis",
            "budget", "deposit", "noticePeriodDays", "lockInMonths", "maintenanceBilling",
            "electricityBilling", "occupancy", "occupants", "maxOccupants", "flatCommitted",
            "flatMax", "shareMax", "seatsTotal", "seatsOpen", "hostRole", "verificationTier",
            "verified", "reviewStatus", "society", "flatNumber", "locality", "localities", "lat",
            "lng", "bhk", "flatType", "homeTypeLabel", "gatedCommunity", "furnishing", "moveIn",
            "gender", "food", "tags", "note", "owner", "createdAt", "facing", "overlooking");

    // Contact and moderation forensics have no place on the anonymous feed.
    private static final List<String> DETAIL_ONLY_FIELDS = List.of(
            "agreementDeclared", "addressFingerprint", "flagForReview", "societyId",
            "availableFrom", "photos", "ownerMobile", "status", "modStatus");

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
            assertThat(componentsOf(FlatmateRoomFeedDto.class).keySet())
                    .containsExactlyInAnyOrderElementsOf(FEED_FIELDS);
        }
    }

    @Nested
    @DisplayName("The detail shape")
    class Detail {

        @Test
        @DisplayName("is the feed shape plus exactly the pinned host-only fields")
        void isFeedPlusHostOnlyFields() {
            assertThat(componentsOf(FlatmateRoomDto.class).keySet())
                    .containsExactlyInAnyOrderElementsOf(
                            java.util.stream.Stream.concat(FEED_FIELDS.stream(),
                                    DETAIL_ONLY_FIELDS.stream()).toList());
        }

        @Test
        @DisplayName("agrees with the feed shape on the type of every shared field")
        void sharedFieldsHaveTheSameType() {
            Map<String, Class<?>> feed = componentsOf(FlatmateRoomFeedDto.class);
            Map<String, Class<?>> detail = componentsOf(FlatmateRoomDto.class);
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
            // Each projection wires its own derivations; matching field names cannot prove parity.
            FlatmateRoom room = splitRoomInAPartlyOccupiedFlat();
            FlatmateMapper mapper = new FlatmateMapperImpl();
            FlatmateMapper.RoomView view = new FlatmateMapper.RoomView(2, "Asha", "9876543210", null);

            FlatmateRoomFeedDto feed = mapper.toFeedDto(room, view);
            FlatmateRoomDto detail = mapper.toDto(room, view);

            for (RecordComponent component : FlatmateRoomFeedDto.class.getRecordComponents()) {
                assertThat(component.getAccessor().invoke(feed))
                        .as("feed.%s should equal detail.%s", component.getName(), component.getName())
                        .isEqualTo(FlatmateRoomDto.class.getMethod(component.getName()).invoke(detail));
            }
        }

        // No seats: exercise the flat-wide occupancy ledger rather than the standalone branch.
        private FlatmateRoom splitRoomInAPartlyOccupiedFlat() {
            FlatmateRoom room = new FlatmateRoom();
            room.setPropertyId(UUID.randomUUID());
            room.setPriceBasis("room");
            room.setMaxOccupants(4);
            room.setOccupants(1);
            room.setBudget(15000L);
            room.setRoomType("Private room");
            room.setLocality("Baner");
            room.setSociety("Skyline Heights");
            return room;
        }
    }
}
