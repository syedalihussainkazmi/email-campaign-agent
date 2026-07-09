/** True outside production, or when explicitly opted into via env var. Never active in a real deployment by default. */
export function isDevLoginEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEV_LOGIN === "true";
}
