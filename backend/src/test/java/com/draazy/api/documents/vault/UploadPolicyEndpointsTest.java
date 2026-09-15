package com.draazy.api.documents.vault;

import static org.assertj.core.api.Assertions.assertThatExceptionOfType;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.draazy.api.catalog.managed.ManagedProperty;
import com.draazy.api.catalog.managed.ManagedPropertyRepository;
import com.draazy.api.catalog.photo.MePhotosController;
import com.draazy.api.catalog.photo.PhotoService;
import com.draazy.api.catalog.property.Property;
import com.draazy.api.catalog.property.PropertyRepository;
import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.GlobalExceptionHandler;
import com.draazy.api.common.error.PayloadTooLargeException;
import com.draazy.api.common.error.UnsupportedMediaTypeException;
import com.draazy.api.common.trust.BadgeEvidenceLookup;
import com.draazy.api.provider.FileStorage;
import com.draazy.api.provider.scan.BuiltInDocumentScanner;
import com.draazy.api.security.AuthPrincipal;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.method.annotation.AuthenticationPrincipalArgumentResolver;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** Real controllers, services and scanner; only persistence/storage and authenticated identity are substituted. */
class UploadPolicyEndpointsTest {

    private static final UUID OWNER = UUID.randomUUID();
    private static final UUID PROPERTY = UUID.randomUUID();
    private static final UUID MANAGED = UUID.randomUUID();
    private final FileStorage storage = mock(FileStorage.class);
    private final DocumentRepository documents = mock(DocumentRepository.class);
    private final PersonalDocumentRepository personal = mock(PersonalDocumentRepository.class);
    private final ManagedPropertyDocumentRepository managed = mock(ManagedPropertyDocumentRepository.class);
    private DocumentService service;
    private MockMvc mvc;

    enum Vault {
        PHOTO, PROPERTY, PERSONAL, MANAGED
    }

