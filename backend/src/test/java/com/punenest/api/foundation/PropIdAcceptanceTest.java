package com.punenest.api.foundation;

import com.punenest.api.support.AbstractApiTest;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;

/**
 * Pins what a {@code {propId}} path segment accepts, route family by route family.
 *
 * <p><strong>Why this exists.</strong> Twenty-one operations in the contract spell their property
 * segment {@code {propId}}, and behind that one name the server does three different things. Until
 * this class, not one test anywhere passed a <em>slug</em> to any of them, so all three behaviours
 * were unpinned: a refactor could have flipped any route from one shape to another and every suite
 * would still have been green.
 *
 * <p><strong>The three shapes.</strong>
 *
 * <table>
 *   <caption>What each family does with a slug</caption>
 *   <tr><th>Binding</th><th>Slug gives</th><th>Families</th></tr>
 *   <tr>
 *     <td>{@code @PathVariable UUID}</td>
 *     <td><strong>400</strong> â€” Spring's converter fails before the handler runs</td>
 *     <td>saved, reviews, tenancy declarations</td>
 *   </tr>
 *   <tr>
 *     <td>{@code @PathVariable String} + {@code Ids.parseUuid(..).orElseThrow(NotFound)}</td>
 *     <td><strong>404</strong> â€” the handler runs and rejects the token itself</td>
 *     <td>deals (6), finalization (2), finances (6)</td>
 *   </tr>
 *   <tr>
 *     <td>{@code @PathVariable String} + service-side slug fallback</td>
 *     <td><strong>it works</strong> â€” {@code findBySlugAndOwner_Id}</td>
 *     <td>documents (2), boost (1)</td>
 *   </tr>
 * </table>
 *
 * <p><strong>What this class does not do.</strong> It does not argue that three shapes are correct;
 * they are not, and reconciling them is a behaviour change across seventeen operations that needs a
 * decision, not a test. It pins the shapes precisely so that the reconciliation, when it happens, is
 * visible as a red test rather than as a silent change of meaning. If you are here because you made
 * the strict routes lenient, this class failing is the point â€” update it and say so.
 *
 * <p><strong>What this cost.</strong> A client addressed {@code PUT /me/saved/{propId}} with the
 * slug it had been routing on. Every save answered 400. Because the heart control is optimistic, it
 * filled for one frame and the {@code catch} rolled it back, so the only visible symptom was nothing
 * happening. That is fixed; this is the guard that would have caught it.
 */
class PropIdAcceptanceTest extends AbstractApiTest {

    /**
     * A slug that is a perfectly well-formed slug and is not a UUID. The point of the constant is
     * that nothing about it is malformed â€” it is exactly what the client had in hand.
     */
    private static final String SLUG = "2bhk-kothrud-propid-guard";

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;

    private User owner() {
        User u = new User("9820007701", "owner");
        u.setName("Nikhil Bhosale");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner) {
        Property p = new Property(owner, "PropId guard flat", "rent", "apartment", 22000L,
                "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("900"));
        p.setSlug(SLUG);
        return properties.saveAndFlush(p);
    }

    // ---------------- shape 1: @PathVariable UUID, 400 ----------------

    @Test
    void savedByProperty_rejectsASlugWithFourHundred() throws Exception {
        User u = owner();
        listing(u);

        // Not 404. The handler never runs: Spring cannot build a UUID out of the segment, so the
        // request dies in conversion. A caller seeing this is being told "your identifier is the
        // wrong kind", which is the truth, and is why the contract now types this `format: uuid`.
        mvc.perform(put(Routes.Engagement.SAVED_BY_PROPERTY, SLUG)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void savedByProperty_acceptsTheUuid() throws Exception {
        User u = owner();
        Property p = listing(u);

        // The positive half matters as much as the negative one: without it, a route that started
        // answering 400 to *everything* would still pass the test above.
        mvc.perform(put(Routes.Engagement.SAVED_BY_PROPERTY, p.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNoContent());
    }

    @Test
    void propertyReviews_rejectsASlugWithFourHundred() throws Exception {
        listing(owner());

        // Public route â€” no bearer. The identifier is rejected before authorisation would matter,
        // which is worth pinning: a 401 here would mean the conversion had stopped happening first.
        mvc.perform(get(Routes.Reviews.FOR_PROPERTY, SLUG))
                .andExpect(status().isBadRequest());
    }

    // ---------------- shape 2: String + parseUuid, 404 ----------------

    @Test
    void deals_rejectsASlugWithFourOhFour() throws Exception {
        User u = owner();
        listing(u);

        // The dangerous shape. 404 on a slug is indistinguishable from 404 on a listing that was
        // taken down, so a caller making this mistake reads it as "the property is gone" and stops
        // looking. The status differs from the saved route above only because the constraint is
        // expressed by a helper instead of by a type â€” nothing about the intent differs.
        mvc.perform(get(Routes.Deals.BY_PROP, SLUG)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNotFound());
    }

    @Test
    void finances_rejectsASlugWithFourOhFour() throws Exception {
        User u = owner();
        listing(u);

        mvc.perform(get(Routes.Finances.TRANSACTIONS, SLUG)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isNotFound());
    }

    // ---------------- shape 3: service-side fallback, works ----------------

    @Test
    void documentVault_acceptsASlug() throws Exception {
        User u = owner();
        listing(u);

        // DocumentService.ownedProperty tries Ids.parseUuid, then findBySlugAndOwner_Id. This and
        // the boost endpoints are the only three operations under {propId} where that is true, and
        // the Javadoc on that method used to claim it was true "as everywhere else" â€” it is not,
        // and the two tests above are the proof.
        mvc.perform(get(Routes.MeDocuments.FOR_PROPERTY, SLUG)
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk());
    }

    @Test
    void documentVault_alsoAcceptsTheUuid() throws Exception {
        User u = owner();
        Property p = listing(u);

        mvc.perform(get(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(u)))
                .andExpect(status().isOk());
    }
}
