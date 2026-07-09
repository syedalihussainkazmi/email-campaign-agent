import { prisma } from "@/database/prisma";

const SIGNATURE_KEY = "email_signature";

export async function getSignature(userId: string): Promise<string> {
  const setting = await prisma.setting.findUnique({
    where: { userId_key: { userId, key: SIGNATURE_KEY } },
  });
  return setting?.value ?? "";
}

export async function setSignature(userId: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { userId_key: { userId, key: SIGNATURE_KEY } },
    update: { value },
    create: { userId, key: SIGNATURE_KEY, value },
  });
}
