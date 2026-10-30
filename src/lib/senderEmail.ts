import { z } from "zod";

export function normalizeSenderEmail(value: string): string {
  return z.string().trim().email().max(255).parse(value).toLowerCase();
}

export function resolveSenderEmail(preferred: string | null | undefined, connected: string): string {
  const actual = normalizeSenderEmail(connected);
  if (preferred && normalizeSenderEmail(preferred) !== actual) {
    throw new Error(`Sending paused: reconnect Gmail as ${preferred} before sending. The connected account is ${actual}.`);
  }
  return actual;
}