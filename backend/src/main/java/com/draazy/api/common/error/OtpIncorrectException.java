package com.draazy.api.common.error;

/**
 * 401 — the submitted OTP was wrong, carrying how many guesses the code has left. Why a subclass
 * and why the code stays {@code unauthorized}: docs/system/api-standards.md §4.1.
 */
public class OtpIncorrectException extends UnauthorizedException {

    private final int attemptsRemaining;

    /**
     * {@code attemptsRemaining} is {@code 0} on the last allowed guess: the next verify is refused
     * with a 429 and the user needs a fresh code — it does not mean this attempt was the refusal.
     */
    public OtpIncorrectException(int attemptsRemaining) {
        super("Incorrect OTP");
        this.attemptsRemaining = Math.max(0, attemptsRemaining);
    }

    public int getAttemptsRemaining() {
        return attemptsRemaining;
    }
}
