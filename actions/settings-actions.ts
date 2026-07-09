"use server";

import { z } from "zod";
import { requireSession } from "@/auth/session";
import { setSignature } from "@/services/signature-service";
import { revalidatePath } from "next/cache";

const signatureSchema = z.object({ signature: z.string().max(20000) });

export async function saveSignatureAction(input: z.infer<typeof signatureSchema>) {
  const session = await requireSession();
  const { signature } = signatureSchema.parse(input);

  await setSignature(session.user.id, signature);
  revalidatePath("/settings");

  return { ok: true };
}
