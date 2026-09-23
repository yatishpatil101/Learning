alter table otp_codes drop constraint if exists otp_codes_purpose_check;
alter table otp_codes add constraint otp_codes_purpose_check check (
    purpose in ('login', 'owner-consent') or purpose like 'owner-consent:%'
);
