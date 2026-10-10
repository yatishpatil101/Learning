package com.draazy.api.catalog.photo;

import com.draazy.api.common.error.UnsupportedMediaTypeException;
import com.draazy.api.common.validation.MediaSignatures;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Set;
import java.util.SortedMap;
import java.util.TreeMap;
import java.util.zip.CRC32;
import java.util.zip.DeflaterOutputStream;
import java.util.zip.InflaterInputStream;

final class ImageMetadataStripper {

    private static final byte[] PNG_SIGNATURE =
            {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    private static final Set<String> PNG_KEPT = Set.of(
            "IHDR", "PLTE", "IDAT", "IEND",
            "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "cICP", "sBIT", "bKGD", "pHYs");
    private static final Set<Integer> JPEG_STRUCTURE = Set.of(
            0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
            0xC4, 0xCC, 0xDB, 0xDC, 0xDD);
    private static final byte[] JFIF = "JFIF\0".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] ADOBE = "Adobe".getBytes(StandardCharsets.US_ASCII);
    private static final byte[] ICC_PREFIX = "ICC_PROFILE\0".getBytes(StandardCharsets.US_ASCII);
    private static final int JFIF_PAYLOAD = 14;
    private static final int ADOBE_PAYLOAD = 12;
    private static final int ICC_CHUNK = 0xFFFF - 2 - ICC_PREFIX.length - 2;

    private ImageMetadataStripper() {
    }

    static byte[] strip(String contentType, byte[] content) {
        return switch (contentType) {
            case MediaSignatures.JPEG -> stripJpeg(content);
            case MediaSignatures.PNG -> stripPng(content);
            default -> throw damaged();
        };
    }

    private static byte[] stripJpeg(byte[] c) {
        if (c == null || c.length < 4 || u(c, 0) != 0xFF || u(c, 1) != 0xD8) {
            throw damaged();
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream(c.length);
        out.writeBytes(new byte[] {(byte) 0xFF, (byte) 0xD8});
        SortedMap<Integer, byte[]> icc = new TreeMap<>();
        int[] iccCount = {0};
        int i = 2;
        while (true) {
            if (i >= c.length || u(c, i) != 0xFF) {
                throw damaged();
            }
            int markerStart = i;
            while (i < c.length && u(c, i) == 0xFF) {
                i++;
            }
            if (i >= c.length) {
                throw damaged();
            }
            int marker = u(c, i++);
            if (marker == 0x00) {
                throw damaged();
            }
            if (marker == 0xD9) {
                out.writeBytes(new byte[] {(byte) 0xFF, (byte) 0xD9});
                return out.toByteArray();
            }
            if (marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
                out.write(c, markerStart, i - markerStart);
                continue;
            }
            if (i + 2 > c.length) {
                throw damaged();
            }
            int segmentLength = (u(c, i) << 8) | u(c, i + 1);
            int next = i + segmentLength;
            if (segmentLength < 2 || next > c.length) {
                throw damaged();
            }
            if (marker == 0xDA) {
                writeIcc(out, icc, iccCount[0]);
                icc.clear();
                int scanEnd = endOfScan(c, next);
                out.write(c, markerStart, scanEnd - markerStart);
                i = scanEnd;
                continue;
            }
            if (marker == 0xE2 && startsWith(c, i + 2, next, ICC_PREFIX)) {
                collectIcc(icc, iccCount, c, i + 2 + ICC_PREFIX.length, next);
            } else {
                byte[] payload = keptPayload(marker, c, i + 2, next);
                if (payload != null) {
                    writeSegment(out, marker, payload);
                }
            }
            i = next;
        }
    }

    private static int endOfScan(byte[] c, int from) {
        for (int j = from; j < c.length - 1; j++) {
            if (u(c, j) != 0xFF) {
                continue;
            }
            int n = u(c, j + 1);
            if (n != 0x00 && n != 0xFF && (n < 0xD0 || n > 0xD7)) {
                return j;
            }
        }
        throw damaged();
    }

    // Kept APP segments are cut to their fixed layout, so nothing can ride along after it, and a JFIF
    // thumbnail is dropped. Null drops the segment.
    private static byte[] keptPayload(int marker, byte[] c, int payload, int end) {
        if (JPEG_STRUCTURE.contains(marker)) {
            return Arrays.copyOfRange(c, payload, end);
        }
        if (marker == 0xE0 && startsWith(c, payload, end, JFIF) && end - payload >= JFIF_PAYLOAD) {
            byte[] jfif = Arrays.copyOfRange(c, payload, payload + JFIF_PAYLOAD);
            jfif[JFIF_PAYLOAD - 2] = 0;
            jfif[JFIF_PAYLOAD - 1] = 0;
            return jfif;
        }
        if (marker == 0xEE && startsWith(c, payload, end, ADOBE) && end - payload >= ADOBE_PAYLOAD) {
            return Arrays.copyOfRange(c, payload, payload + ADOBE_PAYLOAD);
        }
        if ((marker >= 0xE0 && marker <= 0xEF) || marker == 0xFE) {
            return null;
        }
        throw damaged();
    }

    private static void writeSegment(ByteArrayOutputStream out, int marker, byte[] payload) {
        int length = payload.length + 2;
        out.writeBytes(new byte[] {(byte) 0xFF, (byte) marker, (byte) (length >> 8), (byte) length});
        out.writeBytes(payload);
    }

    private static void collectIcc(SortedMap<Integer, byte[]> icc, int[] count, byte[] c, int from, int end) {
        if (end - from < 2) {
            count[0] = -1;
            return;
        }
        int total = u(c, from + 1);
        count[0] = icc.isEmpty() || count[0] == total ? total : -1;
        if (icc.putIfAbsent(u(c, from), Arrays.copyOfRange(c, from + 2, end)) != null) {
            count[0] = -1;
        }
    }

    // A profile split across segments is rejoined, scrubbed and written as one clean sequence.
    private static void writeIcc(ByteArrayOutputStream out, SortedMap<Integer, byte[]> icc, int count) {
        if (icc.isEmpty() || count < 1 || icc.size() != count || icc.firstKey() != 1 || icc.lastKey() != count) {
            return;
        }
        ByteArrayOutputStream joined = new ByteArrayOutputStream();
        icc.values().forEach(joined::writeBytes);
        byte[] profile = IccProfileScrubber.scrub(joined.toByteArray());
        int chunks = profile == null ? 0 : (profile.length + ICC_CHUNK - 1) / ICC_CHUNK;
        for (int n = 0; n < chunks; n++) {
            ByteArrayOutputStream payload = new ByteArrayOutputStream();
            payload.writeBytes(ICC_PREFIX);
            payload.write(n + 1);
            payload.write(chunks);
            payload.write(profile, n * ICC_CHUNK, Math.min(ICC_CHUNK, profile.length - n * ICC_CHUNK));
            writeSegment(out, 0xE2, payload.toByteArray());
        }
    }

    private static byte[] stripPng(byte[] content) {
        if (content == null || !startsWith(content, 0, content.length, PNG_SIGNATURE)) {
            throw damaged();
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream(content.length);
        out.writeBytes(PNG_SIGNATURE);
        int i = PNG_SIGNATURE.length;
        while (i + 12 <= content.length) {
            int length = (u(content, i) << 24) | (u(content, i + 1) << 16)
                    | (u(content, i + 2) << 8) | u(content, i + 3);
            if (length < 0 || i + 12L + length > content.length) {
                throw damaged();
            }
            String type = new String(content, i + 4, 4, StandardCharsets.US_ASCII);
            if (i == PNG_SIGNATURE.length && !type.equals("IHDR")) {
                throw damaged();
            }
            int next = i + 12 + length;
            if (type.equals("iCCP")) {
                writeIccChunk(out, content, i + 8, i + 8 + length);
            } else if (PNG_KEPT.contains(type)) {
                out.write(content, i, next - i);
            }
            if (type.equals("IEND")) {
                return out.toByteArray();
            }
            i = next;
        }
        throw damaged();
    }

    // iCCP is keyword, method byte, then a zlib stream; the keyword may name the device, so it is replaced.
    private static void writeIccChunk(ByteArrayOutputStream out, byte[] c, int from, int end) {
        int nul = from;
        while (nul < end && c[nul] != 0) {
            nul++;
        }
        if (nul + 2 > end || nul - from > 79 || c[nul + 1] != 0) {
            return;
        }
        byte[] profile;
        try (InflaterInputStream in = new InflaterInputStream(new ByteArrayInputStream(c, nul + 2, end - nul - 2))) {
            profile = IccProfileScrubber.scrub(in.readNBytes(IccProfileScrubber.MAX_BYTES + 1));
        } catch (IOException e) {
            return;
        }
        if (profile == null) {
            return;
        }
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        data.writeBytes("icc\0\0".getBytes(StandardCharsets.US_ASCII));
        try (DeflaterOutputStream deflate = new DeflaterOutputStream(data)) {
            deflate.write(profile);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        byte[] type = "iCCP".getBytes(StandardCharsets.US_ASCII);
        CRC32 crc = new CRC32();
        crc.update(type);
        crc.update(data.toByteArray());
        out.writeBytes(ByteBuffer.allocate(4).putInt(data.size()).array());
        out.writeBytes(type);
        out.writeBytes(data.toByteArray());
        out.writeBytes(ByteBuffer.allocate(4).putInt((int) crc.getValue()).array());
    }

    private static UnsupportedMediaTypeException damaged() {
        return new UnsupportedMediaTypeException(
                "That photo file is damaged or incomplete. Save it again as JPEG or PNG and retry.");
    }

    private static int u(byte[] b, int i) {
        return b[i] & 0xFF;
    }

    private static boolean startsWith(byte[] content, int from, int end, byte[] prefix) {
        if (end - from < prefix.length) {
            return false;
        }
        for (int i = 0; i < prefix.length; i++) {
            if (content[from + i] != prefix[i]) {
                return false;
            }
        }
        return true;
    }
}
