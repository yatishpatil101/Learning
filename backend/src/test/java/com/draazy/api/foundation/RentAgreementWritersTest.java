package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * {@code RentAgreementService} mints Tenant-verified badges. Its desk, four-eyes and self-dealing
 * gates live in {@code RentAgreementRegistration}, so a second caller would be a route around them.
 */
@DisplayName("Rent agreement writers — one gated front door")
class RentAgreementWritersTest {

    private static final Path MAIN = Path.of("src", "main", "java", "com", "draazy", "api");

    @Test
    @DisplayName("only the registration desk and the read-only /me controller reach RentAgreementService")
    void onlyTheGatedFrontDoorCallsTheService() throws IOException {
        try (Stream<Path> files = Files.walk(MAIN)) {
            assertThat(files.filter(p -> p.toString().endsWith(".java"))
                    .filter(p -> code(p).contains("RentAgreementService"))
                    .map(p -> p.getFileName().toString()))
                    .containsExactlyInAnyOrder("RentAgreementService.java",
                            "RentAgreementRegistration.java", "MeRentAgreementsController.java");
        }
    }

    private static String code(Path file) {
        try {
            return Files.readString(file, StandardCharsets.UTF_8)
                    .replaceAll("(?s)/\\*.*?\\*/", "")
                    .replaceAll("//[^\\n]*", "");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
