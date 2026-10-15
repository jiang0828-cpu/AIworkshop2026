import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const profile = await prisma.profile.upsert({ where: { id: "local-profile" }, update: {}, create: { id: "local-profile" } });
  await prisma.aIInstruction.upsert({ where: { profileId: profile.id }, update: {}, create: { profileId: profile.id } });
  console.log(`Initialized profile ${profile.id}`);
}

main().finally(() => prisma.$disconnect());
