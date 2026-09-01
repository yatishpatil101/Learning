package com.draazy.api.security;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.context.annotation.Profile;

/**
 * Marks a bean that exists only to make the product demoable without vendor keys, and that would be
 * a security hole anywhere real users are: the mock OTP sender ("any code works"), the local-disk
 * file store, the self-service Aadhaar badge grant.
 *
 * <p><strong>Why this is an annotation rather than {@code @Profile("!prod")} repeated three
 * times.</strong> A negative profile expression is a denylist: it registers the bean in every
 * profile that is not the exact string {@code prod}, including the no-profile {@code default} that
 * a laptop and a mis-provisioned container are equally likely to be running under. Absence from
 * production then depends on a positive deploy action — {@code SPRING_PROFILES_ACTIVE=prod} —
 * matching an unverified magic string, so a container whose profile is {@code production}, or one
 * whose environment variable never got set, boots green while handing every caller a login that
 * accepts any six digits and an endpoint that grants its own identity badge. Nothing in the logs
 * says so; the app looks healthy.
 *
 * <p>Composed onto {@code @Profile("dev")}, this reverses that: the dev beans appear only where the
 * {@code dev} profile is <em>named</em>, and every unrecognised, mistyped or missing profile falls
 * through to the production implementation. Getting the profile wrong now costs a mock that is
 * missing, which is noisy, instead of a mock that is present, which is silent.
 *
 * <p>Naming the profile is necessary but no longer sufficient. A profile name is a string in a file
 * and files get copied, so {@link DevProfileGuard} additionally requires
 * {@value DevProfileGuard#DEV_MACHINE_VARIABLE} in the process environment — a variable that exists
 * in no committed file — before it will let a {@code dev} boot finish. These beans are still
 * registered by the profile alone; the guard is what stops the application serving traffic with them
 * present.
 *
 * <p>The annotation is also the handle {@link DevProfileGuard} uses to find these beans at startup
 * and {@code SpecCoverageTest} uses to exclude their routes from the published contract, neither of
 * which can be done reliably by pattern-matching a profile string.
 */
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Profile(DevProfileGuard.DEV_PROFILE)
public @interface DevOnly {
}
