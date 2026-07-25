# PuneNest API Contract

> This document defines the REST API contract for the PuneNest backend.
> The React frontend will use these endpoints via a service abstraction layer.
> Current implementation: localStorage mock (`src/services/providers/mock/`).
> Future implementation: Spring Boot + PostgreSQL (`src/services/providers/http/`).
>
> **Related artifacts:**
> - [`api-architecture-review.md`](./api-architecture-review.md) — ARB architecture narrative
>   (bounded contexts, performance, security, microservice roadmap).
> - **OpenAPI 3.1 spec:** [`../../backend/src/main/resources/static/openapi/punenest-api.yaml`](../../backend/src/main/resources/static/openapi/punenest-api.yaml)
>   — machine-readable contract (126 paths / 160 operations). Served by the Spring Boot app at
>   `/openapi/punenest-api.yaml`; Swagger UI at `/docs`.

---

## Conventions

| Convention | Value |
|-----------|-------|
| Base URL | `/api` (dev: `http://localhost:8080/api`) |
| Auth | Bearer JWT in `Authorization` header |
| Content-Type | `application/json` |
| Pagination | `?page=0&size=20` (zero-indexed) |
| Sort | `?sort=field,direction` (e.g., `sort=createdAt,desc`) |
| Date format | ISO-8601 (`2026-07-03T10:30:00Z`) |
| ID format | String (UUID in production, `PR{ts}` in mock) |
| Error shape | `{ "error": "code", "message": "human-readable", "status": 400 }` |

### Auth Roles
- `buyer` — property seekers
- `owner` — property owners/landlords
- `admin` — platform admin
- `staff` — internal team member (with `team` field)

### Response Wrapper (paginated)
```json
{
  "content": [...],
  "page": 0,
  "size": 20,
  "totalElements": 142,
  "totalPages": 8
}
```

---

## 1. Auth

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/login` | No | Login via OTP-verified mobile |
| POST | `/auth/staff-login` | No | Staff/admin login |
| POST | `/auth/logout` | Yes | Invalidate session |
| GET | `/auth/me` | Yes | Get current user profile |
| PATCH | `/auth/me` | Yes | Update own profile |

### POST `/auth/login`
```json
// Request
{ "name": "Aarav Sharma", "mobile": "9876543210", "role": "buyer" }

// Response 200
{ "token": "jwt...", "user": { "id": "U1001", "name": "Aarav Sharma", "mobile": "9876543210", "role": "buyer", "loginAt": "2026-07-03T10:30:00Z" } }
```

### POST `/auth/staff-login`
```json
// Request
{ "name": "Admin", "mobile": "9000000001", "role": "admin", "team": "operations", "teams": ["operations", "legal"] }

// Response 200
{ "token": "jwt...", "user": { "id": "S1001", "name": "Admin", "mobile": "9000000001", "role": "admin", "team": "operations", "teams": ["operations", "legal"] } }
```

### GET `/auth/me`
```json
// Response 200
{ "id": "U1001", "name": "Aarav Sharma", "mobile": "9876543210", "role": "buyer", "email": null, "city": "Pune", "loginAt": "2026-07-03T10:30:00Z" }
```

---

## 2. Properties (Public)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/properties` | No | List/search properties |
| GET | `/properties/featured` | No | Featured listings |
| GET | `/properties/:id` | No | Single property detail |

### GET `/properties`
**Query params:** `deal`, `type`, `locality`, `bhk`, `minPrice`, `maxPrice`, `furnishing`, `q` (text search), `sort`, `status`, `page`, `size`

```json
// Response 200
{
  "content": [
    {
      "id": "PR1001",
      "title": "3 BHK Flat in Baner",
      "deal": "buy",
      "type": "Flat",
      "bhkNum": 3,
      "price": 12500000,
      "area": 1450,
      "locality": "Baner",
      "localitySlug": "baner",
      "furnishing": "semi",
      "image": "/images/prop1.jpg",
      "amenities": ["gym", "parking", "lift"],
      "status": "approved",
      "featured": false,
      "ownerVerified": true,
      "ownershipVerified": false,
      "rera": "P52100012345",
      "createdAt": "2026-06-15T08:00:00Z",
      "views": 234,
      "enquiries": 12
    }
  ],
  "page": 0, "size": 20, "totalElements": 142, "totalPages": 8
}
```

