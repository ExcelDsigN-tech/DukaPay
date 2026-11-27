"use client";

import { motion } from "framer-motion";
import {
  Lock,
  CheckCircle,
  Target,
  HandCoins,
  Star,
  Trophy,
  Sunrise,
  Flame,
  type LucideIcon,
} from "lucide-react";
import { useGamificationStore } from "@/app/stores/useGamificationStore";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";

const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  first_loan: Target,
  first_repayment: HandCoins,
  perfect_score: Star,
  five_loans: Trophy,
  early_bird: Sunrise,
  streak_master: Flame,
};

interface AchievementsPanelProps {
  className?: string;
}

export function AchievementsPanel({ className }: AchievementsPanelProps) {
  const achievements = useGamificationStore((state) => state.achievements);
  const animationsEnabled = useGamificationStore((state) => state.animationsEnabled);

  const unlockedCount = achievements.filter((a) => a.unlockedAt).length;
  const totalCount = achievements.length;
  const completionPercentage = (unlockedCount / totalCount) * 100;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Achievements</CardTitle>
          <div className="font-mono text-sm tabular-nums text-fg-muted">
            {unlockedCount} / {totalCount}
          </div>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-subtle">
          <motion.div
            initial={animationsEnabled ? { width: 0 } : { width: `${completionPercentage}%` }}
            animate={{ width: `${completionPercentage}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="h-full bg-primary"
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {achievements.map((achievement, index) => {
            const isUnlocked = !!achievement.unlockedAt;
            const progress = achievement.progress || 0;
            const maxProgress = achievement.maxProgress || 1;
            const progressPercentage = (progress / maxProgress) * 100;
            const Icon = ACHIEVEMENT_ICONS[achievement.id] ?? Trophy;

            return (
              <motion.div
                key={achievement.id}
                initial={animationsEnabled ? { opacity: 0, y: 4 } : {}}
                animate={animationsEnabled ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: index * 0.05 }}
                className={`rounded-xl border border-line p-4 ${isUnlocked ? "bg-surface" : "bg-subtle"}`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div
                    className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                      isUnlocked ? "bg-subtle text-gold" : "bg-surface text-fg-muted"
                    }`}
                  >
                    {isUnlocked ? (
                      <Icon size={18} strokeWidth={1.5} aria-hidden="true" />
                    ) : (
                      <Lock size={18} strokeWidth={1.5} aria-hidden="true" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4
                        className={`text-sm font-medium ${isUnlocked ? "text-fg" : "text-fg-muted"}`}
                      >
                        {achievement.title}
                      </h4>
                      {isUnlocked && (
                        <CheckCircle size={16} strokeWidth={1.5} className="text-ok" />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-fg-muted">{achievement.description}</p>

                    {/* Progress bar for locked achievements */}
                    {!isUnlocked && maxProgress > 1 && (
                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between text-xs text-fg-muted">
                          <span>Progress</span>
                          <span className="tabular-nums">
                            {progress} / {maxProgress}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                          <motion.div
                            initial={
                              animationsEnabled ? { width: 0 } : { width: `${progressPercentage}%` }
                            }
                            animate={{ width: `${progressPercentage}%` }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                            className="h-full bg-primary"
                          />
                        </div>
                      </div>
                    )}

                    {/* Unlock date */}
                    {isUnlocked && achievement.unlockedAt && (
                      <p className="mt-2 text-xs text-fg-muted">
                        Unlocked {new Date(achievement.unlockedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
