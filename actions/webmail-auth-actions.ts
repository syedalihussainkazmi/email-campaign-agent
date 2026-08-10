"use server";

import { z } from "zod";
import { prisma } from "@/database/prisma";
import { createDatabaseSession } from "@/auth/session-cookie";
import { setSmtpConfig } from "@/services/smtp-service";
import { verifySmtpConfig } from "@/services/smtp-sender";
import { isRateLimited } from "@/server/rate-limiter";

const webmailSignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
});

type WebmailSignInResult = { ok: true } | { ok: false; error: string };

/**
 * Signs in directly with webmail/SMTP credentials — the only sign-in path
 * this app supports. The credentials are verified against the real SMTP
 * server first (proving ownership), then a user is created/found by email
 * and a database session is issued directly. The verified config is saved
 * immediately, so sending works right away post-login.
 */
export async function webmailSignInAction(
  input: z.infer<typeof webmailSignInSchema>,
): Promise<WebmailSignInResult> {
  const parsed = webmailSignInSchema.parse(input);

  if (isRateLimited(`webmail-signin:${parsed.email.toLowerCase()}`)) {
    return { ok: false, error: "Too many attempts, please slow down" };
  }

  const config = {
    host: parsed.host,
    port: parsed.port,
    secure: parsed.secure,
    username: parsed.email,
    password: parsed.password,
    fromEmail: parsed.email,
  };

  const verification = await verifySmtpConfig(config);
  if (!verification.ok) {
    return { ok: false, error: verification.error ?? "Could not verify these SMTP credentials" };
  }

  const user = await prisma.user.upsert({
    where: { email: parsed.email.toLowerCase() },
    update: {},
    create: { email: parsed.email.toLowerCase() },
  });

  await setSmtpConfig(user.id, config);
  await createDatabaseSession(user.id);

  return { ok: true };
}