### GET `/properties/:id`
```json
// Response 200 (full property with owner info)
{
  "id": "PR1001",
  "title": "3 BHK Flat in Baner",
  "deal": "buy",
  "type": "Flat",
  "bhkNum": 3,
  "price": 12500000,
  "area": 1450,
  "carpetArea": 1200,
  "locality": "Baner",
  "localitySlug": "baner",
  "address": "Blue Ridge Township, Baner",
  "furnishing": "semi",
  "images": ["/images/prop1.jpg", "/images/prop1b.jpg"],
  "amenities": ["gym", "parking", "lift", "security"],
  "description": "Spacious 3 BHK with mountain views...",
  "status": "approved",
  "featured": false,
  "ownerVerified": true,
  "ownershipVerified": true,
  "societyVerified": true,
  "conveyanceDone": false,
  "rera": "P52100012345",
  "construction": "ready",
  "ageYears": 3,
  "floor": 7,
  "totalFloors": 14,
  "facing": "East",
  "parking": 1,
  "owner": { "id": "U2001", "name": "Vikram Patil", "mobile": "98XXXXX210", "verified": true },
  "createdAt": "2026-06-15T08:00:00Z",
  "views": 234,
  "enquiries": 12
}
```

---

## 3. Owner Listings (My Properties)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me/listings` | Yes (owner) | My posted properties |
| GET | `/me/listings/:id` | Yes (owner) | Single listing detail |
| POST | `/me/listings` | Yes (owner) | Create new listing |
| PATCH | `/me/listings/:id` | Yes (owner) | Update listing |

### POST `/me/listings`
```json
// Request
{
  "title": "2 BHK Flat in Wakad",
  "deal": "rent",
  "type": "Flat",
  "bhkNum": 2,
  "price": 25000,
  "area": 950,
  "locality": "Wakad",
  "localitySlug": "wakad",
  "furnishing": "furnished",
  "amenities": ["parking", "lift"],
  "description": "Well-maintained 2 BHK...",
  "images": ["data:image/jpeg;base64,..."]
}

// Response 201
{ "id": "PR1720000000001", "status": "pending", ...rest }
```

### PATCH `/me/listings/:id`
```json
// Request (partial update)
{ "price": 23000, "furnishing": "semi" }

// Response 200 — updated listing
// Note: if foundation fields change (price, bhk, type, locality), status reverts to "pending"
```

---

## 4. Properties — Admin

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| PATCH | `/properties/:id/status` | Yes (admin) | Approve/reject listing |
| POST | `/properties/:id/toggle-featured` | Yes (admin) | Toggle featured flag |
| POST | `/properties/:id/flag` | Yes (admin) | Flag listing |
| DELETE | `/properties/:id/flag` | Yes (admin) | Clear flag |
| PATCH | `/properties/:id/archive` | Yes (admin) | Archive listing (soft-delete) |
| PATCH | `/properties/:id/restore` | Yes (admin) | Restore archived listing |
| PATCH | `/properties/:id` | Yes (admin) | Update fields |

### PATCH `/properties/:id/status`
```json
// Request
{ "status": "approved" }
// or
{ "status": "rejected", "reason": "Duplicate listing" }
```

### PATCH `/properties/:id/archive`
```json
// Request
{ "reason": "Owner requested removal" }
// Response 200 — listing with archived: true, archivedAt, archiveReason
```

### PATCH `/properties/:id/restore`
```json
// Request (no body)
// Response 200 — listing with archived: false, status reset to "pending"
```

> **Design policy:** No hard-delete endpoint exists. All removals go through archive.
> Archived listings are excluded from public queries by default; pass `?archived=true` to include them in admin views.

---

## 5. Users (Admin)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/users` | Yes (admin) | List all users |
| GET | `/users/:id` | Yes (admin) | User detail + listings |
| PATCH | `/users/:id` | Yes (admin) | Update user |
| PATCH | `/users/:id/archive` | Yes (admin) | Archive user (soft-delete) |
| PATCH | `/users/:id/restore` | Yes (admin) | Restore archived user |
| POST | `/users/staff` | Yes (admin) | Add staff member |

