package com.draazy.api.identity.user;

import java.util.List;

public interface SessionUser {

    String id();

    String name();

    String mobile();

    String email();

    String role();

    List<String> permissions();
}
