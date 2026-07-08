import { auth } from "@/auth/auth";

/** Throws if there is no authenticated session; otherwise returns it. */
export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    throw new Error("UNAUTHENTICATED");
  }
  return session;
}

/** Throws unless the current user is an admin. */
export async function requireAdmin() {
  const session = await requireSession();
  if (session.user.role !== "admin") {
    throw new Error("FORBIDDEN");
  }
  return session;
}
