"use server";

import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/database/prisma";
import { isDevLoginEnabled } from "@/utils/dev-login";

const SESSION_COOKIE = "authjs.session-token";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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

  const token = randomUUID();
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + SESSION_MAX_AGE_MS) },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(Date.now() + SESSION_MAX_AGE_MS),
  });

  redirect("/");
}
