import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { AdapterAccount } from "next-auth/adapters";
import { prisma } from "@/database/prisma";
import { encryptToken, decryptToken } from "@/services/token-service";

const baseAdapter = PrismaAdapter(prisma);

/**
 * Wraps the Prisma adapter so refresh/access tokens are encrypted before
 * they touch the database and transparently decrypted on read. This keeps
 * Gmail OAuth secrets out of plaintext storage without leaking encryption
 * concerns into the rest of the app.
 */
const adapter = {
  ...baseAdapter,
  async linkAccount(account: AdapterAccount): Promise<void> {
    const secured: AdapterAccount = {
      ...account,
      access_token: account.access_token ? encryptToken(account.access_token) : account.access_token,
      refresh_token: account.refresh_token ? encryptToken(account.refresh_token) : account.refresh_token,
    };
    await baseAdapter.linkAccount!(secured);
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  session: { strategy: "database" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.send",
          access_type: "offline",
          prompt: "consent",
        },
      },
      // Google is the only sign-in method this app supports, so there's no
      // risk of a different provider spoofing the same email address;
      // this lets a user re-link Gmail (e.g. after a token/key rotation)
      // without Auth.js blocking it as a potential account-takeover attempt.
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.role = ((user as { role?: "user" | "admin" }).role ?? "user") as
          | "user"
          | "admin";
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
});

/** Reads and decrypts the stored Gmail OAuth tokens for a user, if connected. */
export async function getDecryptedGoogleAccount(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google", disconnectedAt: null },
  });
  if (!account) return null;
  return {
    ...account,
    access_token: account.access_token ? decryptToken(account.access_token) : null,
    refresh_token: account.refresh_token ? decryptToken(account.refresh_token) : null,
  };
}
