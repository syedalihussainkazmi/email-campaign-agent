import { prisma } from "@/database/prisma";
import { encryptToken, decryptToken } from "@/services/token-service";

const SMTP_CONFIG_KEY = "smtp_config";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
}

interface StoredSmtpConfig extends Omit<SmtpConfig, "password"> {
  encryptedPassword: string;
}

/** Reads and decrypts a user's custom SMTP (webmail) credentials, if configured. */
export async function getSmtpConfig(userId: string): Promise<SmtpConfig | null> {
  const setting = await prisma.setting.findUnique({
    where: { userId_key: { userId, key: SMTP_CONFIG_KEY } },
  });
  if (!setting?.value) return null;

  const stored: StoredSmtpConfig = JSON.parse(setting.value);
  return {
    host: stored.host,
    port: stored.port,
    secure: stored.secure,
    username: stored.username,
    fromEmail: stored.fromEmail,
    password: decryptToken(stored.encryptedPassword),
  };
}

/** Encrypts and stores a user's SMTP credentials, overwriting any previous config. */
export async function setSmtpConfig(userId: string, config: SmtpConfig): Promise<void> {
  const stored: StoredSmtpConfig = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    username: config.username,
    fromEmail: config.fromEmail,
    encryptedPassword: encryptToken(config.password),
  };
  const value = JSON.stringify(stored);

  await prisma.setting.upsert({
    where: { userId_key: { userId, key: SMTP_CONFIG_KEY } },
    update: { value },
    create: { userId, key: SMTP_CONFIG_KEY, value },
  });
}

export async function clearSmtpConfig(userId: string): Promise<void> {
  await prisma.setting.deleteMany({ where: { userId, key: SMTP_CONFIG_KEY } });
}
