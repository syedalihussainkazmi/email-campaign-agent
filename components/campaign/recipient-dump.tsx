"use client";

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRecipientStore } from "@/store/recipient-store";
import type { ParsedRecipient } from "@/services/recipient-service";

const CHIP_ROW_HEIGHT = 40;
const CHIPS_PER_ROW = 3;

export function RecipientDump() {
  const [draft, setDraft] = useState("");
  const { valid, invalidCount, duplicateCount, addFromText, remove, clearAll, removeDuplicates } =
    useRecipientStore();

  const rows = useMemo(() => {
    const chunked: ParsedRecipient[][] = [];
    for (let i = 0; i < valid.length; i += CHIPS_PER_ROW) {
      chunked.push(valid.slice(i, i + CHIPS_PER_ROW));
    }
    return chunked;
  }, [valid]);

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CHIP_ROW_HEIGHT,
    overscan: 8,
  });

  function handlePaste() {
    if (!draft.trim()) return;
    addFromText(draft);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        placeholder={
          "One per line. Plain emails work, or pair with a business name for {name} personalization:\n" +
          "Acme Corp, john@acme.com\n" +
          "jane@beta.com - Beta LLC\n" +
          "Gamma Inc: sales@gamma.com, info@gamma.com"
        }
        rows={5}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handlePaste}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">Valid: {valid.length}</Badge>
        <Badge variant="destructive">Invalid: {invalidCount}</Badge>
        <Badge variant="warning">Duplicates: {duplicateCount}</Badge>
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={removeDuplicates}>
            Remove Duplicates
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={clearAll}>
            Clear All
          </Button>
        </div>
      </div>

      {valid.length > 0 && (
        <div ref={parentRef} className="max-h-64 overflow-auto rounded-lg border border-zinc-800 p-2">
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                className="absolute left-0 top-0 flex w-full flex-wrap gap-2"
                style={{ transform: `translateY(${virtualRow.start}px)`, height: CHIP_ROW_HEIGHT }}
              >
                {rows[virtualRow.index].map((recipient) => (
                  <span
                    key={recipient.email}
                    className="group flex items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-200"
                    title={recipient.email}
                  >
                    {recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email}
                    <button
                      type="button"
                      aria-label={`Remove ${recipient.email}`}
                      onClick={() => remove(recipient.email)}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
