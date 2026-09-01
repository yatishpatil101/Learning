package com.draazy.api.provider.storage;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

@DisplayName("D246 — dev public storage authorization")
class DevObjectStoreTest {

    @TempDir
    Path root;

    @Test
    @DisplayName("a public-looking path cannot normalize into private storage")
    void publicPrefixCannotEscapeIntoPrivateStorage() {
        DevObjectStore store = new DevObjectStore(root.toString(), "http://localhost:8080/api", "/api");
        store.store("documents/lease.pdf", "private".getBytes(StandardCharsets.UTF_8), "application/pdf");

        assertThat(store.isPublic("public/../documents/lease.pdf")).isFalse();
        assertThat(store.openPublic("public/../documents/lease.pdf")).isEmpty();
    }
}