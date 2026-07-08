import { prisma } from "@/database/prisma";

export async function getAdminStats() {
  const [userCount, campaignCount, sentTotal, failedTotal] = await Promise.all([
    prisma.user.count(),
    prisma.campaign.count(),
    prisma.campaign.aggregate({ _sum: { sentCount: true } }),
    prisma.campaign.aggregate({ _sum: { failedCount: true } }),
  ]);

  return {
    userCount,
    campaignCount,
    sentTotal: sentTotal._sum.sentCount ?? 0,
    failedTotal: failedTotal._sum.failedCount ?? 0,
  };
}

export async function searchCampaignsAdmin(query: string, status?: string, page = 1, pageSize = 25) {
  const where = {
    ...(query ? { subject: { contains: query, mode: "insensitive" as const } } : {}),
    ...(status ? { status: status as never } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.campaign.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function listUsersAdmin(page = 1, pageSize = 25) {
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    }),
    prisma.user.count(),
  ]);
  return { items, total, page, pageSize };
}

export async function listAuditLogsAdmin(page = 1, pageSize = 50) {
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { email: true } } },
    }),
    prisma.auditLog.count(),
  ]);
  return { items, total, page, pageSize };
}
