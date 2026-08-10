import { cookies } from "next/headers";
import { prisma } from "@/database/prisma";

const SESSION_COOKIE = "authjs.session-token";

export interface Session {
  user: { id: string; email: string; name: string | null; role: string };
}

/** Reads the current session directly from the cookie + Session table — no OAuth provider involved. */
export async function auth(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { sessionToken: token },
    include: { user: true },
  });

  if (!session || session.expires < new Date()) return null;

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
    },
  };
}

/** Throws if there is no authenticated session; otherwise returns it. */
export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("UNAUTHENTICATED");
  }
  return session;
}

/** Throws unless the current user is an admin. */
export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    throw new Error("FORBIDDEN");
  }
  return session;
}

export async function signOut(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { sessionToken: token } });
  }
  cookieStore.delete(SESSION_COOKIE);
}
