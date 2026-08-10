import { NextResponse } from "next/server";
import { auth } from "@/auth/session";
import { searchCampaignsAdmin } from "@/services/admin-service";
import { toCsv } from "@/utils/export";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "json";
  const q = searchParams.get("q") ?? "";

  const { items } = await searchCampaignsAdmin(q, undefined, 1, 1000);
  const rows = items.map((c) => ({
    id: c.id,
    subject: c.subject,
    user: c.user.email,
    status: c.status,
    totalCount: c.totalCount,
    sentCount: c.sentCount,
    deliveredCount: c.deliveredCount,
    failedCount: c.failedCount,
    createdAt: c.createdAt.toISOString(),
  }));

  if (format === "csv") {
    return new NextResponse(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=campaigns.csv",
      },
    });
  }

  return NextResponse.json(rows);
}
