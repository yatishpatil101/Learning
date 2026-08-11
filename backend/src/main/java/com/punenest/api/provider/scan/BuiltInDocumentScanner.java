package com.punenest.api.provider.scan;

import com.punenest.api.provider.DocumentScanner;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The always-on structural check every upload goes through (tech-debt D131).
 *
 * <p><strong>This is not malware detection, and nothing here should be read as if it were.</strong>
 * It cannot recognise a single piece of malware. It has no signature database, does not unpack
 * anything, and a genuinely malicious PDF built to get past it will get past it. What it does is
 * cheaper and different in kind: it establishes that a file is <em>structurally the thing it claims
 * to be</em>, which is what closes the attack that this vault actually invites — uploading something
 * that is not a document at all in order to be handed a signed {@code punenest} URL that serves it
 * back to a lawyer or a bank officer. Real malware detection is {@link ClamAvScanner}, and it is off
 * unless a daemon is configured.
 *
 * <p><strong>Always on, no configuration, no external service.</strong> That is the point of it. A
 * check that needs a daemon is a check that is absent on every developer machine and in any
 * environment where the daemon was forgotten, and "absent" here means the vault silently returns to
 * accepting whatever it is handed.
 *
 * <p>Four questions, in the order that gives the most useful refusal:
 * <ol>
 *   <li><strong>Size, measured on the bytes.</strong> The vault's own guard checks the multipart
 *       part's declared size; this one checks the array it was actually given. Those agree today,
 *       and a seam that takes {@code byte[]} should not be the place that assumes so.</li>
 *   <li><strong>Dangerous container signatures.</strong> Executables, archives and markup, named
 *       explicitly so the refusal says what the file is rather than what it is not.</li>
 *   <li><strong>The filename's extension against the proved type.</strong> The vault's signature
 *       check deliberately ignores the extension — the storage key is server-minted, so the filename
 *       decides nothing about where bytes land. It is still what the recipient's operating system
 *       reads when they save the download, so {@code deed.pdf.exe} carrying a real PDF is a live
 *       problem that no byte-level check can see.</li>
 *   <li><strong>Active content in a PDF.</strong> A PDF is a container with an execution model; a
 *       scanned sale deed has no use for it.</li>
 * </ol>
 *
 * <p><strong>On the redundancy with the vault's own allowlist.</strong> Reaching this class means
 * {@code DocumentUploads.validate} has already proved the leading bytes are one of five document
 * signatures, so check 2 cannot currently fire through the upload endpoints. It stays because an
 * implementation of a seam must not assume which guards its caller ran — this is the class a future
 * caller will reach for — and because a lone "that file is not a PDF or an image" is a worse thing to
 * tell someone who just uploaded a ZIP than "that is an archive".
 */
@Component
public class BuiltInDocumentScanner implements DocumentScanner {

    /**
     * Mirrors the vault's own 10 MB ceiling. Deliberately a separate, independently configurable
     * number rather than an import: the vault's constant belongs to a feature context that shared
     * kernel may not reach, and a scanner that refuses to hold more than N bytes in memory is a
     * statement about this class, not about the product's upload limit.
     */
    private final long maxBytes;

    public BuiltInDocumentScanner(
            @Value("${punenest.providers.scan.max-bytes:10485760}") long maxBytes) {
        this.maxBytes = maxBytes;
    }

    /**
     * Extensions we can check, mapped to the media type they promise. Anything not listed — no
     * extension at all, {@code .scan}, {@code .2024-04-11} — is left alone: a filename is
     * client-supplied metadata, and refusing an honest file because its name is unusual would be a
     * worse bug than the one being prevented.
     */
    private static final Map<String, String> EXTENSION_TYPES = Map.ofEntries(
            Map.entry("pdf", "application/pdf"),
            Map.entry("jpg", "image/jpeg"),
            Map.entry("jpeg", "image/jpeg"),
            Map.entry("jpe", "image/jpeg"),
            Map.entry("png", "image/png"),
            Map.entry("heic", "image/heic"),
            Map.entry("heif", "image/heic"),
            Map.entry("webp", "image/webp"));

    /**
     * Extensions that must never survive an upload whatever the bytes say, because the danger is in
     * the name rather than the content. {@code deed.pdf.exe} holding a perfectly real PDF passes
     * every byte-level check in this codebase and is still a file that a recipient double-clicks.
     */
    private static final Set<String> DANGEROUS_EXTENSIONS = Set.of(
            "exe", "com", "scr", "msi", "dll", "bat", "cmd", "ps1", "vbs", "js", "mjs", "jse",
            "wsf", "hta", "jar", "sh", "bash", "py", "php", "html", "htm", "xhtml", "svg", "swf",
            "lnk", "reg", "app", "dmg", "pkg", "deb", "rpm", "iso", "apk");

