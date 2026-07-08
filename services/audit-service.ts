import type { Prisma } from "@prisma/client";
import { prisma } from "@/database/prisma";

export async function logAudit(
  userId: string | null,
  action: string,
  target?: { type: string; id: string },
  metadata?: Prisma.InputJsonValue,
) {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      targetType: target?.type,
      targetId: target?.id,
      metadata,
    },
  });
}
