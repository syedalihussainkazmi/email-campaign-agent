/** Returns a random integer in [minSeconds, maxSeconds], inclusive. */
export function randomDelaySeconds(minSeconds = 5, maxSeconds = 10): number {
  return Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
