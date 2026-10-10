package com.draazy.api.catalog.photo;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Rebuilds an embedded ICC profile from its colour-rendering tags only, so pixels look the same but device
 * make/model, description, copyright and creator fields do not survive. */
final class IccProfileScrubber {

    static final int MAX_BYTES = 4 << 20;

    private static final int HEADER = 128;
    private static final int MAX_TAGS = 100;
    private static final Set<String> RENDERING_TAGS = Set.of(
            "rXYZ", "gXYZ", "bXYZ", "wtpt", "bkpt", "rTRC", "gTRC", "bTRC", "kTRC", "chad", "chrm", "cicp",
            "A2B0", "A2B1", "A2B2", "B2A0", "B2A1", "B2A2", "gamt",
            "D2B0", "D2B1", "D2B2", "D2B3", "B2D0", "B2D1", "B2D2", "B2D3");

    private IccProfileScrubber() {
    }

    /** Null when the profile is malformed or has nothing to render with: browsers ignore those anyway. */
    static byte[] scrub(byte[] p) {
        if (p.length < HEADER + 4 || p.length > MAX_BYTES) {
            return null;
        }
        ByteBuffer in = ByteBuffer.wrap(p);
        long size = in.getInt(0) & 0xFFFFFFFFL;
        long tagCount = in.getInt(HEADER) & 0xFFFFFFFFL;
        if (size < HEADER + 4 || size > p.length || p[36] != 'a' || p[37] != 'c' || p[38] != 's'
                || p[39] != 'p' || tagCount > MAX_TAGS || HEADER + 4 + 12 * tagCount > size) {
            return null;
        }
        boolean v4 = p[8] >= 4;
        List<String> sigs = new ArrayList<>();
        List<byte[]> data = new ArrayList<>();
        for (int t = 0; t < tagCount; t++) {
            int entry = HEADER + 4 + 12 * t;
            String sig = new String(p, entry, 4, StandardCharsets.ISO_8859_1);
            long offset = in.getInt(entry + 4) & 0xFFFFFFFFL;
            long length = in.getInt(entry + 8) & 0xFFFFFFFFL;
            if (offset + length > size) {
                return null;
            }
            if (RENDERING_TAGS.contains(sig)) {
                sigs.add(sig);
                data.add(Arrays.copyOfRange(p, (int) offset, (int) (offset + length)));
            }
        }
        if (sigs.isEmpty()) {
            return null;
        }
        sigs.add("desc");
        data.add(v4 ? text() : legacyDescription());
        sigs.add("cprt");
        data.add(v4 ? text() : legacyText());
        return assemble(p, sigs, data);
    }

    private static byte[] assemble(byte[] source, List<String> sigs, List<byte[]> data) {
        int table = HEADER + 4 + 12 * sigs.size();
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        ByteBuffer tags = ByteBuffer.allocate(12 * sigs.size());
        Map<ByteBuffer, Integer> placed = new HashMap<>();
        for (int t = 0; t < sigs.size(); t++) {
            byte[] tag = data.get(t);
            Integer at = placed.get(ByteBuffer.wrap(tag));
            if (at == null) {
                at = table + body.size();
                placed.put(ByteBuffer.wrap(tag), at);
                body.writeBytes(tag);
                body.writeBytes(new byte[(4 - tag.length % 4) % 4]);
            }
            tags.put(sigs.get(t).getBytes(StandardCharsets.ISO_8859_1)).putInt(at).putInt(tag.length);
        }
        ByteBuffer out = ByteBuffer.allocate(table + body.size());
        out.put(source, 0, HEADER).putInt(sigs.size()).put(tags.array()).put(body.toByteArray());
        out.putInt(0, out.capacity());
        for (int[] span : new int[][] {{4, 4}, {24, 12}, {40, 4}, {48, 8}, {80, 48}}) {
            Arrays.fill(out.array(), span[0], span[0] + span[1], (byte) 0);
        }
        return out.array();
    }

    private static byte[] text() {
        byte[] utf16 = "Photo".getBytes(StandardCharsets.UTF_16BE);
        return ByteBuffer.allocate(28 + utf16.length)
                .put("mluc".getBytes(StandardCharsets.US_ASCII)).putInt(0).putInt(1).putInt(12)
                .put("enUS".getBytes(StandardCharsets.US_ASCII)).putInt(utf16.length).putInt(28)
                .put(utf16).array();
    }
    private static byte[] legacyText() {
        return ByteBuffer.allocate(13).put("text".getBytes(StandardCharsets.US_ASCII)).putInt(0)
                .put("None\0".getBytes(StandardCharsets.US_ASCII)).array();
    }

    private static byte[] legacyDescription() {
        byte[] ascii = "Photo\0".getBytes(StandardCharsets.US_ASCII);
        return ByteBuffer.allocate(12 + ascii.length + 4 + 4 + 2 + 1 + 67)
                .put("desc".getBytes(StandardCharsets.US_ASCII)).putInt(0).putInt(ascii.length).put(ascii)
                .array();
    }
}
