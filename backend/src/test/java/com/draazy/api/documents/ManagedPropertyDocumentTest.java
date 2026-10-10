package com.draazy.api.documents;

import com.draazy.api.support.AbstractApiTest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.common.web.Routes;
import com.draazy.api.documents.vault.ManagedPropertyDocumentRepository;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import jakarta.persistence.EntityManager;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;

/** A third vault: keyed on a {@code managed_properties} row, its {@code managed} segment outranks
 * {@code {propId}}, a stranger's id is 404 never 403, and deleting the record deletes its papers. */
class ManagedPropertyDocumentTest extends AbstractApiTest {

    @Autowired
    UserRepository users;
    @Autowired
    ManagedPropertyDocumentRepository managedDocuments;
    @Autowired
    EntityManager em;

    private User user(String mobile) {
        User u = new User(mobile, "owner");
        u.setName("Asha Patil");
        u.setMobileVerified(true);
        return users.saveAndFlush(u);
    }

    /** A managed record made the way the client makes one, so the id under test is a real one. */
    private String record(User owner, String locality) throws Exception {
        String json = mvc.perform(post(Routes.MeManagedProperties.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deal\":\"rent\",\"propertyType\":\"Flat\",\"bhk\":2,"
                                + "\"price\":25000,\"locality\":\"" + locality + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    private static MockMultipartFile pdf(String name) {
        return new MockMultipartFile("file", name, "application/pdf", "%PDF-1.4 sale deed".getBytes());
    }

    private String upload(User owner, String managedId, String category, MockMultipartFile file)
            throws Exception {
        String json = mvc.perform(multipart(Routes.MeDocuments.FOR_MANAGED, managedId)
                        .file(file)
                        .param("category", category)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.replaceAll("^.*?\"id\":\"([^\"]+)\".*$", "$1");
    }

    // ---------------- routing ----------------

    @Test
    void managedRoute_outranksThePropIdTemplate_soItReachesTheManagedHandler() throws Exception {
        User owner = user("9841004001");
        String managedId = record(owner, "Baner");

        // If `managed` were read as a {propId} this would 404 in the listing vault; as a literal segment it wins
        // over the template and the record's own (empty) list comes back.
        mvc.perform(get(Routes.MeDocuments.FOR_MANAGED, managedId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    // ---------------- upload ----------------

    @Test
    void upload_returnsAMintedUrlThatIsNotStoredOnTheRow() throws Exception {
        User owner = user("9841004002");
        String managedId = record(owner, "Baner");

        String docId = upload(owner, managedId, "Sale Deed", pdf("deed.pdf"));

        // The wire carries a signed, expiring URL; the row holds only an opaque key under its own prefix,
        // so nothing in the bucket can be mistaken for a listing's paperwork by path.
        assertThat(managedDocuments.findById(UUID.fromString(docId)))
                .get()
                .satisfies(d -> {
                    assertThat(d.getManagedPropertyId()).isEqualTo(UUID.fromString(managedId));
                    assertThat(d.getStorageKey()).startsWith("managed/" + managedId + "/");
                    assertThat(d.getStorageKey()).doesNotContain("http");
                });
    }

    @Test
    void upload_returnsMetadataOnly() throws Exception {
        User owner = user("9841004003");
        String managedId = record(owner, "Baner");

        mvc.perform(multipart(Routes.MeDocuments.FOR_MANAGED, managedId)
                        .file(pdf("index2.pdf"))
                        .param("category", "Index II")
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.category").value("Index II"))
                .andExpect(jsonPath("$.propertyId").doesNotExist())
                .andExpect(jsonPath("$.url").doesNotExist());
    }

    @Test
    void upload_toSomeoneElsesRecordIs404_beforeAnyBytesAreStored() throws Exception {
        User owner = user("9841004005");
        User stranger = user("9841004006");
        String managedId = record(owner, "Baner");

        // 404 rather than 403: a 403 would confirm the record exists, which is exactly what an id
        // this caller should not be able to learn about would be probing for.
        mvc.perform(multipart(Routes.MeDocuments.FOR_MANAGED, managedId)
                        .file(pdf("deed.pdf"))
                        .param("category", "Sale Deed")
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());

        assertThat(managedDocuments.findByManagedPropertyIdOrderByUploadedAtDescIdDesc(
                UUID.fromString(managedId))).isEmpty();
    }

    // ---------------- list ----------------

    @Test
    void list_showsOnlyThatRecordsPapers_newestFirst() throws Exception {
        User owner = user("9841004007");
        String baner = record(owner, "Baner");
        String kothrud = record(owner, "Kothrud");
        upload(owner, baner, "Sale Deed", pdf("deed.pdf"));
        upload(owner, baner, "Index II", pdf("index2.pdf"));
        upload(owner, kothrud, "Society NOC", pdf("noc.pdf"));

        // Two records owned by the same person are two vaults, not one. The owner scoping is on the
        // record; the bucket scoping is on the id.
        mvc.perform(get(Routes.MeDocuments.FOR_MANAGED, baner)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].category").value("Index II"))
                .andExpect(jsonPath("$[1].category").value("Sale Deed"));
    }

    @Test
    void list_onSomeoneElsesRecordIs404() throws Exception {
        User owner = user("9841004008");
        User stranger = user("9841004009");
        String managedId = record(owner, "Baner");
        upload(owner, managedId, "Sale Deed", pdf("deed.pdf"));

        mvc.perform(get(Routes.MeDocuments.FOR_MANAGED, managedId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());
    }

    @Test
    void list_onAnUnknownRecordIs404_notAnEmptyVault() throws Exception {
        User owner = user("9841004010");

        // An empty array here would tell a caller that any id they invent is a record they own with
        // nothing in it, which is both false and a probe that always succeeds.
        mvc.perform(get(Routes.MeDocuments.FOR_MANAGED, UUID.randomUUID())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNotFound());
    }

    // ---------------- delete ----------------

    @Test
    void delete_removesOnePaperAndLeavesTheRest() throws Exception {
        User owner = user("9841004011");
        String managedId = record(owner, "Baner");
        String deed = upload(owner, managedId, "Sale Deed", pdf("deed.pdf"));
        upload(owner, managedId, "Index II", pdf("index2.pdf"));

        mvc.perform(delete(Routes.MeDocuments.MANAGED_BY_ID, managedId, deed)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());

        mvc.perform(get(Routes.MeDocuments.FOR_MANAGED, managedId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].category").value("Index II"));
    }

    @Test
    void delete_refusesAPaperFromAnotherRecordOfTheSameOwner() throws Exception {
        User owner = user("9841004012");
        String baner = record(owner, "Baner");
        String kothrud = record(owner, "Kothrud");
        String deed = upload(owner, baner, "Sale Deed", pdf("deed.pdf"));

        // Owning both records is not enough — the document must belong to the vault named in the
        // path, or the id in the path is decoration and the route is really "delete any of my docs".
        mvc.perform(delete(Routes.MeDocuments.MANAGED_BY_ID, kothrud, deed)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNotFound());

        assertThat(managedDocuments.findByManagedPropertyIdOrderByUploadedAtDescIdDesc(
                UUID.fromString(baner))).hasSize(1);
    }

    @Test
    void delete_onSomeoneElsesRecordIs404() throws Exception {
        User owner = user("9841004013");
        User stranger = user("9841004014");
        String managedId = record(owner, "Baner");
        String deed = upload(owner, managedId, "Sale Deed", pdf("deed.pdf"));

        mvc.perform(delete(Routes.MeDocuments.MANAGED_BY_ID, managedId, deed)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isNotFound());

        assertThat(managedDocuments.findByManagedPropertyIdOrderByUploadedAtDescIdDesc(
                UUID.fromString(managedId))).hasSize(1);
    }

    // ---------------- lifecycle ----------------

    @Test
    void deletingTheRecord_takesItsPapersWithIt() throws Exception {
        User owner = user("9841004015");
        String managedId = record(owner, "Baner");
        upload(owner, managedId, "Sale Deed", pdf("deed.pdf"));

        mvc.perform(delete(Routes.MeManagedProperties.BY_ID, managedId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isNoContent());

        // The flush is the test: the cascade is a database rule, unfired until the DELETE reaches the database,
        // and Hibernate will not auto-flush it for a child query; findById would pass on cache, proving nothing.
        em.flush();
        em.clear();

        // V93 cascades, unlike `documents` and `personal_documents` whose parents are archived, because
        // this parent is really deleted; otherwise rows nobody can reach would leak storage (V20).
        assertThat(managedDocuments.findByManagedPropertyIdOrderByUploadedAtDescIdDesc(
                UUID.fromString(managedId))).isEmpty();
    }
}
