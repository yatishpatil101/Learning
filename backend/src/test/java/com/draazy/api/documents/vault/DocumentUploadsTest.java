package com.draazy.api.documents.vault;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.common.error.PayloadTooLargeException;
import com.draazy.api.common.error.UnsupportedMediaTypeException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The upload signature check (tech-debt D40), tested as the pure function it is.
 *
 * <p>{@code DocumentVaultTest} proves the guard is wired into both upload endpoints and returns the
 * right status. This class covers the cases an HTTP test cannot reach cheaply — the HEIF brand set
 * and the WebP container, neither of which has a short honest fixture — and the boundary conditions
 * of the sniffer itself, where a length check is one {@code <} away from an
 * {@code ArrayIndexOutOfBoundsException} on a two-byte upload.
 */
@DisplayName("Document uploads — magic-byte sniffing (tech-debt D40)")
class DocumentUploadsTest {

    private static byte[] bytes(int... unsigned) {
        byte[] out = new byte[unsigned.length];
        for (int i = 0; i < unsigned.length; i++) {
            out[i] = (byte) unsigned[i];
        }
        return out;
    }

    /** An ISO base-media header: a 4-byte box size, {@code ftyp}, then the brand. */
    private static byte[] isoBmff(String brand) {
        byte[] out = new byte[12];
        out[3] = 12;
        System.arraycopy("ftyp".getBytes(StandardCharsets.US_ASCII), 0, out, 4, 4);
        System.arraycopy(brand.getBytes(StandardCharsets.US_ASCII), 0, out, 8, 4);
        return out;
    }

    private static byte[] riff(String fourCc) {
        byte[] out = new byte[12];
        System.arraycopy("RIFF".getBytes(StandardCharsets.US_ASCII), 0, out, 0, 4);
        System.arraycopy(fourCc.getBytes(StandardCharsets.US_ASCII), 0, out, 8, 4);
        return out;
    }

    @Test
    @DisplayName("each accepted signature resolves to its own media type")
    void recognisesEveryAcceptedSignature() {
        assertThat(DocumentUploads.sniff("%PDF-1.7 deed".getBytes(StandardCharsets.US_ASCII)))
                .isEqualTo(DocumentUploads.PDF);
        assertThat(DocumentUploads.sniff(bytes(0xFF, 0xD8, 0xFF, 0xE0)))
                .isEqualTo(DocumentUploads.JPEG);
        assertThat(DocumentUploads.sniff(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)))
                .isEqualTo(DocumentUploads.PNG);
        assertThat(DocumentUploads.sniff(riff("WEBP"))).isEqualTo(DocumentUploads.WEBP);
    }

    @Test
    @DisplayName("a real iPhone photo is HEIC whichever HEIF brand it carries")
    void acceptsEveryHeifBrandIosEmits() {
        // mif1 in particular: an iPhone HEIC is routinely branded as the generic image brand, so a
        // check for the literal "heic" would reject the single most likely camera upload.
        for (String brand : new String[] {"heic", "heix", "mif1", "msf1", "hevc"}) {
            assertThat(DocumentUploads.sniff(isoBmff(brand)))
                    .as("brand %s", brand)
                    .isEqualTo(DocumentUploads.HEIC);
        }
    }

    @Test
    @DisplayName("an unrecognised or truncated file sniffs to nothing rather than guessing")
    void refusesToGuess() {
        assertThat(DocumentUploads.sniff("<html><body>".getBytes(StandardCharsets.US_ASCII))).isNull();
        assertThat(DocumentUploads.sniff("<svg xmlns=".getBytes(StandardCharsets.US_ASCII))).isNull();
        assertThat(DocumentUploads.sniff("%PDF".getBytes(StandardCharsets.US_ASCII))).isNull();
        assertThat(DocumentUploads.sniff(riff("WAVE"))).isNull();
        assertThat(DocumentUploads.sniff(isoBmff("mp42"))).isNull();
    }

    @Test
    @DisplayName("a short file is refused, not an ArrayIndexOutOfBounds")
    void toleratesFilesShorterThanEverySignature() {
        assertThat(DocumentUploads.sniff(null)).isNull();
        assertThat(DocumentUploads.sniff(new byte[0])).isNull();
        assertThat(DocumentUploads.sniff(bytes(0xFF))).isNull();
        // Four bytes clears the initial length guard but is short of RIFF's and ftyp's 12.
        assertThat(DocumentUploads.sniff("RIFF".getBytes(StandardCharsets.US_ASCII))).isNull();
    }

    @Test
    @DisplayName("validate returns the proved type, not the declared one")
    void returnsTheSniffedType() {
        byte[] pdf = "%PDF-1.4 deed".getBytes(StandardCharsets.US_ASCII);
        assertThat(DocumentUploads.validate("application/PDF; charset=utf-8", pdf.length, pdf))
                .isEqualTo(DocumentUploads.PDF);
    }

    @Test
    @DisplayName("size is judged before content, so an oversized file is not mislabelled")
    void checksSizeBeforeSignature() {
        // All zeros: it matches no signature either. If the order were reversed this would be
        // reported as an unsupported type, sending the uploader to shrink a file that is fine.
        byte[] big = new byte[32];
        assertThatThrownBy(() ->
                DocumentUploads.validate("application/pdf", DocumentUploads.MAX_BYTES + 1, big))
                .isInstanceOf(PayloadTooLargeException.class);
    }

    @Test
    @DisplayName("the declared type is still rejected first, before any byte is read")
    void keepsTheAllowlistAsTheFirstGate() {
        byte[] pdf = "%PDF-1.4".getBytes(StandardCharsets.US_ASCII);
        // Genuine PDF bytes, but the client asked for it to be stored as HTML. The sniff would pass
        // it; the allowlist must not.
        assertThatThrownBy(() -> DocumentUploads.validate("text/html", pdf.length, pdf))
                .isInstanceOf(UnsupportedMediaTypeException.class);
    }

    @Test
    @DisplayName("two allowlisted types that disagree are refused, and the message names both")
    void refusesADisagreementBetweenClaimAndContent() {
        byte[] png = bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A);
        assertThatThrownBy(() -> DocumentUploads.validate("image/jpeg", png.length, png))
                .isInstanceOf(UnsupportedMediaTypeException.class)
                .hasMessageContaining(DocumentUploads.PNG)
                .hasMessageContaining(DocumentUploads.JPEG);
    }

    @Test
    @DisplayName("an honest upload passes")
    void acceptsAnHonestUpload() {
        byte[] jpeg = bytes(0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10);
        assertThatCode(() -> DocumentUploads.validate("image/jpeg", jpeg.length, jpeg))
                .doesNotThrowAnyException();
    }
}