    @BeforeEach
    void setUp() {
        PropertyRepository properties = mock(PropertyRepository.class);
        ManagedPropertyRepository managedProperties = mock(ManagedPropertyRepository.class);
        Property property = mock(Property.class);
        when(property.getId()).thenReturn(PROPERTY);
        when(properties.findByIdAndOwner_Id(PROPERTY, OWNER)).thenReturn(Optional.of(property));
        when(properties.findForVerificationDecision(PROPERTY)).thenReturn(Optional.of(property));
        ManagedProperty record = mock(ManagedProperty.class);
        when(record.getId()).thenReturn(MANAGED);
        when(record.getOwnerId()).thenReturn(OWNER);
        when(managedProperties.findById(MANAGED)).thenReturn(Optional.of(record));
        when(storage.storePublic(anyString(), any(), anyString())).thenReturn("https://cdn.example/photo");
        service = new DocumentService(documents, personal, managed, properties, managedProperties,
                mock(DocumentMapper.class), storage, List.of(new BuiltInDocumentScanner(10_485_760)),
                mock(BadgeEvidenceLookup.class), mock(AuditService.class));
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                new AuthPrincipal(OWNER, "owner", null, true, false), null, List.of()));
        mvc = MockMvcBuilders.standaloneSetup(new MePhotosController(new PhotoService(storage)),
                        new MeDocumentsController(service))
                .setCustomArgumentResolvers(new AuthenticationPrincipalArgumentResolver())
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @AfterEach
    void clearIdentity() {
        SecurityContextHolder.clearContext();
    }

    static Stream<Arguments> acceptedUploads() {
        return Arrays.stream(Vault.values()).flatMap(vault ->
                Stream.of("jpeg", "jpg", "png", "heic", "heif", "pdf")
                        .filter(format -> vault != Vault.PHOTO || !format.equals("pdf"))
                        .map(format -> Arguments.of(vault, format)));
    }

    @ParameterizedTest
    @MethodSource("acceptedUploads")
    void accepts999999BytesAndStoresTheProvedType(Vault vault, String format) throws Exception {
        MockMultipartFile file = file(format, 999_999, 999_999);
        mvc.perform(multipart(path(vault)).file(file).param("category", "Ownership"))
                .andExpect(status().isCreated());
        String provedType = switch (format) {
            case "jpg" -> "image/jpeg";
            case "heif" -> "image/heic";
            default -> mime(format);
        };
        if (vault == Vault.PHOTO) {
            verify(storage).storePublic(anyString(), eq(file.getBytes()), eq(provedType));
        } else {
            verify(storage).store(anyString(), eq(file.getBytes()), eq(provedType));
        }
        verifyStoredSize(vault, 999_999);
    }

    static Stream<Arguments> oversizedUploads() {
        return Arrays.stream(Vault.values()).flatMap(vault -> Stream.of(
                Arguments.of(vault, 1_000_000, 1_000_000L),
                Arguments.of(vault, 1_000_000, 999_999L),
                Arguments.of(vault, 999_999, 1_000_000L)));
    }

    @ParameterizedTest
    @MethodSource("oversizedUploads")
    void refusesTheExclusiveLimitFromEitherActualOrClaimedSize(Vault vault, int actual, long claimed)
            throws Exception {
        MockMultipartFile file = spy(file("png", actual, claimed));
        mvc.perform(multipart(path(vault)).file(file).param("category", "Ownership"))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.error").value("payload_too_large"));
        verifyNoInteractions(storage, documents, personal, managed);
        if (claimed >= 1_000_000) {
            verify(file, never()).getBytes();
        }
    }

    @ParameterizedTest
    @EnumSource(Vault.class)
    void refusesDisallowedFormatsEvenWithAllowedLabels(Vault vault) throws Exception {
        for (String format : List.of("webp", "avif")) {
            for (String declared : List.of(mime(format), "image/png", "image/heif")) {
                MockMultipartFile file = new MockMultipartFile("file", "scan.png", declared, signature(format));
                mvc.perform(multipart(path(vault)).file(file).param("category", "Ownership"))
                        .andExpect(status().isUnsupportedMediaType())
                        .andExpect(jsonPath("$.error").value("unsupported_media_type"));
            }
        }
        verifyNoInteractions(storage, documents, personal, managed);
    }

    @ParameterizedTest
    @EnumSource(Vault.class)
    void storesActualLengthRatherThanAnUnderstatedClaim(Vault vault) throws Exception {
        MockMultipartFile file = file("png", 999_999, 8);
        mvc.perform(multipart(path(vault)).file(file).param("category", "Ownership"))
                .andExpect(status().isCreated());
        verifyStoredSize(vault, 999_999);
    }

    @Test
    void serviceRequestPathAcceptsPdfAndPersistsActualSize() {
        service.uploadForServiceRequest(PROPERTY, UUID.randomUUID(), "agreement", file("pdf", 999_999, 8));
        verify(documents).saveAndFlush(argThat(doc -> doc.getSizeBytes() == 999_999
                && doc.getMimeType().equals("application/pdf")));
        verify(storage).store(anyString(), argThat(bytes -> bytes.length == 999_999), eq("application/pdf"));
    }

    @Test
    void serviceRequestPathRefusesOversizeAndDisallowedFormatsBeforeStorage() {
        UUID request = UUID.randomUUID();
        assertThatExceptionOfType(PayloadTooLargeException.class).isThrownBy(() ->
                service.uploadForServiceRequest(PROPERTY, request, "agreement", file("pdf", 1_000_000, 8)));
        assertThatExceptionOfType(PayloadTooLargeException.class).isThrownBy(() ->
                service.uploadForServiceRequest(PROPERTY, request, "agreement", file("pdf", 8, 1_000_000)));
        for (String format : List.of("webp", "avif")) {
            MockMultipartFile file = new MockMultipartFile("file", "scan.png", "image/png", signature(format));
            assertThatExceptionOfType(UnsupportedMediaTypeException.class).isThrownBy(() ->
                    service.uploadForServiceRequest(PROPERTY, request, "agreement", file));
        }
        verifyNoInteractions(storage, documents, personal, managed);
    }

    private void verifyStoredSize(Vault vault, long size) {
        switch (vault) {
            case PROPERTY -> verify(documents).saveAndFlush(argThat(doc -> doc.getSizeBytes() == size));
            case PERSONAL -> verify(personal).saveAndFlush(argThat(doc -> doc.getSizeBytes() == size));
            case MANAGED -> verify(managed).saveAndFlush(argThat(doc -> doc.getSizeBytes() == size));
            case PHOTO -> verifyNoInteractions(documents, personal, managed);
        }
    }

    private static String path(Vault vault) {
        return switch (vault) {
            case PHOTO -> "/me/photos";
            case PROPERTY -> "/me/documents/" + PROPERTY;
            case PERSONAL -> "/me/documents/personal";
            case MANAGED -> "/me/documents/managed/" + MANAGED;
        };
    }

    private static MockMultipartFile file(String format, int actualSize, long claimedSize) {
        return new MockMultipartFile("file", "scan." + format, mime(format),
                Arrays.copyOf(signature(format), actualSize)) {
            @Override
            public long getSize() {
                return claimedSize;
            }
        };
    }

    private static String mime(String format) {
        return format.equals("pdf") ? "application/pdf" : "image/" + format;
    }

    private static byte[] signature(String format) {
        return switch (format) {
            case "jpeg", "jpg" -> new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0};
            case "png" -> new byte[] {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10};
            case "pdf" -> "%PDF-1.7".getBytes(StandardCharsets.US_ASCII);
            case "heic", "heif" -> "\0\0\0\u0018ftypheic\0\0\0\0".getBytes(StandardCharsets.US_ASCII);
            case "avif" -> "\0\0\0\u0018ftypavif\0\0\0\0".getBytes(StandardCharsets.US_ASCII);
            case "webp" -> "RIFF\0\0\0\0WEBP".getBytes(StandardCharsets.US_ASCII);
            default -> throw new IllegalArgumentException("No fixture for " + format);
        };
    }
}