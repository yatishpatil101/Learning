package com.draazy.api.engagement.notification;

import java.util.List;

/** Body for {@code POST /notifications/read}, where absent or empty {@code ids} means all, and
 * {@code POST /notifications/dismiss}, where it is refused. */
public record MarkReadRequest(List<String> ids) {
}
