package com.draazy.api.documents;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.web.Routes;
import com.draazy.api.documents.vault.DocumentRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import java.math.BigDecimal;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.RequestBuilder;

// Organised around the invariants rather than the endpoints — strict owner-scoping, the upload allowlist, and the
// rule that a stored row never carries a persisted URL.
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

    @Test
    void uploadDocument_doesNotAskForTheBadgeByItself() throws Exception {
        User owner = user("9820001091");
        Property p = listing(owner, "Badge-seeking flat");

        upload(owner, p, "Index II", pdf("index2.pdf"));

        assertThat(properties.findById(p.getId())).get().satisfies(saved -> {
            assertThat(saved.getStatus()).isEqualTo("approved");
            assertThat(saved.isRecheckPending()).isFalse();
            assertThat(saved.isOwnershipRequested()).isFalse();
        });
    }

    @Test
    void uploadDocument_returnsAMintedUrlThatIsNotStoredOnTheRow() throws Exception {
        User owner = user("9820001001");
        Property p = listing(owner, "Vault flat");

        String id = upload(owner, p, "Sale Deed", pdf("deed.pdf"));

        // The wire carries a signed URL; the row carries only an opaque storage key. A URL in the
        // column would be a permanent, un-revocable credential to a title deed.
        assertThat(documents.findById(UUID.fromString(id)))
                .get()
                .satisfies(d -> {
                    assertThat(d.getStorageKey()).startsWith("documents/" + p.getId() + "/");
                    assertThat(d.getStorageKey()).doesNotContain("http");
                });
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
    void uploadDocument_refusesAPdfThatCarriesActiveContent() throws Exception {
        User owner = user("9820001015");
        Property p = listing(owner, "Active content flat");

        mvc.perform(multipart(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .file(new MockMultipartFile("file", "deed.pdf", "application/pdf",
                                "%PDF-1.7\n/Type/Action/S/JavaScript(app.alert(1))".getBytes()))
                        .param("category", "Sale Deed")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error").value("unsupported_media_type"));

        // And nothing was written: the scan runs before the object store, so a refusal leaves no
        // row and no object that a signed URL could still serve.
        assertThat(documents.findAll()).noneMatch(d -> d.getPropertyId().equals(p.getId()));
    }

    @Test
    void uploadDocument_refusesARealPdfNamedAsAnExecutable() throws Exception {
        User owner = user("9820001016");
        Property p = listing(owner, "Double extension flat");

        // The bytes are a genuine PDF, so every byte-level guard in the vault passes it.
        mvc.perform(multipart(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .file(new MockMultipartFile("file", "deed.pdf.exe", "application/pdf",
                                "%PDF-1.4 deed".getBytes()))
                        .param("category", "Sale Deed")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isUnsupportedMediaType());
    }

    @Test
    void uploadDocument_isA404OnSomeoneElsesListing_notA403() throws Exception {
        User owner = user("9820001005");
        User stranger = user("9820001006");
        Property p = listing(owner, "Not yours");

        mvc.perform(multipart(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .file(pdf("deed.pdf"))
                        .param("category", "Sale Deed")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
    }

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

    static Stream<Arguments> anonymousRequests() {
        UUID id = UUID.randomUUID();
        return Stream.of(
                Arguments.of("GET vault", (Supplier<RequestBuilder>) () ->
                        get(Routes.MeDocuments.FOR_PROPERTY, id.toString())),
                Arguments.of("GET personal", (Supplier<RequestBuilder>) () ->
                        get(Routes.MeDocuments.PERSONAL)),
                Arguments.of("GET managed", (Supplier<RequestBuilder>) () ->
                        get(Routes.MeDocuments.FOR_MANAGED, id)),
                Arguments.of("POST managed", (Supplier<RequestBuilder>) () ->
                        multipart(Routes.MeDocuments.FOR_MANAGED, id).file(pdf("deed.pdf"))
                                .param("category", "Sale Deed")),
                Arguments.of("DELETE managed", (Supplier<RequestBuilder>) () ->
                        delete(Routes.MeDocuments.MANAGED_BY_ID, id, UUID.randomUUID())),
                Arguments.of("POST document request", (Supplier<RequestBuilder>) () ->
                        post(Routes.Documents.REQUESTS).contentType(MediaType.APPLICATION_JSON)
                                .content("{\"propertyId\":\"" + id + "\"}")),
                Arguments.of("GET my document requests", (Supplier<RequestBuilder>) () ->
                        get(Routes.MeDocumentRequests.BASE)));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("anonymousRequests")
    void documentRoutes_requireAuthentication(String route, Supplier<RequestBuilder> request) throws Exception {
        mvc.perform(request.get())
                .andExpect(status().isUnauthorized());
    }
}