### GET `/users`
**Query params:** `role`, `q` (search), `archived` (boolean, default false), `page`, `size`

### PATCH `/users/:id/archive`
```json
// Request
{ "reason": "Inactive account" }
// Response 200 — user with archived: true
```

### PATCH `/users/:id/restore`
```json
// Request (no body)
// Response 200 — user with archived: false, status: "active"
```

---

## 6. Verification & KYC

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me/verification/aadhaar` | Yes | Check Aadhaar status |
| POST | `/me/verification/aadhaar` | Yes | Submit Aadhaar verification |
| GET | `/properties/:id/verification` | Yes | Get property review thread |
| POST | `/properties/:id/verification` | Yes | Initiate property review |
| POST | `/properties/:id/verification/messages` | Yes | Add message to review |
| POST | `/properties/:id/verification/read` | Yes | Mark messages read |
| POST | `/properties/:id/verification/decision` | Yes (admin) | Approve/reject property |

### POST `/me/verification/aadhaar`
```json
// Request
{ "aadhaarMobile": "9876543210", "otp": "123456" }

// Response 200
{ "verified": true, "aadhaarMobile": "9876543210", "at": "2026-07-03T10:30:00Z" }
```

### POST `/properties/:id/verification/decision`
```json
// Request
{ "decision": "approved", "reason": "All documents verified" }
// or
{ "decision": "rejected", "reason": "Index II not legible" }
```

---

## 7. Contacts

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/contacts/status` | Yes | Check contact status for a property |
| POST | `/contacts/request` | Yes | Request owner's contact |
| GET | `/me/contact-requests` | Yes (owner) | View incoming requests |
| PATCH | `/me/contact-requests/:reqId` | Yes (owner) | Approve/decline request |

### POST `/contacts/request`
```json
// Request
{ "ownerMobile": "9876543210", "propertyId": "PR1001" }

// Response 200
{ "status": "pending" }
// or 403 { "error": "aadhaar_required" }
```

### PATCH `/me/contact-requests/:reqId`
```json
// Request
{ "status": "approved" }
// or
{ "status": "declined" }
```

---

## 8. Deals & Under Offer

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me/deals` | Yes (owner) | All deals for my properties |
| GET | `/me/deals/:propId` | Yes (owner) | Deal status for a property |
| POST | `/me/deals/:propId/reserve` | Yes (owner) | Mark under offer |
| POST | `/me/deals/:propId/close` | Yes (owner) | Close deal |
| POST | `/me/deals/:propId/reopen` | Yes (owner) | Reopen property |
| GET | `/me/deals/:propId/parties` | Yes (owner) | Under-offer parties |
| POST | `/me/deals/:propId/parties` | Yes (owner) | Add party |
| DELETE | `/me/deals/:propId/parties/:idx` | Yes (owner) | Remove party |

### POST `/me/deals/:propId/close`
```json
// Request
{ "deal": "sold", "closedWith": { "name": "Rahul", "mobile": "9800000001" } }
```

---

## 9. Maker-Checker Finalization

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me/finalization-requests` | Yes (owner) | Pending finalization requests |
| POST | `/finalization/:propId/request` | Yes (buyer) | Request to finalize deal |
| GET | `/finalization/:propId/status` | Yes | My finalization status |
| POST | `/finalization/requests/:reqId/accept` | Yes (owner) | Accept request |
| POST | `/finalization/requests/:reqId/decline` | Yes (owner) | Decline request |
| DELETE | `/finalization/:propId` | Yes (buyer) | Cancel my request |

### POST `/finalization/:propId/request`
```json
// Request
{ "ownerMobile": "9876543210", "deal": "buy" }

// Response 200
{ "status": "pending", "id": "FR1001" }
```

### POST `/finalization/requests/:reqId/accept`
```json
// Request
{ "closedWith": { "name": "Buyer Name", "mobile": "9800000001" } }

// Response 200 — also creates tenancy record if rent deal
```

---

