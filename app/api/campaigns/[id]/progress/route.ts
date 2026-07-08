import { NextResponse } from "next/server";
import { auth } from "@/auth/auth";
import { getCampaignProgress } from "@/services/campaign-service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { id } = await params;
  const progress = await getCampaignProgress(session.user.id, id);
  if (!progress) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(progress);
}
