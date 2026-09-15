package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class FlatmateRoomOutlookMapperTest {

    private final JsonMapper json = JsonMapper.builder()
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES).build();
    private final FlatmateMapper mapper = new FlatmateMapperImpl();

    @ParameterizedTest
    @CsvSource({"E,Garden", "W,Amenity", "N,Parking", "S,Main Road"})
    void mapsTrimmedIndependentFieldsToBothResponses(String facing, String overlooking) {
        FlatmateRoom room = room();
        mapper.applyTo(request("\"facing\":\"  " + facing
                + "  \",\"overlooking\":\"  " + overlooking + "  \""), room);

        assertOutlook(room, facing, overlooking);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "\"facing\":null,\"overlooking\":null",
            "\"facing\":\"  \",\"overlooking\":\"  \""})
    void omittedNullAndBlankClearExistingValues(String fields) {
        FlatmateRoom room = room();
        mapper.applyTo(request("\"facing\":\"E\",\"overlooking\":\"Garden\""), room);
        assertOutlook(room, "E", "Garden");

        mapper.applyTo(request(fields), room);

        assertOutlook(room, null, null);
    }

    private FlatmateRoomCreateRequest request(String fields) {
        return json.readValue("{\"locality\":\"Baner\",\"photos\":[]"
                + (fields.isEmpty() ? "" : "," + fields) + "}", FlatmateRoomCreateRequest.class);
    }

    private FlatmateRoom room() {
        return new FlatmateRoom(UUID.randomUUID(), "Private room", "Baner", 15000L);
    }

    private void assertOutlook(FlatmateRoom room, String facing, String overlooking) {
        var view = FlatmateMapper.RoomView.anonymous(0, "Host");
        for (Object dto : new Object[]{mapper.toDto(room, view), mapper.toFeedDto(room, view)}) {
            JsonNode tree = json.valueToTree(dto);
            assertThat(tree.has("facing")).isTrue();
            assertThat(tree.has("overlooking")).isTrue();
            assertThat(tree.get("facing")).isEqualTo(json.valueToTree(facing));
            assertThat(tree.get("overlooking")).isEqualTo(json.valueToTree(overlooking));
        }
    }
}