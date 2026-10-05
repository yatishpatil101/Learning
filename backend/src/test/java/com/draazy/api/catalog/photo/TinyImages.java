package com.draazy.api.catalog.photo;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.zip.CRC32;

public final class TinyImages {

    private static final int PNG_OVERHEAD = 8 + 25 + 12 + 12;
    private static final int JPEG_OVERHEAD = 2 + 4 + 2;

    private TinyImages() {
    }

    public static byte[] png() {
        return png(PNG_OVERHEAD);
    }

    public static byte[] png(int size) {
        byte[] ihdr = ByteBuffer.allocate(13).putInt(1).putInt(1).put((byte) 8).put((byte) 2).array();
        return ByteBuffer.allocate(size)
                .put(new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A})
                .put(chunk("IHDR", ihdr))
                .put(chunk("IDAT", new byte[size - PNG_OVERHEAD]))
                .put(chunk("IEND", new byte[0]))
                .array();
    }

    public static byte[] jpeg(int size) {
        return ByteBuffer.allocate(size)
                .put(new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xDA, 0, 2})
                .put(new byte[size - JPEG_OVERHEAD])
                .put(new byte[] {(byte) 0xFF, (byte) 0xD9})
                .array();
    }

    private static byte[] chunk(String type, byte[] data) {
        byte[] typed = ByteBuffer.allocate(4 + data.length)
                .put(type.getBytes(StandardCharsets.US_ASCII)).put(data).array();
        CRC32 crc = new CRC32();
        crc.update(typed);
        return ByteBuffer.allocate(8 + typed.length)
                .putInt(data.length).put(typed).putInt((int) crc.getValue()).array();
    }
}
