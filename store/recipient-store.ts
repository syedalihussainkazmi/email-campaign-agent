import { create } from "zustand";
import { parseRecipients, type ParsedRecipient } from "@/services/recipient-service";

interface RecipientState {
  valid: ParsedRecipient[];
  invalidCount: number;
  duplicateCount: number;
  addFromText: (text: string) => void;
  remove: (email: string) => void;
  clearAll: () => void;
  removeDuplicates: () => void;
}

export const useRecipientStore = create<RecipientState>((set, get) => ({
  valid: [],
  invalidCount: 0,
  duplicateCount: 0,

  addFromText: (text: string) => {
    const existing = get().valid;
    const { valid, invalid, duplicates } = parseRecipients(text);

    const merged = new Map(existing.map((r) => [r.email, r]));
    let newDuplicates = duplicates.length;
    for (const recipient of valid) {
      if (merged.has(recipient.email)) {
        newDuplicates += 1;
      } else {
        merged.set(recipient.email, recipient);
      }
    }

    set({
      valid: Array.from(merged.values()),
      invalidCount: get().invalidCount + invalid.length,
      duplicateCount: get().duplicateCount + newDuplicates,
    });
  },

  remove: (email: string) =>
    set((state) => ({ valid: state.valid.filter((r) => r.email !== email) })),

  clearAll: () => set({ valid: [], invalidCount: 0, duplicateCount: 0 }),

  removeDuplicates: () => set({ duplicateCount: 0 }),
}));
