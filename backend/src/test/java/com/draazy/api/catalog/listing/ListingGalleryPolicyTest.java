package com.draazy.api.catalog.listing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.PhotoHash;
import com.draazy.api.catalog.property.PropertyMapper;
import com.draazy.api.common.error.GlobalExceptionHandler;
import com.draazy.api.security.AuthPrincipal;
import jakarta.validation.Validation;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.IntStream;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import tools.jackson.databind.ObjectMapper;

/** Exercise MVC validation before any listing write, without opening a database. */
class ListingGalleryPolicyTest {

    private static final UUID OWNER = UUID.randomUUID();
    private final ListingService listings = mock(ListingService.class);
    private final ObjectMapper json = new ObjectMapper();
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new AuthPrincipal(OWNER, "owner", null, true, false), null, List.of()));
        mvc = MockMvcBuilders.standaloneSetup(new MeListingsController(listings, mock(PropertyMapper.class)))
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver())
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @AfterEach
    void clearIdentity() {
        SecurityContextHolder.clearContext();
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 10})
    void acceptsCreateAndUpdateAtTheGalleryBoundary(int count) throws Exception {
        List<String> images = images(count);
        mvc.perform(post("/me/listings").contentType(MediaType.APPLICATION_JSON)
                        .content(createBody(images)))
                .andExpect(status().isCreated());
        mvc.perform(patch("/me/listings/existing").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("images", images))))
                .andExpect(status().isOk());
        verify(listings).create(eq(OWNER), argThat(body -> body.images().equals(images)));
        verify(listings).update(eq(OWNER), eq("existing"), argThat(body -> body.images().equals(images)));
    }

    @ParameterizedTest
    @ValueSource(ints = {11, 20, 10_000})
    void refusesOversizedCreateAndExistingGalleryUpdateRatherThanTruncating(int count) throws Exception {
        List<String> images = images(count);
        mvc.perform(post("/me/listings").contentType(MediaType.APPLICATION_JSON)
                        .content(createBody(images)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("images"));
        mvc.perform(patch("/me/listings/existing").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("images", images))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value("images"));
        verifyNoInteractions(listings);
    }

    @Test
    void omittedGalleryLeavesExistingImagesAlone() throws Exception {
        mvc.perform(patch("/me/listings/existing").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Updated title\"}"))
                .andExpect(status().isOk());
        verify(listings).update(eq(OWNER), eq("existing"), argThat(body -> body.images() == null));
    }

    /**
     * A null element is the one shape {@code @Size} and {@code @Pattern} both wave through, and {@code List.copyOf}
     * throws on it. Without the element-level {@code @NotNull} that is a 500 on a fixable body.
     */
    @ParameterizedTest
    @ValueSource(strings = {"images", "amenities", "tenants"})
    void aNullListElementIsRefusedRatherThanThrownOn(String field) throws Exception {
        String body = "{\"title\":\"Home\",\"deal\":\"rent\",\"propertyType\":\"Flat\",\"price\":25000,"
                + "\"locality\":\"Baner\",\"city\":\"Pune\",\"" + field + "\":[null]}";
        mvc.perform(post("/me/listings").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value(Matchers.startsWith(field)));
        mvc.perform(patch("/me/listings/existing").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"" + field + "\":[null]}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.fields[0].field").value(Matchers.startsWith(field)));
        verifyNoInteractions(listings);
    }

    @Test
    void galleryCapDoesNotChangeThePhotoHashCap() {
        assertThat(PhotoHash.MAX_PER_LISTING).isEqualTo(20);
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            for (Class<?> dto : List.of(ListingCreate.class, ListingUpdate.class)) {
                assertThat(validator.validateValue(dto, "images", null)).isEmpty();
                assertThat(validator.validateValue(dto, "photoHashes", images(20))).isEmpty();
                assertThat(validator.validateValue(dto, "photoHashes", images(21))).hasSize(1);
            }
        }
    }

    private String createBody(List<String> images) {
        return json.writeValueAsString(Map.of("title", "Home", "deal", "rent", "propertyType", "Flat",
                "price", 25_000, "locality", "Baner", "city", "Pune", "images", images));
    }

    private static List<String> images(int count) {
        return IntStream.range(0, count).mapToObj(index -> "https://cdn.example/photo-" + index).toList();
    }
}