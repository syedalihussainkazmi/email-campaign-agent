"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface EmailEditorProps {
  subject: string;
  onSubjectChange: (value: string) => void;
  body: string;
  onBodyChange: (value: string) => void;
}

const AVERAGE_WORDS_PER_MINUTE = 200;

export function EmailEditor({ subject, onSubjectChange, body, onBodyChange }: EmailEditorProps) {
  const characterCount = body.length;
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;
  const readTimeMinutes = Math.max(1, Math.ceil(wordCount / AVERAGE_WORDS_PER_MINUTE));

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Subject line"
        value={subject}
        onChange={(e) => onSubjectChange(e.target.value)}
      />
      <Textarea
        placeholder="Write your email…"
        rows={10}
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
      />
      <div className="flex gap-4 text-xs text-zinc-500">
        <span>{characterCount} characters</span>
        <span>~{readTimeMinutes} min read</span>
      </div>
    </div>
  );
}
