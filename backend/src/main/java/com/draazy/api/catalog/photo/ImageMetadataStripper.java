package com.draazy.api.catalog.photo;

import com.draazy.api.common.error.UnsupportedMediaTypeException;
import com.draazy.api.common.validation.MediaSignatures;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;

final class ImageMetadataStripper {

    private static final byte[] PNG_SIGNATURE =
            {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
    private static final Set<String> PNG_KEPT = Set.of(
            "IHDR", "PLTE", "IDAT", "IEND",
            "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "cICP", "sBIT", "bKGD", "pHYs");
    private static final Set<Integer> JPEG_STRUCTURE = Set.of(
            0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
            0xC4, 0xCC, 0xDB, 0xDC, 0xDD);
    private static final Map<Integer, byte[]> JPEG_KEPT_APP = Map.of(
            0xE0, "JFIF\0".getBytes(StandardCharsets.US_ASCII),
            0xE2, "ICC_PROFILE\0".getBytes(StandardCharsets.US_ASCII),
            0xEE, "Adobe".getBytes(StandardCharsets.US_ASCII));

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
                int scanEnd = endOfScan(c, next);
                out.write(c, markerStart, scanEnd - markerStart);
                i = scanEnd;
                continue;
            }
            if (keeps(marker, c, i + 2, next)) {
                out.write(c, markerStart, next - markerStart);
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

    private static boolean keeps(int marker, byte[] c, int payload, int end) {
        if (JPEG_STRUCTURE.contains(marker)) {
            return true;
        }
        if ((marker >= 0xE0 && marker <= 0xEF) || marker == 0xFE) {
            byte[] prefix = JPEG_KEPT_APP.get(marker);
            return prefix != null && startsWith(c, payload, end, prefix);
        }
        throw damaged();
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
            if (PNG_KEPT.contains(type)) {
                out.write(content, i, next - i);
            }
            if (type.equals("IEND")) {
                return out.toByteArray();
            }
            i = next;
        }
        throw damaged();
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
