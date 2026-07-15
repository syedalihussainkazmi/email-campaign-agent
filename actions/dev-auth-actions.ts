"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/database/prisma";
import { createDatabaseSession } from "@/auth/session-cookie";
import { isDevLoginEnabled } from "@/utils/dev-login";

/**
 * Signs the browser in as a seeded dev user, bypassing Google OAuth entirely.
 * Lets someone preview the dashboard/admin UI without setting up real
 * credentials. Writes directly to the same Session table NextAuth reads,
 * so the rest of the app treats it exactly like a real signed-in session.
 */
export async function devSignInAction() {
  if (!isDevLoginEnabled()) {
    throw new Error("Dev login is disabled");
  }

  const user = await prisma.user.upsert({
    where: { email: "preview@mailpilot.local" },
    update: {},
    create: { email: "preview@mailpilot.local", name: "Preview User", role: "admin" },
  });

  await createDatabaseSession(user.id);
  redirect("/");
}