## 10. Offers & Negotiation

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me/offers` | Yes (owner) | Offers on my properties |
| GET | `/offers/mine` | Yes (buyer) | My submitted offers |
| POST | `/offers` | Yes (buyer) | Submit offer |
| POST | `/offers/:id/respond` | Yes (owner) | Accept/decline/counter |

### POST `/offers`
```json
// Request
{ "ownerMobile": "9876543210", "propertyId": "PR1001", "amount": 11500000, "message": "Serious buyer, can close in 2 weeks" }
```

### POST `/offers/:id/respond`
```json
// Request
{ "action": "counter", "amount": 12000000 }
// action: "accept" | "decline" | "counter"
```

---

## 11. Visits

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/visits` | Yes (admin) | All visits |
| POST | `/visits` | Yes | Schedule visit |
| GET | `/me/visit-requests` | Yes (owner) | Visit requests on my properties |
| POST | `/visit-requests` | Yes (buyer) | Request a visit |
| PATCH | `/visit-requests/:id/status` | Yes (owner) | Confirm/cancel visit |

### POST `/visits`
```json
// Request
{ "listingId": "PR1001", "listing": "3 BHK in Baner", "customer": "Aarav", "mobile": "9876543210", "when": "2026-07-10" }
```

---

## 12. Enquiries & Messages

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/enquiries` | Yes (admin) | All enquiries |
| GET | `/messages` | Yes | User's messages |

---

## 13. Service Requests / Tickets

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/tickets` | Yes (admin/staff) | All service requests |
| POST | `/tickets` | Yes | Create service request |
| PATCH | `/tickets/:id` | Yes (admin/staff) | Update ticket |
| POST | `/tickets/:id/notes` | Yes (admin/staff) | Add internal note |

### POST `/tickets`
```json
// Request
{ "team": "legal", "service": "Rent Agreement", "customer": "Aarav", "mobile": "9876543210", "detail": "Need registered agreement for 2BHK Wakad", "value": 4999 }

// Response 201
{ "id": "T1720000000001", "status": "new", "priority": "medium", ... }
```

---

## 14. Support Tickets (Customer)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/support/tickets` | Yes | My support tickets (or all for admin) |
| GET | `/support/tickets/:id` | Yes | Ticket detail with messages |
| POST | `/support/tickets` | Yes | Create support ticket |
| POST | `/support/tickets/:id/messages` | Yes | Reply to ticket |
| POST | `/support/tickets/:id/read` | Yes | Mark as read |

### POST `/support/tickets`
```json
// Request
{ "category": "listing", "priority": "medium", "subject": "Photos not uploading", "message": "When I try to upload...", "images": ["data:..."] }

// Response 201
{ "id": "SUP-42", "status": "open", "createdAt": "..." }
```

---

## 15. Finance (Owner)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me/finances/:propId/transactions` | Yes (owner) | Transactions list |
| POST | `/me/finances/:propId/transactions` | Yes (owner) | Add transaction |
| PATCH | `/me/finances/:propId/transactions/:txnId` | Yes (owner) | Update |
| DELETE | `/me/finances/:propId/transactions/:txnId` | Yes (owner) | Delete |
| GET | `/me/finances/:propId/basis` | Yes (owner) | Ownership basis |
| PUT | `/me/finances/:propId/basis` | Yes (owner) | Set basis |
| GET | `/me/finances/:propId/summary` | Yes (owner) | Income/expense/net |
| GET | `/me/finances/:propId/cashflow` | Yes (owner) | Monthly cashflow |
| GET | `/me/finances/:propId/dues` | Yes (owner) | Upcoming dues |

### POST `/me/finances/:propId/transactions`
```json
// Request
{ "type": "expense", "category": "Maintenance", "amount": 5000, "date": "2026-07-01", "notes": "Society maintenance", "recurring": true }

// Response 201
{ "id": "TX1001", ...rest }
```

---

## 16. Documents

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me/documents/:propId` | Yes (owner) | Documents for property |
| POST | `/me/documents/:propId` | Yes (owner) | Upload document |
| DELETE | `/me/documents/:propId/:docId` | Yes (owner) | Remove document |
| GET | `/me/documents/requests` | Yes (owner) | Buyer doc requests |
| POST | `/documents/requests` | Yes (buyer) | Request document access |
| PATCH | `/me/documents/requests/:reqId` | Yes (owner) | Grant/decline |
| GET | `/documents/shared` | No* | View shared documents (via link token) |

### POST `/me/documents/:propId`
```json
// Request (multipart/form-data)
{ "category": "Sale Deed", "file": <binary> }

