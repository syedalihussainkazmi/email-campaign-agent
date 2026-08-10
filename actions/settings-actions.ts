"use server";

import { z } from "zod";
import { requireSession } from "@/auth/session";
import { setSignature } from "@/services/signature-service";
import { createSmtpAccount, deleteSmtpAccount } from "@/services/smtp-service";
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

const smtpAccountSchema = z.object({
  label: z.string().min(1),
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().min(1),
  password: z.string().min(1),
  fromEmail: z.string().email(),
  mailboxAgeStartDate: z.coerce.date(),
  dailyCapOverride: z.coerce.number().int().min(1).optional(),
});

export async function addSmtpAccountAction(input: z.infer<typeof smtpAccountSchema>) {
  const session = await requireSession();
  const parsed = smtpAccountSchema.parse(input);

  const verification = await verifySmtpConfig(parsed);
  if (!verification.ok) {
    return { ok: false, error: verification.error ?? "Could not connect with these SMTP settings" };
  }

  await createSmtpAccount(session.user.id, parsed);
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeSmtpAccountAction(accountId: string) {
  const session = await requireSession();
  await deleteSmtpAccount(accountId, session.user.id);
  revalidatePath("/settings");
  return { ok: true };
}
