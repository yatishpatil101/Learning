package com.punenest.api.services;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.punenest.api.catalog.property.Property;
import com.punenest.api.common.web.Routes;
import com.punenest.api.identity.user.User;
import com.punenest.api.security.Teams;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;

/**
 * Documents on a service request: the draft, the registered copy, and whatever ops asked the
 * customer for.
 *
 * <p>A service-request document carries a property id — {@code documents.property_id} is
 * {@code NOT NULL} (V20), so a request with no listing cannot carry files at all, and the platform
 * says so with a 409 rather than discovering it as a constraint violation. It is <em>not</em> a
 * vault document, though: the property named on a request is claimed by whoever raised it, so these
 * rows are reachable only through the request. The allowlist and the 10 MB ceiling are the vault's,
 * reused rather than restated.
 */
@DisplayName("Slice 11 — service-request documents")
class ServiceRequestDocsTest extends ServiceFixtures {

    @Test
    @DisplayName("a request with no property cannot carry documents, and says so")
    void noPropertyNoDocuments() throws Exception {
        User buyer = customer("9820000201");
        User desk = staff("9820000202", Teams.LEGAL);
        String id = raise(buyer, "legal", null);

        upload(buyer, id, "identity", 409);
        setStatus(desk, id, "assigned", 200);
        shareDraft(desk, id, 409);
    }

    @Test
    @DisplayName("the draft and the final document land in the property's vault, newest first")
    void documentsAppearOnTheRequestAndTheVault() throws Exception {
        User buyer = customer("9820000203");
        User desk = staff("9820000204", Teams.RENTAL);
        Property p = listing(buyer);
        String id = raise(buyer, "rent-agreement", p);

        setStatus(desk, id, "assigned", 200);
        shareDraft(desk, id, 200);
        decide(buyer, id, "approve", 200);
        finalDoc(desk, id, 201);

        mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.documents", hasSize(2)))
                .andExpect(jsonPath("$.documents[0].category").value("final-document"))
                .andExpect(jsonPath("$.documents[1].category").value("draft"))
                .andExpect(jsonPath("$.documents[0].propertyId").value(p.getId().toString()));

        // ...and they stay there. The vault is what the owner uploaded; see vaultIsNotAnInbox.
        mvc.perform(get(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));
    }

    @Test
    @DisplayName("a stranger's service request cannot put a file in the owner's vault")
    void vaultIsNotAnInbox() throws Exception {
        User owner = customer("9820000210");
        User stranger = customer("9820000211");
        Property p = listing(owner);

        // anyone may raise a request about any listing — a tenant or a buyer legitimately does
        String id = raise(stranger, "legal", p);
        upload(stranger, id, "Aadhaar", 201);

        mvc.perform(get(Routes.MeDocuments.FOR_PROPERTY, p.getId().toString())
                        .header(HttpHeaders.AUTHORIZATION, bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));

        // the file is not lost, it just belongs to the request rather than to the flat
        mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(stranger)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.documents", hasSize(1)));
    }

    @Test
    @DisplayName("a request cannot name a listing that does not exist")
    void propertyMustExist() throws Exception {
        User buyer = customer("9820000212");

        mvc.perform(post(Routes.ServiceRequests.BASE)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"legal\",\"propertyId\":\""
                                + java.util.UUID.randomUUID() + "\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("the customer can attach what ops asked for")
    void customerCanUpload() throws Exception {
        User buyer = customer("9820000205");
        String id = raise(buyer, "rent-agreement", listing(buyer));

        upload(buyer, id, "Aadhaar", 201);
        mvc.perform(get(Routes.ServiceRequests.BY_ID, id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.documents[0].category").value("Aadhaar"))
                .andExpect(jsonPath("$.timeline[?(@.event=='document.uploaded')]").isNotEmpty());
    }

    @Test
    @DisplayName("a stranger cannot attach anything")
    void strangerCannotUpload() throws Exception {
        User mine = customer("9820000206");
        User theirs = customer("9820000207");
        String id = raise(mine, "rent-agreement", listing(mine));

        upload(theirs, id, "Aadhaar", 404);
    }

    @Test
    @DisplayName("the vault's allowlist applies here too")
    void allowlistIsReused() throws Exception {
        User buyer = customer("9820000208");
        String id = raise(buyer, "rent-agreement", listing(buyer));

        mvc.perform(multipart(Routes.ServiceRequests.DOCS, id)
                        .file(new MockMultipartFile("file", "payload.html", "text/html",
                                "<script>".getBytes()))
                        .param("category", "Aadhaar")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isUnsupportedMediaType());
    }

    @Test
    @DisplayName("the storage key is server-minted — the client filename never becomes a path")
    void filenameIsNotThePath() throws Exception {
        User buyer = customer("9820000209");
        String id = raise(buyer, "rent-agreement", listing(buyer));

        mvc.perform(multipart(Routes.ServiceRequests.DOCS, id)
                        .file(new MockMultipartFile("file", "../../etc/passwd.pdf",
                                "application/pdf", "%PDF-1.4".getBytes()))
                        .param("category", "Aadhaar")
                        .header(HttpHeaders.AUTHORIZATION, bearer(buyer)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.fileName").value("passwd.pdf"));
    }

    private void upload(User caller, String id, String category, int expected) throws Exception {
        mvc.perform(multipart(Routes.ServiceRequests.DOCS, id)
                        .file(new MockMultipartFile("file", "scan.pdf", "application/pdf",
                                "%PDF-1.4".getBytes()))
                        .param("category", category)
                        .header(HttpHeaders.AUTHORIZATION, bearer(caller)))
                .andExpect(status().is(expected));
    }
}
