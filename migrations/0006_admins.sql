-- Workshop demo login. Seeded username `admin`, password `admin`.
-- Rotate this account before it is used outside the workshop.
-- password_hash is SHA-256 hex of `astra-cs-workshop-admin-v1:` plus the password.
-- The plaintext password is not written into any served HTML or JavaScript.

CREATE TABLE IF NOT EXISTS admins (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO admins (username, password_hash, created_at)
VALUES (
  'admin',
  '941acedaa6c55e6b895204638ba15ddba8dcb967cd836cede1178c0bf7e324aa',
  '2026-10-07T00:00:00.000Z'
);
