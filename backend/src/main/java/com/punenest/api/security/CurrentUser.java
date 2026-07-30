package com.punenest.api.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.security.core.annotation.AuthenticationPrincipal;

/**
 * Injects the current {@link AuthPrincipal} into a controller method parameter. A thin alias over
 * {@link AuthenticationPrincipal} so controllers read {@code @CurrentUser AuthPrincipal user}
 * without importing Spring Security types everywhere.
 */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
@AuthenticationPrincipal
public @interface CurrentUser {
}
