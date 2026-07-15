"use server";

import { z } from "zod";
import { requireSession } from "@/auth/session";
import { setSignature } from "@/services/signature-service";
import { setSmtpConfig, clearSmtpConfig, getSmtpConfig } from "@/services/smtp-service";
import { verifySmtpConfig } from "@/services/smtp-sender";
import { revalidatePath } from "next/cache";

const signatureSchema = z.object({ signature: z.string().max(20000) });

export async function saveSignatureAction(input: z.infer<typeof signatureSchema>) {
  const session = await requireSession();
  const { signature } = signatureSchema.parse(input);

  await setSignature(session.user.id, signature);
  revalidatePath("/settings");

  return { ok: true };
}

const smtpConfigSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().min(1),
  password: z.string(),
  fromEmail: z.string().email(),
});

export async function saveSmtpConfigAction(input: z.infer<typeof smtpConfigSchema>) {
  const session = await requireSession();
  const parsed = smtpConfigSchema.parse(input);

  let password = parsed.password;
  if (!password) {
    const existing = await getSmtpConfig(session.user.id);
    if (!existing) {
      return { ok: false, error: "Password is required" };
    }
    password = existing.password;
  }

  const config = { ...parsed, password };
  const verification = await verifySmtpConfig(config);
  if (!verification.ok) {
    return { ok: false, error: verification.error ?? "Could not connect with these SMTP settings" };
  }

  await setSmtpConfig(session.user.id, config);
  revalidatePath("/settings");

  return { ok: true };
}

export async function disconnectSmtpAction() {
  const session = await requireSession();
  await clearSmtpConfig(session.user.id);
  revalidatePath("/settings");
  return { ok: true };
}
