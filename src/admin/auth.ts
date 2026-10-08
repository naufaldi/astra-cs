/**
 * HTTP Basic for /admin. The username and password are checked against the admins table.
 * The workshop seed is username `admin`. Rotate that password outside the workshop.
 * The plaintext password is never written into HTML or JavaScript.
 */

import type { HandoffDb } from "../agent/handoff.js";

/** Prefix for the workshop seed hash. Keep this equal to the comment in 0006_admins.sql. */
const ADMIN_PASSWORD_SALT = "astra-cs-workshop-admin-v1";

type AdminRow = { password_hash: string };

/** SHA-256 hex of the fixed workshop salt plus the password. */
export async function hashAdminPassword(password: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ADMIN_PASSWORD_SALT}:${password}`),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function basicCredentials(request: Request): { username: string; password: string } | null {
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Basic ";
  if (!header.startsWith(prefix)) {
    return null;
  }
  let decoded = "";
  try {
    decoded = atob(header.slice(prefix.length).trim());
  } catch {
    return null;
  }
  const splitAt = decoded.indexOf(":");
  if (splitAt <= 0) {
    return null;
  }
  return { username: decoded.slice(0, splitAt), password: decoded.slice(splitAt + 1) };
}

function hashesEqual(left: string, right: string): boolean {
  if (left.length !== right.length || left.length === 0) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

/** True when Basic username and password match a row in admins. */
export async function adminAuthorized(request: Request, db: HandoffDb): Promise<boolean> {
  const credentials = basicCredentials(request);
  if (!credentials || credentials.password === "") {
    return false;
  }
  const found = await db
    .prepare("SELECT password_hash FROM admins WHERE username = ?")
    .bind(credentials.username)
    .all<AdminRow>();
  const stored = found.results[0]?.password_hash ?? "";
  const hashed = await hashAdminPassword(credentials.password);
  return hashesEqual(hashed, stored);
}

/** 401 with a Basic challenge. The body does not include a password. */
export function unauthorized(): Response {
  return new Response("Login with your admin account", {
    status: 401,
    headers: {
      "www-authenticate": 'Basic realm="admin"',
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
