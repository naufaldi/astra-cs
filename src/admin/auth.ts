/**
 * HTTP Basic for /admin. The password is the workshop key.
 * The key is checked here and is never written into HTML or JavaScript.
 */

import { workshopKeyMatches } from "../agent/workshop-key.js";

/** True when the Basic password matches the workshop key. The username is ignored. */
export async function adminAuthorized(request: Request, expectedKey: string): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Basic ";
  if (!header.startsWith(prefix)) {
    return false;
  }
  let decoded = "";
  try {
    decoded = atob(header.slice(prefix.length).trim());
  } catch {
    return false;
  }
  const splitAt = decoded.indexOf(":");
  const password = splitAt === -1 ? "" : decoded.slice(splitAt + 1);
  return workshopKeyMatches(password, expectedKey);
}

/** 401 with a Basic challenge. The body does not include the key. */
export function unauthorized(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "www-authenticate": 'Basic realm="admin"',
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
