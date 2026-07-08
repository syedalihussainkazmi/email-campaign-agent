import { create } from "zustand";
import { parseRecipients } from "@/services/recipient-service";

interface RecipientState {
  valid: string[];
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

    const merged = new Set(existing);
    let newDuplicates = duplicates.length;
    for (const email of valid) {
      if (merged.has(email)) {
        newDuplicates += 1;
      } else {
        merged.add(email);
      }
    }

    set({
      valid: Array.from(merged),
      invalidCount: get().invalidCount + invalid.length,
      duplicateCount: get().duplicateCount + newDuplicates,
    });
  },

  remove: (email: string) =>
    set((state) => ({ valid: state.valid.filter((e) => e !== email) })),

  clearAll: () => set({ valid: [], invalidCount: 0, duplicateCount: 0 }),

  removeDuplicates: () => set({ duplicateCount: 0 }),
}));
