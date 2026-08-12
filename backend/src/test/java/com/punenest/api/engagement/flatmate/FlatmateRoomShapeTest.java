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
 * D80 — the room wire has two shapes, and this is what stops them collapsing back into one.
 *
 * <p>The split is only worth anything if it <em>stays</em> split. A 47-field DTO does not arrive in
 * one commit; it arrives one "while I'm here" field at a time, each individually reasonable. So the
 * feed shape's field set is pinned by name here rather than described in prose: adding a field to
 * the card projection now requires editing this list, which is the moment to ask whether a card
 * actually renders it.
 *
 * <p>Deliberately plain JUnit — no Spring context, no database. The property under test is the
 * shape of two records, and a guard that takes twenty seconds to start is a guard people stop
 * running.
 */
@DisplayName("D80 — the room feed shape is a projection of the detail shape, and stays one")
class FlatmateRoomShapeTest {

    /**
     * What an anonymous room read carries. Every name here was checked against a real consumer
     * under {@code frontend/src} — a card, a filter, the map, or the client-side flat ledger.
     */
    private static final List<String> FEED_FIELDS = List.of(
            "id", "type", "propertyId", "roomKind", "roomType", "attachedBath", "priceBasis",
            "budget", "deposit", "occupancy", "occupants", "maxOccupants", "flatCommitted",
            "flatMax", "shareMax", "seatsTotal", "seatsOpen", "hostRole", "verificationTier",
            "verified", "society", "flatNumber", "locality", "localities", "lat",
            "lng", "bhk", "flatType", "homeTypeLabel", "gatedCommunity", "furnishing", "moveIn",
            "gender", "food", "tags", "note", "owner", "createdAt");

    /**
     * What only the host's own view of a room adds. Three of these are anti-broker forensics the
     * client only ever writes, one is contact, one is the moderation verdict (D210 — it labels the
     * author's own copy as pending review, and tells a stranger nothing they can act on), and four
     * have no reader at all — see {@link FlatmateRoomFeedDto} for the evidence behind each.
     */
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
            // The derivation *methods* are shared by call, but the @Mapping wiring that invokes
            // them is written out twice, once per target type, and MapStruct offers no way to
            // inherit it across differing targets. So editing occupancyOf's arguments on toDto
            // and not on toFeedDto compiles, generates, and ships two different payloads for the
            // same room. Nothing structural can prevent that; this is what catches it.
            FlatmateRoom room = splitRoomInAPartlyOccupiedFlat();
            FlatmateMapper mapper = new FlatmateMapperImpl();
            FlatmateMapper.RoomView view = new FlatmateMapper.RoomView(2, "Asha", "9876543210");

            FlatmateRoomFeedDto feed = mapper.toFeedDto(room, view);
            FlatmateRoomDto detail = mapper.toDto(room, view);

            for (RecordComponent component : FlatmateRoomFeedDto.class.getRecordComponents()) {
                assertThat(component.getAccessor().invoke(feed))
                        .as("feed.%s should equal detail.%s", component.getName(), component.getName())
                        .isEqualTo(FlatmateRoomDto.class.getMethod(component.getName()).invoke(detail));
            }
        }

        /**
         * A split room, not a seat-based one — {@code seatsTotal} stays null so {@code isSeatBased}
         * is false and the derivations exercise the occupancy-ledger branch rather than the seat
         * branch. A fixture that took the easy path would let a ledger bug through.
         */
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
