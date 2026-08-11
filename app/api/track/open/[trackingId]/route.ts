import { prisma } from "@/database/prisma";

// A 1x1 transparent GIF — the smallest valid image, served on every hit.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7", "base64");

export async function GET(_req: Request, { params }: { params: Promise<{ trackingId: string }> }) {
  const { trackingId } = await params;

  const recipient = await prisma.campaignRecipient.findUnique({ where: { trackingId } });
  if (recipient) {
    await prisma.campaignRecipient.update({
      where: { trackingId },
      data: {
        openedAt: recipient.openedAt ?? new Date(),
        openCount: { increment: 1 },
      },
    });
  }

  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
    },
  });
}