// Response 201
{ "id": "DOC1001", "category": "Sale Deed", "name": "sale_deed.pdf", "size": 245000, "uploadedAt": "..." }
```

---

## 17. Rent Payments

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me/rent-payments` | Yes | My rent payments |
| POST | `/me/rent-payments` | Yes (tenant) | Pay rent |
| GET | `/me/rent-ledger` | Yes (owner) | Received payments |
| GET | `/me/rent-mandate` | Yes | Current mandate |
| PUT | `/me/rent-mandate` | Yes | Set up autopay |
| GET | `/me/payout-account` | Yes (owner) | Payout account |
| PUT | `/me/payout-account` | Yes (owner) | Set payout account |

### POST `/me/rent-payments`
```json
// Request
{ "ownerMobile": "9876543210", "propertyId": "PR1001", "amount": 25000, "month": "2026-07", "mode": "upi" }

// Response 201
{ "id": "RP1001", "status": "paid", "platformFee": 250, "gst": 45, ... }
```

---

## 18. Tenancies

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me/tenancies` | Yes | My active tenancies (as tenant) |
| GET | `/tenancies` | Yes (owner) | Tenancies in my properties |
| POST | `/tenancies` | Yes (system) | Create tenancy (on deal finalization) |

---

## 19. Tenant Profiles

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me/tenant-profile` | Yes | My tenant profile |
| PUT | `/me/tenant-profile` | Yes | Update profile |
| GET | `/tenant-profiles/:mobile` | Yes (owner) | View tenant's profile |

### PUT `/me/tenant-profile`
```json
// Request
{ "idVerified": true, "employment": "IT Professional", "income": "10-15 LPA", "priorLandlord": "Mr. Patil - 9800001234", "about": "Working professional, non-smoker", "occupants": 2 }

// Response 200
{ ...profile, "score": 85 }
```

---

## 20. Saved Properties & Searches

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me/saved-properties` | Yes | Saved property IDs |
| POST | `/me/saved-properties/:id/toggle` | Yes | Save/unsave |
| GET | `/me/saved-searches` | Yes | Saved searches |
| POST | `/me/saved-searches` | Yes | Save a search |
| DELETE | `/me/saved-searches/:id` | Yes | Remove |
| PATCH | `/me/saved-searches/:id/alert` | Yes | Toggle alert |

---

## 21. Plans, Boosts & Service Orders

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me/plan` | Yes | Current subscription |
| PUT | `/me/plan` | Yes | Subscribe/upgrade |
| GET | `/me/boosts/:listingId` | Yes | Check boost status |
| POST | `/me/boosts/:listingId` | Yes | Boost listing |
| GET | `/me/service-orders` | Yes | My service orders |
| POST | `/me/service-orders` | Yes | Place order |

---

## 22. Referrals

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me/referral/code` | Yes | My referral code |
| GET | `/me/referral/stats` | Yes | Referral stats |
| POST | `/me/referral/invite` | Yes | Record invite sent |
| GET | `/referrals` | Yes (admin) | All referrals |

---

## 23. Reviews & Ratings

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/reviews/:entityType/:entityId` | No | Reviews for entity |
| POST | `/reviews/:entityType/:entityId` | Yes | Add review |
| GET | `/reviews` | Yes (admin) | All reviews |

**entityType:** `society`, `locality`, `owner`

### POST `/reviews/:entityType/:entityId`
```json
// Request
{ "rating": 4, "text": "Well-maintained society with good amenities", "userName": "Aarav" }
```

---

## 24. Localities

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/localities` | No | All localities |
| GET | `/localities/:slug` | No | Locality detail + listings |

---

## 25. Reports (Listing Moderation)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/reports` | Yes | Report a listing |
| GET | `/reports` | Yes (admin) | All reports |

### POST `/reports`
```json
// Request
{ "listingId": "PR1001", "reason": "fake_photos", "details": "Photos are from a different property" }
```

---