    /** One thing a file might turn out to be, and the words the uploader is told it in. */
    private record Signature(String label, byte[] magic) {
    }

    /**
     * Leading signatures that are never a property document. Every entry is a container that either
     * executes or hides further files.
     *
     * <p>A {@code List} rather than a {@code Map}: labels repeat by design — four different byte
     * patterns are all just "a web page" to the person who has to fix it — and a map keyed on the
     * label would silently drop all but one of them.
     */
    private static final List<Signature> DANGEROUS_SIGNATURES = List.of(
            new Signature("a Windows program", new byte[] {'M', 'Z'}),
            new Signature("a Linux program", new byte[] {0x7F, 'E', 'L', 'F'}),
            new Signature("a macOS program",
                    new byte[] {(byte) 0xCF, (byte) 0xFA, (byte) 0xED, (byte) 0xFE}),
            new Signature("a Java class file",
                    new byte[] {(byte) 0xCA, (byte) 0xFE, (byte) 0xBA, (byte) 0xBE}),
            // PK\x03\x04 also covers every Office and OpenDocument file, which is correct here:
            // the vault stores scans and PDFs, and a .docx is a zip full of XML with a macro model.
            new Signature("an archive", new byte[] {'P', 'K', 0x03, 0x04}),
            new Signature("an archive", new byte[] {'P', 'K', 0x05, 0x06}),
            new Signature("a RAR archive", new byte[] {'R', 'a', 'r', '!'}),
            new Signature("a 7-Zip archive",
                    new byte[] {'7', 'z', (byte) 0xBC, (byte) 0xAF, 0x27, 0x1C}),
            new Signature("a compressed file", new byte[] {0x1F, (byte) 0x8B}));

    /** A text payload and what to call it. */
    private record TextSignature(String label, String prefix) {
    }

    /**
     * Text payloads, matched after leading whitespace because a browser or an editor will happily
     * put a newline or a BOM in front of them and the sniffer that runs before this one keys off
     * byte zero.
     */
    private static final List<TextSignature> DANGEROUS_TEXT_PREFIXES = List.of(
            new TextSignature("a web page", "<!doctype"),
            new TextSignature("a web page", "<html"),
            new TextSignature("a web page", "<head"),
            new TextSignature("a web page", "<script"),
            // SVG is the one image format that is a script host. It renders like a picture and runs
            // like a page, which is why it is on this list rather than the allowlist.
            new TextSignature("an SVG image", "<svg"),
            new TextSignature("an XML file", "<?xml"),
            new TextSignature("a PHP script", "<?php"),
            new TextSignature("a shell script", "#!"));

    /** How far in to look for the text prefixes above — a BOM plus generous leading whitespace. */
    private static final int TEXT_PREFIX_WINDOW = 64;

    /**
     * PDF execution primitives.
     *
     * <p>Only these two, and the reason is arithmetic rather than taste. The shorter spellings that
     * belong to the same family — {@code /JS}, {@code /AA} — are three and two bytes long, and a
     * multi-megabyte PDF's compressed image streams are effectively random bytes: three bytes
     * recur by chance roughly once every sixteen million positions, so a 4 MB scan would be refused
     * about a quarter of the time for containing nothing at all. {@code /JavaScript} is eleven bytes
     * and {@code /Launch} seven; neither happens by accident in any file that will ever be uploaded
     * here.
     *
     * <p>{@code /OpenAction} and {@code /EmbeddedFile} are left off for the opposite reason: both
     * are ordinary in legitimate documents ({@code /OpenAction} sets the initial zoom, and PDF/A-3
     * invoices embed their own XML), so they would refuse honest files.
     */
    private static final Map<String, byte[]> PDF_ACTIVE_CONTENT = Map.of(
            "runs JavaScript", "/JavaScript".getBytes(StandardCharsets.US_ASCII),
            "can launch a program", "/Launch".getBytes(StandardCharsets.US_ASCII));

