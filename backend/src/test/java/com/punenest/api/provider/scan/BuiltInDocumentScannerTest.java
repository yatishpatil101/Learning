package com.punenest.api.provider.scan;

import static org.assertj.core.api.Assertions.assertThat;

import com.punenest.api.provider.DocumentScanner.Verdict;
import com.punenest.api.provider.DocumentScanner.Verdict.Outcome;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The always-on structural check (tech-debt D131), tested as the pure function it is.
 *
 * <p>{@code DocumentVaultTest} proves it is wired into the upload endpoints and returns the right
 * status. This class covers what an HTTP test cannot reach cheaply: the cases the vault's own
 * signature check already rejects at the door (so the scanner never sees them through a controller),
 * and the two deliberate <em>non</em>-rejections that would otherwise look like oversights.
 */
@DisplayName("Built-in document scanner — structural checks (tech-debt D131)")
class BuiltInDocumentScannerTest {

    private static final long TEN_MB = 10L * 1024 * 1024;

    private final BuiltInDocumentScanner scanner = new BuiltInDocumentScanner(TEN_MB);

    private static final String PDF = "application/pdf";
    private static final String PNG = "image/png";

    private static byte[] ascii(String s) {
        return s.getBytes(StandardCharsets.US_ASCII);
    }

    private static byte[] bytes(int... unsigned) {
        byte[] out = new byte[unsigned.length];
        for (int i = 0; i < unsigned.length; i++) {
            out[i] = (byte) unsigned[i];
        }
        return out;
    }

