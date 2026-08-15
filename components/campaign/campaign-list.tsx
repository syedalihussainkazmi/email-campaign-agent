"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CampaignActionsBar } from "@/components/campaign/campaign-actions-bar";
import { staggerContainer, staggerItem } from "@/utils/motion";
import type { CampaignStatus } from "@/types/campaign";

const STATUS_VARIANT = {
  draft: "default",
  running: "warning",
  paused: "warning",
  completed: "success",
  failed: "destructive",
} as const;

export interface CampaignListItem {
  id: string;
  subject: string;
  status: CampaignStatus;
  createdAt: Date;
  totalCount: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  bouncedCount: number;
  repliedCount: number;
}

interface CampaignListProps {
  campaigns: CampaignListItem[];
  /** "history" shows the full delivered/failed/bounced/replied row; "dashboard" shows just sent/total. */
  variant: "history" | "dashboard";
}

export function CampaignList({ campaigns, variant }: CampaignListProps) {
  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="flex flex-col gap-3">
      {campaigns.map((c) => (
        <motion.div key={c.id} variants={staggerItem}>
          <Card className="transition-colors hover:border-zinc-700">
            <Link href={`/history/${c.id}`} className="block">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle>{c.subject}</CardTitle>
                  <CardDescription>{c.createdAt.toLocaleString()}</CardDescription>
                </div>
                <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
              </CardHeader>
              <CardContent className="flex gap-6 text-xs text-zinc-400">
                {variant === "history" ? (
                  <>
                    <span>Total: {c.totalCount}</span>
                    <span>Delivered: {c.deliveredCount}</span>
                    <span>Failed: {c.failedCount}</span>
                    <span>Bounced: {c.bouncedCount}</span>
                    <span>Replied: {c.repliedCount}</span>
                  </>
                ) : (
                  <span>
                    {c.sentCount}/{c.totalCount} sent
                  </span>
                )}
              </CardContent>
            </Link>
            <CardContent className="pt-0">
              <CampaignActionsBar campaignId={c.id} status={c.status} />
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </motion.div>
  );
}
