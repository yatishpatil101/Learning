package com.draazy.api.identity.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The signups gate sits at {@code provisionBuyer}'s single caller, not at the insert, so a second
 * caller disarms it. Reasoning: docs/flows/consumer/auth.md, "what stops an account obtaining a session".
 */
@DisplayName("The signups gate — nothing may create a consumer account behind its back")
class AccountProvisioningGuardTest {

    private static final Path MAIN = Path.of("src", "main", "java");

    /** A path rather than a class name so the failure message points at something openable. */
    private static final String GATED_CALLER =
            "com/draazy/api/identity/auth/AuthService.java".replace('/', java.io.File.separatorChar);

    /** {@code provisionBuyer(} anywhere that is not the declaration itself. */
    private static final Pattern CALL = Pattern.compile("\\.provisionBuyer\\s*\\(");

    @Test
    @DisplayName("provisionBuyer is called from exactly one place, and that place is the gate")
    void nothingElseMintsAConsumerAccount() {
        List<String> callers = sourceFiles()
                .filter(AccountProvisioningGuardTest::callsProvisionBuyer)
                .map(path -> MAIN.relativize(path).toString())
                .sorted()
                .toList();

        assertThat(callers)
                .describedAs("""
                        provisionBuyer creates a fully-authenticatable consumer account, and the \
                        signupsEnabled check that decides whether it may run lives at its caller in \
                        AuthService.findOrProvision — not at the insert. A second caller therefore \
                        creates accounts while the platform is reporting onboarding Closed.

                        If the new call site should honour the freeze, move the check down into \
                        UserService.provisionBuyer and delete this guard. If it should not, say so \
                        here with the reason, the way provisionForStaff is exempt.""")
                .containsExactly(GATED_CALLER);
    }

    /** Counterweight: the guard above also passes if {@code provisionBuyer} has been deleted. */
    @Test
    @DisplayName("the method being guarded still exists under that name")
    void theGuardIsNotPinningAGhost() {
        Path userService = MAIN.resolve(
                "com/draazy/api/identity/user/UserService.java".replace('/', java.io.File.separatorChar));

        assertThat(read(userService))
                .describedAs("UserService no longer declares provisionBuyer — has account creation"
                        + " moved? This guard is now inert and must follow it.")
                .contains("public User provisionBuyer(");
    }

    private static boolean callsProvisionBuyer(Path source) {
        Matcher matcher = CALL.matcher(read(source));
        return matcher.find();
    }

    private static String read(Path source) {
        try {
            return Files.readString(source);
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read " + source.toAbsolutePath(), e);
        }
    }

    private static Stream<Path> sourceFiles() {
        try (Stream<Path> paths = Files.walk(MAIN)) {
            return paths.filter(p -> p.getFileName().toString().endsWith(".java")).toList().stream();
        } catch (IOException e) {
            throw new UncheckedIOException("cannot walk " + MAIN.toAbsolutePath(), e);
        }
    }
}