    private static byte[] pngBytes() {
        return bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0);
    }

    // ---------------- the ordinary case ----------------

    @Test
    @DisplayName("a real PDF with a matching name is stored")
    void acceptsAnHonestDocument() {
        assertThat(scanner.scan("deed.pdf", PDF, ascii("%PDF-1.7 sale deed")).isClean()).isTrue();
        assertThat(scanner.scan("scan.png", PNG, pngBytes()).isClean()).isTrue();
    }

    // ---------------- size ----------------

    @Test
    @DisplayName("an oversized file is 413, not 415 — the uploader can fix it")
    void refusesAnOversizedFileAsTooLarge() {
        // Measured on the array, not on a declared size: this seam is handed bytes and should not
        // trust a number it was not given.
        var small = new BuiltInDocumentScanner(1024);
        byte[] payload = new byte[1025];
        System.arraycopy(ascii("%PDF-1.7"), 0, payload, 0, 8);

        Verdict verdict = small.scan("deed.pdf", PDF, payload);

        assertThat(verdict.outcome()).isEqualTo(Outcome.TOO_LARGE);
        assertThat(verdict.detail()).contains("too large");
    }

    @Test
    @DisplayName("an empty upload is refused rather than stored as a zero-byte document")
    void refusesAnEmptyFile() {
        assertThat(scanner.scan("deed.pdf", PDF, new byte[0]).outcome()).isEqualTo(Outcome.REJECTED);
        assertThat(scanner.scan("deed.pdf", PDF, null).outcome()).isEqualTo(Outcome.REJECTED);
    }

    // ---------------- the filename ----------------

    @Test
    @DisplayName("a real PDF named .exe is refused — the bytes are fine, the name is the attack")
    void refusesADangerousExtensionEvenOnGenuineContent() {
        // Nothing byte-level can see this one. The vault's storage key is server-minted, so the name
        // decides nothing here -- but it is what the recipient's computer reads when they save the
        // download, and a double-click on `deed.pdf.exe` is the whole exploit.
        Verdict verdict = scanner.scan("deed.pdf.exe", PDF, ascii("%PDF-1.7 sale deed"));

        assertThat(verdict.outcome()).isEqualTo(Outcome.REJECTED);
        assertThat(verdict.detail()).contains(".exe");
    }

    @Test
    @DisplayName("only the last extension counts, because that is the only one an OS reads")
    void readsOnlyTheFinalExtension() {
        assertThat(scanner.scan("deed.exe.pdf", PDF, ascii("%PDF-1.7")).isClean()).isTrue();
    }

    @Test
    @DisplayName("a PDF named .jpg is refused: the recipient's computer would open it wrongly")
    void refusesAKnownExtensionThatContradictsTheProvedType() {
        Verdict verdict = scanner.scan("deed.jpg", PDF, ascii("%PDF-1.7"));

        assertThat(verdict.outcome()).isEqualTo(Outcome.REJECTED);
        assertThat(verdict.detail()).contains(".jpg").contains(PDF);
    }

    @Test
    @DisplayName("jpg, JPEG and jpe are one type; heif and heic are another")
    void treatsAlternativeSpellingsOfATypeAsOneType() {
        byte[] jpeg = bytes(0xFF, 0xD8, 0xFF, 0xE0);

        // Same type spelled three ways, and case must not matter -- Windows and iOS both hand us
        // upper-case extensions, and refusing those would be a self-inflicted support queue.
        assertThat(scanner.scan("scan.jpg", "image/jpeg", jpeg).isClean()).isTrue();
        assertThat(scanner.scan("scan.JPEG", "image/jpeg", jpeg).isClean()).isTrue();
        assertThat(scanner.scan("scan.jpe", "image/jpeg", jpeg).isClean()).isTrue();
        assertThat(scanner.scan("photo.HEIF", "image/heic", jpeg).isClean()).isTrue();

        // ...and the two families must still contradict each other. Note the bytes are ignored
        // throughout: this class is told the type the caller *proved*, and re-deriving it is
        // DocumentUploads' job, not a second opinion offered here.
        assertThat(scanner.scan("photo.heif", "image/jpeg", jpeg).outcome())
                .isEqualTo(Outcome.REJECTED);
    }

    @Test
    @DisplayName("an absent or unfamiliar extension is not held against an honest file")
    void leavesUnknownExtensionsAlone() {
        // A filename is client metadata. Refusing a real scan because it is called `deed` or
        // `deed.2024-04-11` would be a worse bug than the one being prevented.
        assertThat(scanner.scan("deed", PDF, ascii("%PDF-1.7")).isClean()).isTrue();
        assertThat(scanner.scan("deed.2024-04-11", PDF, ascii("%PDF-1.7")).isClean()).isTrue();
        assertThat(scanner.scan(null, PDF, ascii("%PDF-1.7")).isClean()).isTrue();
    }

    // ---------------- dangerous containers ----------------

    @Test
    @DisplayName("executables and archives are named in the refusal, not just rejected")
    void refusesContainersThatExecuteOrHideFurtherFiles() {
        // Unreachable through the upload endpoints today -- the vault's own sniffer rejects anything
        // without a document signature first. Kept because an implementation of a seam must not
        // assume which guards its caller ran, and because "that is an archive" is a far more useful
        // sentence than "that is not a PDF or an image".
        assertThat(scanner.scan("x.pdf", PDF, bytes('M', 'Z', 0x90, 0x00)).detail())
                .contains("a Windows program");
        assertThat(scanner.scan("x.pdf", PDF, bytes(0x7F, 'E', 'L', 'F')).detail())
                .contains("a Linux program");
        assertThat(scanner.scan("x.pdf", PDF, bytes('P', 'K', 0x03, 0x04)).detail())
                .contains("an archive");
        assertThat(scanner.scan("x.pdf", PDF, bytes(0x1F, 0x8B, 0x08, 0x00)).detail())
                .contains("a compressed file");
    }

    @Test
    @DisplayName("HTML and SVG are refused even behind a BOM or leading whitespace")
    void refusesMarkupHiddenBehindLeadingBlanks() {
        // The sniffer that runs before this one keys off byte zero, so a single newline in front of
        // `<svg` is enough to change its answer. This check starts after the blanks.
        assertThat(scanner.scan("x.png", PNG, ascii("\n\n  <svg xmlns=...>")).detail())
                .contains("an SVG image");
        assertThat(scanner.scan("x.png", PNG, ascii("  <!DOCTYPE html>")).detail())
                .contains("a web page");

        byte[] markup = ascii("<html><script>alert(1)</script>");
        byte[] withBom = new byte[markup.length + 3];
        System.arraycopy(bytes(0xEF, 0xBB, 0xBF), 0, withBom, 0, 3);
        System.arraycopy(markup, 0, withBom, 3, markup.length);
        assertThat(scanner.scan("x.png", PNG, withBom).detail()).contains("a web page");
    }

    // ---------------- PDF active content ----------------

    @Test
    @DisplayName("a PDF that runs JavaScript or launches a program is refused")
    void refusesPdfActiveContent() {
        assertThat(scanner.scan("deed.pdf", PDF,
                ascii("%PDF-1.7\n/Type/Action/S/JavaScript(app.alert(1))")).detail())
                .contains("runs JavaScript");
        assertThat(scanner.scan("deed.pdf", PDF, ascii("%PDF-1.7\n/S/Launch/F(cmd.exe)")).detail())
                .contains("can launch a program");
    }

    @Test
    @DisplayName("the short spellings /JS and /AA are deliberately not matched")
    void doesNotMatchSpellingsShortEnoughToOccurByChance() {
        // Three bytes recur by chance about once every sixteen million positions, and a multi-MB
        // scan's compressed image streams are effectively random. Matching /JS would refuse honest
        // documents roughly a quarter of the time. Pinned so nobody "completes" the list.
        assertThat(scanner.scan("deed.pdf", PDF, ascii("%PDF-1.7 stream /JS /AA endstream"))
                .isClean()).isTrue();
    }

    @Test
    @DisplayName("only PDFs are searched for PDF active content")
    void doesNotApplyThePdfCheckToImages() {
        // A PNG's pixel data can contain any byte sequence, including this one; it is inert there.
        byte[] png = pngBytes();
        byte[] withText = new byte[png.length + 11];
        System.arraycopy(png, 0, withText, 0, png.length);
        System.arraycopy(ascii("/JavaScript"), 0, withText, png.length, 11);

        assertThat(scanner.scan("scan.png", PNG, withText).isClean()).isTrue();
    }
}
