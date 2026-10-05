package com.draazy.api.common.validation;

public final class Formats {

    private Formats() {
    }

    public static final String MOBILE = "^[6-9][0-9]{9}$";

    // Do not echo invalid values; 422 bodies are logged and may contain personal data.
    public static final String MOBILE_MESSAGE = "must be a 10-digit Indian mobile number";
}
