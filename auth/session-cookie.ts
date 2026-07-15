import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { prisma } from "@/database/prisma";

const SESSION_COOKIE = "authjs.session-token";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Creates a database session row for a user and sets the matching cookie,
 * bypassing NextAuth's own sign-in flow. Used by any auth path that
 * verifies identity itself (dev preview login, webmail SMTP login) rather
 * than going through an OAuth provider — the rest of the app can't tell
 * the difference since it only ever reads sessions via the Session table.
 */
export async function createDatabaseSession(userId: string): Promise<void> {
  const token = randomUUID();
  const expires = new Date(Date.now() + SESSION_MAX_AGE_MS);

  await prisma.session.create({
    data: { sessionToken: token, userId, expires },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
  });
}
