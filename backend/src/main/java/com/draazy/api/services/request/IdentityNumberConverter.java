package com.draazy.api.services.request;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter
public class IdentityNumberConverter implements AttributeConverter<String, String> {

    private final IdentityCipher cipher;

    public IdentityNumberConverter(IdentityCipher cipher) {
        this.cipher = cipher;
    }

    @Override
    public String convertToDatabaseColumn(String attribute) {
        return cipher.encrypt(attribute);
    }

    @Override
    public String convertToEntityAttribute(String column) {
        return cipher.decrypt(column);
    }
}
