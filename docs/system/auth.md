# Auth

- Back-office users sign in at `/staff-login` with email, password and TOTP; `/auth/login` refuses
  `admin`, `manager` and `staff` even after a valid OTP.
- Role hierarchy is `admin > manager > staff`. There is one administrator per environment, created or
  recovered by `BOOTSTRAP_ADMIN_*`; managers can create/manage staff only.
- Staff and manager invite links are returned once from Team actions (`/staff-invite#...`, seven-day
  TTL). They are not sent by SMS/email and are not logged or stored in plain text.
- Manager actions on staff accounts notify the administrator through the in-app notification table.