## 26. Share a Flat

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/share-flat/requests` | No | All flatmate requests |
| POST | `/share-flat/requests` | Yes | Post request |
| PATCH | `/share-flat/requests/:id` | Yes | Update |
| DELETE | `/share-flat/requests/:id` | Yes | Remove |
| GET | `/share-flat/rooms` | No | Available rooms |
| POST | `/share-flat/rooms` | Yes | List a room |

---

## 27. Service Workflows (Rent Agreement, Valuation, etc.)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/service-requests` | Yes | My service requests |
| GET | `/service-requests/:id` | Yes | Request detail with timeline |
| POST | `/service-requests` | Yes | Create request |
| PATCH | `/service-requests/:id/status` | Yes (staff) | Update status |
| POST | `/service-requests/:id/messages` | Yes | Add message |
| POST | `/service-requests/:id/docs` | Yes | Upload/update document |
| POST | `/service-requests/:id/draft` | Yes (staff) | Share draft for review |
| POST | `/service-requests/:id/draft/decision` | Yes | Approve/reject draft |
| POST | `/service-requests/:id/final-doc` | Yes (staff) | Upload final document |

---

## 28. Rent Agreements

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/me/rent-agreements` | Yes | My agreements |
| POST | `/me/rent-agreements` | Yes | Create agreement record |
| GET | `/me/owner-kyc` | Yes | Owner KYC data |
| PUT | `/me/owner-kyc` | Yes | Save KYC |

---

## 29. Admin — Analytics & Settings

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/admin/kpis` | Yes (admin) | Dashboard KPIs |
| GET | `/admin/analytics` | Yes (admin) | Full analytics |
| GET | `/admin/analytics/traffic` | Yes (admin) | Traffic series |
| GET | `/admin/analytics/funnel` | Yes (admin) | Conversion funnel |
| GET | `/admin/settings` | Yes (admin) | Platform settings |
| PATCH | `/admin/settings` | Yes (admin) | Update settings |
| GET | `/admin/audit-log` | Yes (admin) | Audit trail |
| POST | `/admin/audit-log` | Yes (admin) | Log action |
| DELETE | `/admin/audit-log` | Yes (admin) | Clear log |
| GET | `/admin/finance/transactions` | Yes (admin) | Platform transactions |
| GET | `/admin/finance/revenue-series` | Yes (admin) | Revenue by month |

### GET `/admin/kpis`
```json
// Response 200
{ "users": 1250, "listings": 840, "approved": 720, "pending": 45, "openTickets": 12, "deals": 89, "enquiries": 340, "revenue": 2450000 }
```

---

## 30. Content / CMS

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/announcements` | No | Platform announcements |
| GET | `/plans` | No | Available subscription plans |
| GET | `/notifications` | Yes | User notifications |
| GET | `/services` | No | Service catalog |
| GET | `/faqs` | No | FAQ list |
| GET | `/banners` | No | Homepage banners |
| PATCH | `/content/:collection/:id/archive` | Yes (admin) | Archive content item |
| PATCH | `/content/:collection/:id/restore` | Yes (admin) | Restore archived content item |

### PATCH `/content/:collection/:id/archive`
Collections: `banners`, `faqs`, `announcements`, `reviews`
```json
// Request
{ "reason": "Outdated content" }
// Response 200 — item with archived: true
```

### PATCH `/content/:collection/:id/restore`
```json
// Request (no body)
// Response 200 — item with archived: false
```

---

## 31. Cities & Waitlist

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/cities` | No | Available cities |
| POST | `/cities/waitlist` | No | Join city waitlist |

---

## 32. Society Leads

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/society-leads` | Yes (admin) | All leads |
| POST | `/society-leads` | No | Submit society onboarding interest |

---

## 33. Platform Fees (Read-only)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/fees` | No | Current fee structure |

```json
// Response 200
{
  "ownerPlanYearly": 2999,
  "ownerProYearly": 7999,
  "rentAgreementPlatform": 499,
  "seekerPlusTopup": 499,
  "featuredListing": 999,
  "gstPercent": 18,
  "rentPayPercent": 1
}
```

---


---

> **Data model:** the PostgreSQL schema that backs these endpoints now lives in
> [`domain-model.md`](./domain-model.md) (the canonical entity reference).
