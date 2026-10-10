drop table if exists society_leads;
drop table if exists announcements;
drop table if exists banners;
drop table if exists cms_services;
drop table if exists rent_agreement_tenant_consents;

alter table flatmate_reviews
    drop column if exists agreement_reg_no,
    drop column if exists agreement_registered_on;

update settings set value = value - 'featuredListing' where key = 'fees';
update settings set value = value - 'paidFeaturedListings' where key = 'flags';