    @Override
    public Verdict scan(String fileName, String contentType, byte[] content) {
        if (content == null || content.length == 0) {
            return Verdict.rejected("That file is empty.");
        }
        if (content.length > maxBytes) {
            return Verdict.tooLarge("That file is too large to upload (max "
                    + (maxBytes / (1024 * 1024)) + " MB)");
        }

        String container = dangerousContainer(content);
        if (container != null) {
            return Verdict.rejected("That file is " + container
                    + ", not a document. Upload the original scan or PDF.");
        }

        Verdict byName = checkExtension(fileName, contentType);
        if (!byName.isClean()) {
            return byName;
        }

        if ("application/pdf".equals(contentType)) {
            for (var active : PDF_ACTIVE_CONTENT.entrySet()) {
                if (indexOf(content, active.getValue()) >= 0) {
                    return Verdict.rejected("That PDF " + active.getKey()
                            + ", which a property document never needs to do. "
                            + "Re-export or re-scan it and upload that.");
                }
            }
        }

        return Verdict.clean();
    }

    /**
     * The extension check.
     *
     * <p>Only the last extension is consulted, because that is the only one an operating system
     * consults: {@code deed.pdf.exe} is an {@code .exe} to Windows and a PDF to nobody. The
     * mirror-image case — a real PDF innocently named {@code deed.jpg} — is refused too, and
     * naming both halves is safe because the uploader supplied the file and already knows what it
     * is.
     */
    private static Verdict checkExtension(String fileName, String contentType) {
        String extension = extensionOf(fileName);
        if (extension.isEmpty()) {
            return Verdict.clean();
        }
        if (DANGEROUS_EXTENSIONS.contains(extension)) {
            return Verdict.rejected("A file named \"." + extension
                    + "\" is not a document, whatever it contains. Rename it to match the file you"
                    + " actually mean to upload.");
        }
        String promised = EXTENSION_TYPES.get(extension);
        if (promised != null && !promised.equals(contentType)) {
            return Verdict.rejected("That file is a " + contentType + " but is named \"."
                    + extension + "\". Rename it so the recipient's computer opens it correctly.");
        }
        return Verdict.clean();
    }

    /** Lowercased text after the final dot of the final path segment, or {@code ""} if there is none. */
    private static String extensionOf(String fileName) {
        if (fileName == null) {
            return "";
        }
        String base = fileName.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1);
        int dot = base.lastIndexOf('.');
        if (dot < 0 || dot == base.length() - 1) {
            return "";
        }
        return base.substring(dot + 1).trim().toLowerCase(Locale.ROOT);
    }

    /** The label of the first dangerous container these bytes match, or {@code null}. */
    private static String dangerousContainer(byte[] content) {
        for (Signature signature : DANGEROUS_SIGNATURES) {
            if (startsWith(content, signature.magic(), 0)) {
                return signature.label();
            }
        }
        int start = firstNonBlank(content);
        if (start >= 0) {
            String head = new String(content, start,
                    Math.min(TEXT_PREFIX_WINDOW, content.length - start), StandardCharsets.US_ASCII)
                    .toLowerCase(Locale.ROOT);
            for (TextSignature text : DANGEROUS_TEXT_PREFIXES) {
                if (head.startsWith(text.prefix())) {
                    return text.label();
                }
            }
        }
        return null;
    }

    /** Index of the first byte that is not whitespace or part of a UTF-8/UTF-16 BOM, or -1. */
    private static int firstNonBlank(byte[] content) {
        int i = 0;
        if (startsWith(content, new byte[] {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF}, 0)) {
            i = 3;
        }
        while (i < content.length && i < TEXT_PREFIX_WINDOW) {
            byte b = content[i];
            if (b != ' ' && b != '\t' && b != '\r' && b != '\n' && b != 0) {
                return i;
            }
            i++;
        }
        return -1;
    }

    private static boolean startsWith(byte[] content, byte[] prefix, int from) {
        if (content.length - from < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i++) {
            if (content[from + i] != prefix[i]) {
                return false;
            }
        }
        return true;
    }

    /**
     * Plain scan for a byte sequence.
     *
     * <p><strong>Only the literal bytes.</strong> A PDF may hold its objects inside a compressed
     * object stream, where {@code /JavaScript} is not present as text at all — so a determined
     * attacker steps around this by deflating their payload, and nothing here would notice.
     * Decompressing to find out would mean parsing PDF, which is a far larger attack surface than
     * the one it closes. This is the honest limit of a structural check and the reason
     * {@link ClamAvScanner} exists.
     */
    private static int indexOf(byte[] haystack, byte[] needle) {
        outer:
        for (int i = 0; i <= haystack.length - needle.length; i++) {
            for (int j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    continue outer;
                }
            }
            return i;
        }
        return -1;
    }
}
