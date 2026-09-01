package com.punenest.api.catalog;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import com.punenest.api.support.AbstractApiTest;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * The card says how many photos a listing has, and still refuses to say which.
 *
 * <p><strong>Why a count and not the array.</strong> The only question a card surface asks of a
 * gallery is "is there enough here" — search results render one image and never a second. Shipping
 * five URLs per row on a hundred-row page to answer a yes/no is several times the payload for none
 * of the benefit, so the count crosses the boundary and the photos do not.
 *
 * <p><strong>Why it exists at all.</strong> The reels feed is a walkthrough and requires three
 * frames. It read {@code gallery.length} off the list row; the list row has never carried
 * {@code images}; so every listing scored zero, nothing ever cleared the gate, and the feed was
 * permanently empty while presenting as a slow network. A count on the card is the cheapest honest
 * answer: the feed filters on it and then opens detail only for the handful that pass, rather than
 * opening detail for the whole catalogue to discover that most listings have one photo.
 *
 * <p>Both halves are asserted here, and the second is the one that would rot. A test that only
 * checked the number would stay green if somebody "helpfully" added the array beside it.
 *
 * <p>Mutation check (run, not reasoned): replacing the mapper expression with the constant {@code 3}
 * fails {@link #theCardCountsPhotosWithoutShippingThem} ({@code expected:<4> but was:<3>}) and
 * {@link #aListingWithNoPhotosCountsZeroRatherThanGoingAbsent} ({@code expected:<0> but was:<3>}) —
 * and, tellingly, <em>not</em> {@link #theCountAgreesWithTheGalleryTheDetailPageServes}, whose
 * fixture happens to have three photos. That is the whole argument for the zero and four cases being
 * here: a suite built only around a plausible-looking listing would have passed a hard-coded number.
 */
@DisplayName("Card projection — how many photos, never which ones")
class CardPhotoCountTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    private User owner() {
        User u = new User("9811000501", "owner");
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title, List<String> images) {
        Property p = new Property(owner, title, "buy", "apartment", 9000000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("total");
        p.setArea(new BigDecimal("1000"));
        p.setImages(images);
        p.setCoverImage(images.isEmpty() ? null : images.get(0));
        return properties.saveAndFlush(p);
    }

    @Test
    @DisplayName("the card counts the photos without shipping them")
    void theCardCountsPhotosWithoutShippingThem() throws Exception {
        User asha = owner();
        listing(asha, "Four framed", List.of("/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg"));

        mvc.perform(get("/properties").param("q", "Four framed"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].imageCount").value(4))
                // The point of the field: the gallery itself is not on the card. Asserted alongside
                // the count rather than in a test of its own, because the two claims fail together —
                // the tempting "fix" for a caller that wants photos is to add the array here.
                .andExpect(jsonPath("$.content[0].images").doesNotExist())
                .andExpect(jsonPath("$.content[0].coverImage").value("/a.jpg"));
    }

    @Test
    @DisplayName("a listing with no photos counts zero rather than going absent")
    void aListingWithNoPhotosCountsZeroRatherThanGoingAbsent() throws Exception {
        User asha = owner();
        listing(asha, "No frames", List.of());

        // The card is NON_NULL, so a boxed count would vanish from the response for exactly the
        // listings the feed most needs to reject — and an absent field reads as "unknown", which a
        // caller doing `?? gallery.length` would then answer wrongly. A primitive cannot vanish.
        mvc.perform(get("/properties").param("q", "No frames"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].imageCount").value(0));
    }

    @Test
    @DisplayName("the count agrees with the gallery the detail page serves")
    void theCountAgreesWithTheGalleryTheDetailPageServes() throws Exception {
        User asha = owner();
        Property p = listing(asha, "Three framed", List.of("/x.jpg", "/y.jpg", "/z.jpg"));

        // Cross-checked against the other endpoint rather than against the same number twice. The
        // feed decides from the card and then renders from the detail; if the two ever disagree it
        // shows a listing that promised a tour and delivers a still, which is the failure the
        // MIN_PHOTOS gate exists to prevent and would be invisible to a single-endpoint test.
        mvc.perform(get("/properties").param("q", "Three framed"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].imageCount").value(3));

        mvc.perform(get("/properties/" + p.getId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.images.length()").value(3));
    }
}
