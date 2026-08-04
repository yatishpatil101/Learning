package com.punenest.api.documents;

import com.punenest.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.catalog.property.PropertyRepository;
import com.punenest.api.common.web.Routes;
import com.punenest.api.documents.vault.DocumentRepository;
import com.punenest.api.documents.vault.DocumentUploads;
import com.punenest.api.identity.user.User;
import com.punenest.api.identity.user.UserRepository;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockMultipartFile;

/**
 * The document vault: {@code GET/POST /me/documents/{propId}} and
 * {@code DELETE /me/documents/{propId}/{docId}}.
 *
 * <p>Organised around the invariants rather than the endpoints — strict owner-scoping, the upload
 * allowlist, and the rule that a stored row never carries a persisted URL.
 */
class DocumentVaultTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    PropertyRepository properties;
    @Autowired
    DocumentRepository documents;

    private User user(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    private Property listing(User owner, String title) {
        Property p = new Property(owner, title, "rent", "apartment", 25000L, "Kothrud", "Pune");
        p.setBhk(new BigDecimal("2"));
        p.setStatus("approved");
        p.setPriceUnit("per-month");
        p.setArea(new BigDecimal("1000"));
        return properties.saveAndFlush(p);
    }

    private static MockMultipartFile pdf(String name) {
        return new MockMultipartFile("file", name, "application/pdf", "%PDF-1.4 deed".getBytes());
    }

    private String upload(User owner, Property p, String category, MockMultipartFile file)
            throws Exception {
        String json = mvc.perform(multipart(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .file(file)
                        .param("category", category)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    // ---------------- upload ----------------

    @Test
    void uploadDocument_returnsAMintedUrlThatIsNotStoredOnTheRow() throws Exception {
        User owner = user("9820001001");
        Property p = listing(owner, "Vault flat");

        String id = upload(owner, p, "Sale Deed", pdf("deed.pdf"));

        // The wire carries a signed URL; the row carries only an opaque storage key. A URL in the
        // column would be a permanent, un-revocable credential to a title deed.
        assertThat(documents.findById(java.util.UUID.fromString(id)))
                .get()
                .satisfies(d -> {
                    assertThat(d.getStorageKey()).startsWith("documents/" + p.getId() + "/");
                    assertThat(d.getStorageKey()).doesNotContain("http");
                });
    }

    @Test
    void uploadDocument_refusesATypeThatIsNotADocumentOrAScan() throws Exception {
        User owner = user("9820001002");
        Property p = listing(owner, "Html flat");

        // An HTML upload served back from a punenest-looking signed URL is a phishing host.
        mvc.perform(multipart(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .file(new MockMultipartFile("file", "evil.html", "text/html",
                                "<script>".getBytes()))
                        .param("category", "Sale Deed")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error").value("unsupported_media_type"));
    }

    @Test
    void uploadDocument_refusesAFileOverTheSizeCeiling() throws Exception {
        User owner = user("9820001003");
        Property p = listing(owner, "Big file flat");

        byte[] tooBig = new byte[(int) DocumentUploads.MAX_BYTES + 1];
        mvc.perform(multipart(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .file(new MockMultipartFile("file", "huge.pdf", "application/pdf", tooBig))
                        .param("category", "Sale Deed")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.error").value("payload_too_large"));
    }

    @Test
    void uploadDocument_sanitisesTheClientFilenameRatherThanEchoingIt() throws Exception {
        User owner = user("9820001004");
        Property p = listing(owner, "Nasty name flat");

        mvc.perform(multipart(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .file(new MockMultipartFile("file", "../../etc/<script>.pdf",
                                "application/pdf", "%PDF-1.4".getBytes()))
                        .param("category", "Sale Deed")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.fileName").value("_script_.pdf"));
    }

    @Test
    void uploadDocument_refusesHtmlDisguisedAsAPdf() throws Exception {
        User owner = user("9820001012");
        Property p = listing(owner, "Disguised flat");

        // The allowlist alone never saw this: the declared type is on it. Only the bytes give the
        // file away, which is exactly the case the sniff exists for (tech-debt D40).
        mvc.perform(multipart(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .file(new MockMultipartFile("file", "deed.pdf", "application/pdf",
                                "<html><script>alert(1)</script>".getBytes()))
                        .param("category", "Sale Deed")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error").value("unsupported_media_type"));
    }

    @Test
    void uploadDocument_refusesARealImageDeclaredAsTheWrongImageType() throws Exception {
        User owner = user("9820001013");
        Property p = listing(owner, "Mislabelled flat");

        // Both types are on the allowlist, so this is caught only by the two claims disagreeing.
        byte[] png = new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0};
        mvc.perform(multipart(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .file(new MockMultipartFile("file", "scan.jpg", "image/jpeg", png))
                        .param("category", "Sale Deed")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isUnsupportedMediaType());
    }

    @Test
    void uploadDocument_storesTheSniffedTypeNotTheDeclaredOne() throws Exception {
        User owner = user("9820001014");
        Property p = listing(owner, "Charset flat");

        // A browser-supplied type with a charset parameter must still land as a clean media type,
        // because this string becomes the response Content-Type when the file is served back.
        mvc.perform(multipart(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .file(new MockMultipartFile("file", "deed.pdf", "application/pdf; charset=utf-8",
                                "%PDF-1.7 deed".getBytes()))
                        .param("category", "Sale Deed")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated());

        assertThat(documents.findAll())
                .filteredOn(d -> d.getPropertyId().equals(p.getId()))
                .singleElement()
                .satisfies(d -> assertThat(d.getMimeType()).isEqualTo("application/pdf"));
    }

    @Test
    void uploadDocument_isA404OnSomeoneElsesListing_notA403() throws Exception {
        User owner = user("9820001005");
        User stranger = user("9820001006");
        Property p = listing(owner, "Not yours");

        // 403 would confirm that this listing -- and therefore its paperwork -- exists.
        mvc.perform(multipart(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .file(pdf("deed.pdf"))
                        .param("category", "Sale Deed")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
    }

    // ---------------- list ----------------

    @Test
    void listDocuments_showsOnlyThisPropertysFiles_newestFirst() throws Exception {
        User owner = user("9820001007");
        Property one = listing(owner, "Flat one");
        Property two = listing(owner, "Flat two");
        upload(owner, one, "Sale Deed", pdf("deed.pdf"));
        upload(owner, one, "Index II", pdf("index.pdf"));
        upload(owner, two, "Sale Deed", pdf("other.pdf"));

        mvc.perform(get(Routes.MeDocuments.FOR_PROPERTY, one.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].propertyId").value(one.getId().toString()))
                .andExpect(jsonPath("$[0].url").exists());
    }

    @Test
    void listDocuments_isA404ForAStranger() throws Exception {
        User owner = user("9820001008");
        User stranger = user("9820001009");
        Property p = listing(owner, "Private vault");
        upload(owner, p, "Sale Deed", pdf("deed.pdf"));

        mvc.perform(get(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
    }

    // ---------------- delete ----------------

    @Test
    void deleteDocument_removesItFromTheOwnersVault() throws Exception {
        User owner = user("9820001010");
        Property p = listing(owner, "Delete flat");
        String id = upload(owner, p, "Sale Deed", pdf("deed.pdf"));

        mvc.perform(delete(Routes.MeDocuments.BY_ID, p.getId().toString(), id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());

        mvc.perform(get(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void deleteDocument_refusesADocumentThatBelongsToAnotherPropertyOfTheSameOwner() throws Exception {
        User owner = user("9820001011");
        Property one = listing(owner, "Flat A");
        Property two = listing(owner, "Flat B");
        String idOnTwo = upload(owner, two, "Sale Deed", pdf("deed.pdf"));

        // Owning both is not enough: the doc must belong to the property named in the path, or the
        // path segment is decorative and a typo silently deletes the wrong file.
        mvc.perform(delete(Routes.MeDocuments.BY_ID, one.getId().toString(), idOnTwo)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNotFound());
    }

    @Test
    void deleteDocument_treatsANonUuidIdAsAMiss_notAMalformedRequest() throws Exception {
        User owner = user("9820001012");
        Property p = listing(owner, "Bad id flat");

        mvc.perform(delete(Routes.MeDocuments.BY_ID, p.getId().toString(), "not-a-uuid")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNotFound());
    }

    @Test
    void vaultRoutes_requireAuthentication() throws Exception {
        User owner = user("9820001013");
        Property p = listing(owner, "Anon flat");

        mvc.perform(get(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString()))
                .andExpect(status().isUnauthorized());
    }
}
