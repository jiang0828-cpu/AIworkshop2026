import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

let cloudflareClient: PrismaClient | null = null;

export function isCloudflareD1Runtime() {
  try {
    return Boolean(getCloudflareContext().env.WORKBENCH_DB);
  } catch {
    return false;
  }
}

export async function getDb(): Promise<PrismaClient> {
  try {
    const { env } = getCloudflareContext();
    if (env.WORKBENCH_DB) {
      if (!cloudflareClient) {
        // This D1-only client is intentionally loaded inside a Worker request.
        // Loading it in the Node build would pull in the Worker runtime package.
        const { PrismaClient: CloudflarePrismaClient } = await import("@prisma/cloudflare-client/wasm");
        cloudflareClient = new CloudflarePrismaClient({ adapter: new PrismaD1(env.WORKBENCH_DB) }) as unknown as PrismaClient;
      }
      return cloudflareClient;
    }
  } catch {
    // The normal Next.js development server has no Cloudflare request context.
  }
  const client = globalForPrisma.prisma ?? new PrismaClient();
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = client;
  return client;
}

export const PROFILE_ID = "local-profile";

export async function ensureProfile() {
  const db = await getDb();
  // Polling existing profiles is read-only; avoid competing SQLite upsert transactions.
  const existing=await db.profile.findUnique({where:{id:PROFILE_ID},include:{aiInstruction:true}});
  if(existing)return existing;
  return db.profile.upsert({
    where: { id: PROFILE_ID },
    update: {},
    create: { id: PROFILE_ID, aiInstruction: { create: {} } },
    include: { aiInstruction: true },
  });
}
