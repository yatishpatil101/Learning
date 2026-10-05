package com.draazy.api.services.request;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("The declaration the audit log vouches for is the one the wizard shows")
class RentAgreementDeclarationTest {

    private static final Path WIZARD = Path.of("frontend", "src", "pages", "consumer", "services",
            "rent-agreement", "constants.js");
    private static final Path EN = Path.of("frontend", "src", "i18n", "locales", "en", "services.json");

    @Test
    @DisplayName("the wizard sends this version, and its English text is word for word the hashed one")
    void wizardMatchesServer() throws IOException {
        assertThat(first(read(WIZARD), "DECLARATION_VERSION = '([^']+)'"))
                .isEqualTo(RentAgreementDeclaration.VERSION);
        assertThat(first(read(EN), "\"review\": \\{[\\s\\S]*?\"declaration\": \"([^\"]+)\""))
                .as("changing the text means bumping VERSION on both sides")
                .isEqualTo(RentAgreementDeclaration.TEXT);
    }

    private static String first(String source, String regex) {
        Matcher m = Pattern.compile(regex).matcher(source);
        assertThat(m.find()).as("no match for /%s/", regex).isTrue();
        return m.group(1);
    }

    private static String read(Path relative) throws IOException {
        Path root = Path.of("").toAbsolutePath();
        while (root != null && !Files.isDirectory(root.resolve(".git"))) {
            root = root.getParent();
        }
        Path file = (root == null ? Path.of("") : root).resolve(relative);
        assertThat(file).as("guarded file moved; update this guard, not its expectation").exists();
        return Files.readString(file, StandardCharsets.UTF_8);
    }
}
