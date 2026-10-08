package com.draazy.api.catalog.locality;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.provider.PlacesLookup;
import com.draazy.api.provider.PlacesLookup.Place;
import com.draazy.api.support.AbstractApiTest;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.ResultActions;

@DisplayName("Localities: resolve a picked Google place, search the live ones")
class LocalityResolveEndpointsTest extends AbstractApiTest {

    private static final String PICK = "Pick the locality from the suggestions.";
    private static final String OUTSIDE = "Pick a locality in Pune.";

    @MockitoBean PlacesLookup places;

    @BeforeEach
    void googleEchoesTheHint() {
        when(places.details(any(), any())).thenAnswer(call -> {
            Place hint = call.getArgument(1);
            return hint != null && hint.name() != null && !hint.name().isBlank()
                    ? Optional.of(hint) : Optional.empty();
        });
    }

    private ResultActions resolve(String placeId, String name, double lat, double lng, String type) throws Exception {
        String body = "{\"placeId\":\"" + placeId + "\",\"name\":\"" + name + "\",\"lat\":" + lat
                + ",\"lng\":" + lng + ",\"types\":[\"" + type + "\",\"political\"]}";
        return mvc.perform(post("/localities/resolve").contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private void row(String slug, String name, double lat, double lng, String placeId, boolean archived) {
        jdbc.update("insert into localities (slug, name, city, lat, lng, place_id, active, archived_at) "
                + "values (?, ?, 'Pune', ?, ?, ?, ?, " + (archived ? "now()" : "null") + ")",
                slug, name, lat, lng, placeId, !archived);
    }

    private boolean live(String slug) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "select archived_at is null from localities where slug=?", Boolean.class, slug));
    }

    private String placeIdOf(String slug) {
        return jdbc.queryForObject("select place_id from localities where slug=?", String.class, slug);
    }

    @Test
    void mintsAFreshLocalityFromAPickedPlace() throws Exception {
        resolve("ChIJ-mint-1", "Zzmint Colony", 18.61, 73.77, "sublocality_level_1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("zzmint-colony"))
                .andExpect(jsonPath("$.name").value("Zzmint Colony"))
                .andExpect(jsonPath("$.city").value("Pune"));

        assertThat(placeIdOf("zzmint-colony")).isEqualTo("ChIJ-mint-1");
        assertThat(live("zzmint-colony")).isTrue();
    }

    @Test
    void theSamePlaceResolvesToTheSameRowWithoutAskingGoogleAgain() throws Exception {
        resolve("ChIJ-same", "Zzsame Nagar", 18.6, 73.7, "neighborhood").andExpect(status().isOk());
        resolve("ChIJ-same", "Other Name", 10.0, 70.0, "neighborhood")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("zzsame-nagar"));

        assertThat(jdbc.queryForObject("select count(*) from localities where place_id='ChIJ-same'", Integer.class))
                .isEqualTo(1);
    }

    @Test
    void adoptsARetiredRowOfTheSameNameThatIsNearby() throws Exception {
        row("zzold-wadi", "Zzold Wadi", 18.50, 73.80, null, true);

        resolve("ChIJ-adopt", "Zzold Wadi", 18.505, 73.805, "sublocality_level_2")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("zzold-wadi"));

        assertThat(placeIdOf("zzold-wadi")).isEqualTo("ChIJ-adopt");
        assertThat(live("zzold-wadi")).isTrue();
    }

    @Test
    void mintsASuffixedSlugRatherThanAdoptingARetiredRowThatIsFarAway() throws Exception {
        row("zzfar-peth", "Zzfar Peth", 18.30, 73.40, null, true);

        resolve("ChIJ-far", "Zzfar Peth", 18.90, 74.30, "sublocality")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("zzfar-peth-2"));

        assertThat(live("zzfar-peth")).isFalse();
    }

    @Test
    void doesNotAdoptARetiredRowAlreadyTiedToAnotherPlace() throws Exception {
        row("zztied-park", "Zztied Park", 18.5, 73.8, "ChIJ-owner", true);

        resolve("ChIJ-other", "Zztied Park", 18.5, 73.8, "sublocality_level_1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("zztied-park-2"));

        assertThat(placeIdOf("zztied-park")).isEqualTo("ChIJ-owner");
    }

    @Test
    void aLiveRowOfTheSameNameNearbyIsReturnedInsteadOfMintingADuplicate() throws Exception {
        row("zztwin-nagar", "Zztwin Nagar", 18.500, 73.800, "ChIJ-first", false);

        resolve("ChIJ-second", "zztwin nagar", 18.505, 73.805, "sublocality_level_1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("zztwin-nagar"));

        assertThat(jdbc.queryForObject("select count(*) from localities where lower(name)='zztwin nagar'",
                Integer.class)).isEqualTo(1);
    }

    @Test
    void aLiveRowOfTheSameNameFarAwayDoesNotBlockAMint() throws Exception {
        row("zzapart-nagar", "Zzapart Nagar", 18.30, 73.40, "ChIJ-first", false);

        resolve("ChIJ-second", "Zzapart Nagar", 18.90, 74.30, "sublocality_level_1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("zzapart-nagar-2"));
    }

    @Test
    void aNameThatSlugsToAReservedWordGetsASuffix() throws Exception {
        resolve("ChIJ-reserved-1", "Search", 18.52, 73.85, "sublocality_level_1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("search-2"));
        resolve("ChIJ-reserved-2", "Resolve", 18.62, 73.75, "sublocality_level_1")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("resolve-2"));
    }

    @Test
    void refusesAPlaceOutsideThePuneMetropolitanRegion() throws Exception {
        resolve("ChIJ-mumbai", "Zzmumbai Colony", 19.07, 72.87, "sublocality_level_1")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(OUTSIDE));
        resolve("ChIJ-edge", "Zzedge Colony", 18.96, 73.80, "sublocality_level_1")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(OUTSIDE));
    }

    @Test
    void refusesAPlaceWithoutCoordinates() throws Exception {
        mvc.perform(post("/localities/resolve").contentType(MediaType.APPLICATION_JSON)
                .content("{\"placeId\":\"ChIJ-nopin\",\"name\":\"Zznopin Colony\",\"types\":[\"locality\"]}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(OUTSIDE));
    }

    @Test
    void aRejectedPlaceIsNotAskedAboutAgain() throws Exception {
        when(places.details(any(), any())).thenReturn(Optional.empty());

        resolve("ChIJ-neg-cache", "Zzghost Town", 18.52, 73.85, "locality").andExpect(status().isUnprocessableEntity());
        resolve("ChIJ-neg-cache", "Zzghost Town", 18.52, 73.85, "locality").andExpect(status().isUnprocessableEntity());

        verify(places, times(1)).details(any(), any());
    }

    @Test
    void anUnavailableLookupIsNotRemembered() throws Exception {
        when(places.details(any(), any())).thenThrow(new PlacesLookup.UnavailableException("down", null));
        resolve("ChIJ-flaky", "Zzflaky Nagar", 18.52, 73.85, "locality").andExpect(status().isServiceUnavailable());

        doAnswer(call -> Optional.of(call.getArgument(1, Place.class))).when(places).details(any(), any());
        resolve("ChIJ-flaky", "Zzflaky Nagar", 18.52, 73.85, "locality").andExpect(status().isOk());
    }

    @Test
    void aMalformedPlaceIdIsRejectedBeforeAnyLookup() throws Exception {
        resolve("bad id/with?chars", "Zzbad Nagar", 18.52, 73.85, "locality").andExpect(status().isUnprocessableEntity());

        verify(places, times(0)).details(any(), any());
    }

    @Test
    void refusesTheCityItself() throws Exception {
        resolve("ChIJ-city", "Pune", 18.52, 73.85, "locality")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(PICK));
    }

    @Test
    void refusesAPlaceThatIsNotALocality() throws Exception {
        resolve("ChIJ-shop", "Some Cafe", 18.52, 73.85, "cafe")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(PICK));
    }

    @Test
    void refusesAPlaceGoogleDoesNotKnow() throws Exception {
        when(places.details(any(), any())).thenReturn(Optional.empty());

        resolve("ChIJ-ghost", "Ghost Town", 18.52, 73.85, "locality")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.message").value(PICK));
    }

    @Test
    void answers503WhenTheLookupIsDown() throws Exception {
        when(places.details(any(), any())).thenThrow(new PlacesLookup.UnavailableException("down", null));

        resolve("ChIJ-down", "Zzdown Nagar", 18.52, 73.85, "locality")
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error").value("service_unavailable"));
    }

    @Test
    void aBlankPlaceIdIsRejected() throws Exception {
        mvc.perform(post("/localities/resolve").contentType(MediaType.APPLICATION_JSON)
                .content("{\"placeId\":\"\",\"name\":\"X\"}"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void searchReturnsLiveLocalitiesOnly() throws Exception {
        row("zzsearch-live", "Zzsearch Live", 18.5, 73.8, "p-live", false);
        row("zzsearch-gone", "Zzsearch Gone", 18.5, 73.8, null, true);

        mvc.perform(get("/localities/search").param("q", "zzsearch"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].slug").value("zzsearch-live"));
    }

    @Test
    void searchHonoursTheLimitAndTreatsBlankAndWildcardsAsEmpty() throws Exception {
        row("zzlim-a", "Zzlim A", 18.5, 73.8, "p-a", false);
        row("zzlim-b", "Zzlim B", 18.5, 73.8, "p-b", false);

        mvc.perform(get("/localities/search").param("q", "zzlim").param("limit", "1"))
                .andExpect(jsonPath("$.length()").value(1));
        mvc.perform(get("/localities/search").param("q", "  "))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
        mvc.perform(get("/localities/search").param("q", "%"))
                .andExpect(jsonPath("$.length()").value(0));
    }
}
