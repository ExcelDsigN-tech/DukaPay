"use client";

import { motion } from "framer-motion";
import { Crown } from "lucide-react";
import { useGamificationStore, getNextLevelInfo } from "@/app/stores/useGamificationStore";
import { Card } from "../ui/Card";

interface KingdomProgressWidgetProps {
  className?: string;
  compact?: boolean;
}

export function KingdomProgressWidget({ className, compact = false }: KingdomProgressWidgetProps) {
  const level = useGamificationStore((state) => state.level);
  const xp = useGamificationStore((state) => state.xp);
  const kingdomTitle = useGamificationStore((state) => state.kingdomTitle);
  const animationsEnabled = useGamificationStore((state) => state.animationsEnabled);

  const { nextLevel, xpToNext, progress } = getNextLevelInfo(xp);
  const isMaxLevel = nextLevel === level;

  if (compact) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-subtle">
          <Crown size={18} strokeWidth={1.5} className="text-gold" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-fg">{kingdomTitle}</span>
            <span className="text-xs tabular-nums text-fg-muted">Lv. {level}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-subtle">
            <motion.div
              initial={animationsEnabled ? { width: 0 } : { width: `${progress}%` }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="h-full bg-primary"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className={className}>
      <div className="p-6">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle">
              <Crown size={20} strokeWidth={1.5} className="text-gold" />
            </div>
            <div>
              <h3 className="text-lg font-medium text-fg">{kingdomTitle}</h3>
              <p className="text-sm text-fg-muted">Level {level}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-mono text-2xl font-medium tabular-nums text-fg">{xp}</p>
            <p className="text-xs text-fg-muted">Total XP</p>
          </div>
        </div>

        {/* Progress bar */}
        {!isMaxLevel && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-fg-muted">Progress to Level {nextLevel}</span>
              <span className="font-medium tabular-nums text-fg">{xpToNext} XP needed</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-subtle">
              <motion.div
                initial={animationsEnabled ? { width: 0 } : { width: `${progress}%` }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full bg-primary"
              />
            </div>
            <p className="text-xs tabular-nums text-fg-muted">{progress.toFixed(1)}% complete</p>
          </div>
        )}

        {/* Max level message */}
        {isMaxLevel && (
          <div className="rounded-lg border border-line bg-subtle p-4 text-center">
            <p className="text-sm font-medium text-fg">Maximum level reached</p>
            <p className="mt-1 text-xs text-fg-muted">
              You&apos;ve achieved the highest rank in the Kingdom
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
