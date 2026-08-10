import { markUnsubscribed } from "@/services/unsubscribe-service";

async function handle(token: string) {
  await markUnsubscribed(token);
  return new Response(
    "<html><body style=\"font-family:sans-serif;padding:2rem\">" +
      "You've been unsubscribed and won't receive further emails from this sender.</body></html>",
    { headers: { "Content-Type": "text/html" } },
  );
}

// A human clicking the visible link in the email body.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handle(token);
}

// RFC 8058 one-click: mail clients POST here directly with no confirmation
// page - the spec requires this to succeed silently, no further interaction.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return handle(token);
}
