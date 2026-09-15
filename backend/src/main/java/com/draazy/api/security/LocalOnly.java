package com.draazy.api.security;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.context.annotation.Profile;

/**
 * Marks a bean that exists only to make the product demoable without vendor keys, and that would be
 * a security hole anywhere real. Rationale: docs/system/profiles.md#local-only.
 */
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Profile(LocalProfileGuard.LOCAL_PROFILE)
public @interface LocalOnly {
}
