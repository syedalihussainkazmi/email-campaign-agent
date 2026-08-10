import { NextResponse } from "next/server";
import { pollAllInboxes } from "@/server/inbox-poller";

export async function GET() {
  const result = await pollAllInboxes();
  return NextResponse.json(result);
}
