import type { BasicAuthCredentials } from "./request-auth";

export const COOKIE_NAME = "ai_workbench_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
}

async function sign(payload: string, password: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
}

export async function createSessionToken(email: string, password: string) {
  const payload = `${email}|${Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS}`;
  return `${base64Url(new TextEncoder().encode(payload))}.${await sign(payload, password)}`;
}

export async function isSessionValid(token: string | undefined, expected: BasicAuthCredentials) {
  if (!token) return false;
  try {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) return false;
    const payload = new TextDecoder().decode(fromBase64Url(encodedPayload));
    const separator = payload.lastIndexOf("|");
    const email = payload.slice(0, separator);
    const expiresAt = Number(payload.slice(separator + 1));
    return email === expected.email && expiresAt > Math.floor(Date.now() / 1000) && signature === await sign(payload, expected.password);
  } catch {
    return false;
  }
}

export function sessionCookie(token: string) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}
