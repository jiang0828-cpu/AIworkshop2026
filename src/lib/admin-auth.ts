import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";

const ADMIN_ID = "super-admin";
// Cloudflare's production WebCrypto implementation caps PBKDF2 at 100,000 iterations.
const PBKDF2_ITERATIONS = 100_000;

export type StoredAdmin = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
};

function encode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256));
}

export async function hashAdminPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derive(password, salt);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${encode(salt)}$${encode(digest)}`;
}

export async function verifyAdminPassword(password: string, encoded: string) {
  try {
    const [algorithm, iterationText, saltText, digestText] = encoded.split("$");
    if (algorithm !== "pbkdf2-sha256") return false;
    const iterations = Number(iterationText);
    if (!Number.isSafeInteger(iterations) || iterations < 100_000) return false;
    const actual = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: decode(saltText), iterations, hash: "SHA-256" },
      await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]),
      256,
    );
    const expected = decode(digestText);
    const bytes = new Uint8Array(actual);
    if (bytes.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < bytes.length; index += 1) difference |= bytes[index] ^ expected[index];
    return difference === 0;
  } catch {
    return false;
  }
}

function cloudflareDb(): D1Database | null {
  try {
    return getCloudflareContext().env.WORKBENCH_DB || null;
  } catch {
    return null;
  }
}

export async function readStoredAdmin(): Promise<StoredAdmin | null> {
  const db = cloudflareDb();
  if (!db) return null;
  const row = await db.prepare("SELECT id, email, password_hash AS passwordHash, role FROM admin_accounts WHERE id = ?1 LIMIT 1").bind(ADMIN_ID).first<StoredAdmin>();
  return row || null;
}

export async function ensureStoredAdmin(email: string, password: string) {
  const db = cloudflareDb();
  if (!db) return null;
  const existing = await readStoredAdmin();
  if (existing) return existing;
  const passwordHash = await hashAdminPassword(password);
  await db.prepare("INSERT INTO admin_accounts (id, email, password_hash, role) VALUES (?1, ?2, ?3, 'SUPER_ADMIN')").bind(ADMIN_ID, email, passwordHash).run();
  return { id: ADMIN_ID, email, passwordHash, role: "SUPER_ADMIN" } satisfies StoredAdmin;
}

export async function updateStoredAdmin(email: string, password: string) {
  const db = cloudflareDb();
  if (!db) throw new Error("管理员账户只能在 Cloudflare Worker 环境中修改");
  const passwordHash = await hashAdminPassword(password);
  await db.prepare("INSERT INTO admin_accounts (id, email, password_hash, role) VALUES (?1, ?2, ?3, 'SUPER_ADMIN') ON CONFLICT(id) DO UPDATE SET email = excluded.email, password_hash = excluded.password_hash, updated_at = CURRENT_TIMESTAMP").bind(ADMIN_ID, email, passwordHash).run();
  return { id: ADMIN_ID, email, passwordHash, role: "SUPER_ADMIN" } satisfies StoredAdmin;
}
