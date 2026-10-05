package com.draazy.api.leads.conversation;

import com.draazy.api.common.trust.MobileMask;
import java.util.regex.Pattern;

final class MessageTextMask {

    private static final Pattern EMAIL = Pattern.compile(
            "\\b[\\w.%+-]+@[\\w.-]+\\.[A-Za-z]{2,}\\b");
    private static final Pattern URL = Pattern.compile("\\b(?:https?://|www\\.)\\S+");
    private static final Pattern MOBILE = Pattern.compile(
            "(?<!\\d)(?:\\+?91[\\s.-]?|0)?[6-9]\\d(?:[\\s.-]?\\d){8}(?!\\d)");

    private MessageTextMask() {
    }

    static String notification(String value) {
        return mask(value, true);
    }

    static String body(String value) {
        return mask(value, false);
    }

    private static String mask(String value, boolean links) {
        String masked = EMAIL.matcher(value).replaceAll("[email]");
        if (links) {
            masked = URL.matcher(masked).replaceAll("[link]");
        }
        return MOBILE.matcher(masked).replaceAll(match -> {
            String mobile = MobileMask.normalise(match.group());
            return mobile == null ? "[phone]" : MobileMask.mask(mobile);
        });
    }
}
