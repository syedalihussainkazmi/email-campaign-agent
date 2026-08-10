import { NextResponse } from "next/server";
import { prisma } from "@/database/prisma";

export async function GET(req: Request, { params }: { params: Promise<{ trackingId: string }> }) {
  const { trackingId } = await params;
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  const recipient = await prisma.campaignRecipient.findUnique({ where: { trackingId } });
  await prisma.campaignRecipient.update({
    where: { trackingId },
    data: {
      firstClickedAt: recipient?.firstClickedAt ?? new Date(),
      clickCount: { increment: 1 },
    },
  });

  return NextResponse.redirect(url);
}
