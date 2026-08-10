import { prisma } from "@/database/prisma";
import { encryptToken, decryptToken } from "@/services/token-service";

export interface SmtpAccountInput {
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  mailboxAgeStartDate: Date;
  dailyCapOverride?: number;
}

export interface SmtpAccountRecord extends Omit<SmtpAccountInput, "password"> {
  id: string;
  sentToday: number;
  isActive: boolean;
}

/** Resets sentToday to 0 exactly once per calendar day, on first read after midnight. */
async function rolloverIfNewDay(id: string, sentTodayDate: Date) {
  const today = new Date();
  const isSameDay =
    sentTodayDate.getFullYear() === today.getFullYear() &&
    sentTodayDate.getMonth() === today.getMonth() &&
    sentTodayDate.getDate() === today.getDate();

  if (!isSameDay) {
    await prisma.smtpAccount.update({
      where: { id },
      data: { sentToday: 0, sentTodayDate: today },
    });
    return 0;
  }
  return null;
}

export async function listSmtpAccounts(userId: string): Promise<SmtpAccountRecord[]> {
  const rows = await prisma.smtpAccount.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

  const records: SmtpAccountRecord[] = [];
  for (const row of rows) {
    const rolledOver = await rolloverIfNewDay(row.id, row.sentTodayDate);
    records.push({
      id: row.id,
      label: row.label,
      host: row.host,
      port: row.port,
      secure: row.secure,
      username: row.username,
      fromEmail: row.fromEmail,
      mailboxAgeStartDate: row.mailboxAgeStartDate,
      dailyCapOverride: row.dailyCapOverride ?? undefined,
      sentToday: rolledOver ?? row.sentToday,
      isActive: row.isActive,
    });
  }
  return records;
}

export async function getSmtpAccountWithPassword(id: string, userId: string) {
  const row = await prisma.smtpAccount.findFirst({ where: { id, userId } });
  if (!row) return null;
  return { ...row, password: decryptToken(row.encryptedPassword) };
}

export async function createSmtpAccount(userId: string, input: SmtpAccountInput) {
  return prisma.smtpAccount.create({
    data: {
      userId,
      label: input.label,
      host: input.host,
      port: input.port,
      secure: input.secure,
      username: input.username,
      encryptedPassword: encryptToken(input.password),
      fromEmail: input.fromEmail,
      mailboxAgeStartDate: input.mailboxAgeStartDate,
      dailyCapOverride: input.dailyCapOverride,
    },
  });
}

export async function deleteSmtpAccount(id: string, userId: string) {
  await prisma.smtpAccount.deleteMany({ where: { id, userId } });
}

export async function incrementSentToday(id: string) {
  await prisma.smtpAccount.update({ where: { id }, data: { sentToday: { increment: 1 } } });
}
