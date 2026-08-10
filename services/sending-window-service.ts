import { prisma } from "@/database/prisma";

export interface SendingWindow {
  startHour: number; // 0-23, inclusive
  endHour: number; // 0-23, exclusive
  timezone: string; // IANA timezone, e.g. "Australia/Brisbane"
  sendOnWeekends: boolean;
}

const DEFAULT_WINDOW: SendingWindow = {
  startHour: 9,
  endHour: 17,
  timezone: "UTC",
  sendOnWeekends: false,
};

const SENDING_WINDOW_KEY = "sending_window";

/** Pure — no I/O. Checks `now` against the window using timezone-aware hour/weekday extraction. */
export function isWithinSendingWindow(now: Date, window: SendingWindow): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: window.timezone,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  });
  const parts = formatter.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const isWeekend = weekday === "Sat" || weekday === "Sun";

  if (isWeekend && !window.sendOnWeekends) return false;
  return hour >= window.startHour && hour < window.endHour;
}

export async function getSendingWindow(userId: string): Promise<SendingWindow> {
  const setting = await prisma.setting.findUnique({
    where: { userId_key: { userId, key: SENDING_WINDOW_KEY } },
  });
  return setting?.value ? JSON.parse(setting.value) : DEFAULT_WINDOW;
}

export async function setSendingWindow(userId: string, window: SendingWindow): Promise<void> {
  const value = JSON.stringify(window);
  await prisma.setting.upsert({
    where: { userId_key: { userId, key: SENDING_WINDOW_KEY } },
    update: { value },
    create: { userId, key: SENDING_WINDOW_KEY, value },
  });
}
