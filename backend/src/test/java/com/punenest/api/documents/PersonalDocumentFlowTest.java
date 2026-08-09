package com.punenest.api.documents;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.common.web.Routes;
import com.punenest.api.documents.vault.PersonalDocumentRepository;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockMultipartFile;

/**
 * The personal (KYC) vault: {@code GET/POST /me/documents/personal} and
 * {@code DELETE /me/documents/personal/{docId}} (slice A, V32).
 *
 * <p>Organised around the invariants that make this a separate resource from the property vault:
 * it is owned by the <em>person</em>, its {@code personal} route out-ranks the vault's
 * {@code {propId}} template, and — as with {@link DocumentVaultTest} — a stored row never carries a
 * persisted URL and the sniffed type wins over the declared one.
 */
class PersonalDocumentFlowTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PersonalDocumentRepository personalDocuments;

    private User user(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private static MockMultipartFile pdf(String name) {
        return new MockMultipartFile("file", name, "application/pdf", "%PDF-1.4 aadhaar".getBytes());
    }

    private String upload(User owner, String category, MockMultipartFile file) throws Exception {
        String json = mvc.perform(multipart(Routes.MeDocuments.PERSONAL)
                        .file(file)
                        .param("category", category)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    // ---------------- routing ----------------

    @Test
    void personalRoute_outranksThePropIdTemplate_soItReachesThePersonalHandler() throws Exception {
        User owner = user("9821002001");

        // If `personal` were read as a {propId}, this would resolve to the vault handler and 404 as
        // an unknown property. It is a literal segment, so it wins over the template (the same
        // resolution rule that keeps /me/documents/requests out of the vault) and returns the
        // caller's — empty — personal list instead.
        mvc.perform(get(Routes.MeDocuments.PERSONAL)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    // ---------------- upload ----------------

    @Test
    void uploadPersonal_returnsAMintedUrlThatIsNotStoredOnTheRow() throws Exception {
        User owner = user("9821002002");

        String id = upload(owner, "Aadhaar Card", pdf("aadhaar.pdf"));

        // The wire carries a signed URL; the row carries only an opaque, owner-scoped storage key.
        assertThat(personalDocuments.findById(java.util.UUID.fromString(id)))
                .get()
                .satisfies(d -> {
                    assertThat(d.getOwnerId()).isEqualTo(owner.getId());
                    assertThat(d.getStorageKey()).startsWith("personal/" + owner.getId() + "/");
                    assertThat(d.getStorageKey()).doesNotContain("http");
                });
    }

    @Test
    void uploadPersonal_carriesTheLiteralPersonalBucketOnTheWire() throws Exception {
        User owner = user("9821002003");

        // propertyId="personal" is the same bucket key the front end already reads with; the client
        // mapper drops the field, but the contract stays a single Document shape.
        mvc.perform(multipart(Routes.MeDocuments.PERSONAL)
                        .file(pdf("pan.pdf"))
                        .param("category", "PAN Card")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.propertyId").value("personal"))
                .andExpect(jsonPath("$.category").value("PAN Card"))
                .andExpect(jsonPath("$.url").exists());
    }

    @Test
    void uploadPersonal_refusesHtmlDisguisedAsAPdf() throws Exception {
        User owner = user("9821002004");

        mvc.perform(multipart(Routes.MeDocuments.PERSONAL)
                        .file(new MockMultipartFile("file", "aadhaar.pdf", "application/pdf",
                                "<html><script>alert(1)</script>".getBytes()))
                        .param("category", "Aadhaar Card")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error").value("unsupported_media_type"));
    }

    // ---------------- list ----------------

    @Test
    void listPersonal_showsOnlyTheCallersOwnPapers_newestFirst() throws Exception {
        User owner = user("9821002005");
        User other = user("9821002006");
        upload(owner, "Aadhaar Card", pdf("aadhaar.pdf"));
        upload(owner, "PAN Card", pdf("pan.pdf"));
        upload(other, "Aadhaar Card", pdf("theirs.pdf"));

        mvc.perform(get(Routes.MeDocuments.PERSONAL)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].category").value("PAN Card"))
                .andExpect(jsonPath("$[0].propertyId").value("personal"));
    }

    @Test
    void personalRoutes_requireAuthentication() throws Exception {
        mvc.perform(get(Routes.MeDocuments.PERSONAL))
                .andExpect(status().isUnauthorized());
    }

    // ---------------- delete ----------------

    @Test
    void deletePersonal_removesItFromTheCallersVault() throws Exception {
        User owner = user("9821002007");
        String id = upload(owner, "Aadhaar Card", pdf("aadhaar.pdf"));

        mvc.perform(delete(Routes.MeDocuments.PERSONAL_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());

        mvc.perform(get(Routes.MeDocuments.PERSONAL)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void deletePersonal_isA404OnAnotherUsersDocument_notA403() throws Exception {
        User owner = user("9821002008");
        User stranger = user("9821002009");
        String id = upload(owner, "Aadhaar Card", pdf("aadhaar.pdf"));

        // 403 would confirm that this document exists; owner-scoping by lookup answers 404.
        mvc.perform(delete(Routes.MeDocuments.PERSONAL_BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());

        // ...and it is still there for its real owner.
        mvc.perform(get(Routes.MeDocuments.PERSONAL)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void deletePersonal_treatsANonUuidIdAsAMiss_notAMalformedRequest() throws Exception {
        User owner = user("9821002010");

        mvc.perform(delete(Routes.MeDocuments.PERSONAL_BY_ID, "not-a-uuid")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNotFound());
    }
}
