"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Crown, Gift, Check } from "lucide-react";
import { useGamificationStore } from "@/app/stores/useGamificationStore";
import { useSoundEffect } from "@/app/utils/soundManager";
import { Button } from "../ui/Button";
import { useModalFocusTrap } from "../../hooks/useModalFocusTrap";

export function LevelUpModal() {
  const showModal = useGamificationStore((state) => state.showLevelUpModal);
  const pendingLevelUp = useGamificationStore((state) => state.pendingLevelUp);
  const dismissLevelUp = useGamificationStore((state) => state.dismissLevelUp);
  const soundEnabled = useGamificationStore((state) => state.soundEnabled);
  const animationsEnabled = useGamificationStore((state) => state.animationsEnabled);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const sound = useSoundEffect();

  const handleClose = () => {
    if (soundEnabled) {
      sound.play("click");
    }
    dismissLevelUp();
  };

  useModalFocusTrap({
    isOpen: showModal,
    onClose: handleClose,
    containerRef: modalRef,
    initialFocusRef: closeButtonRef,
  });

  useEffect(() => {
    if (showModal && soundEnabled) {
      sound.play("levelUp");
    }
  }, [showModal, soundEnabled, sound]);

  if (!pendingLevelUp) return null;

  return (
    <AnimatePresence>
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            ref={modalRef}
            initial={animationsEnabled ? { opacity: 0, y: 8 } : { opacity: 0 }}
            animate={animationsEnabled ? { opacity: 1, y: 0 } : { opacity: 1 }}
            exit={animationsEnabled ? { opacity: 0, y: 4 } : { opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="level-up-modal-title"
            tabIndex={-1}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
          >
            {/* Close button */}
            <button
              ref={closeButtonRef}
              onClick={handleClose}
              aria-label="Close level up modal"
              className="absolute top-4 right-4 z-10 rounded-lg p-2 text-fg-muted transition-colors hover:bg-subtle hover:text-fg"
            >
              <X size={20} />
            </button>

            {/* Content */}
            <div className="relative p-8 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-subtle">
                <Crown size={28} strokeWidth={1.5} className="text-gold" />
              </div>

              {/* Level up text */}
              <motion.h2
                id="level-up-modal-title"
                initial={animationsEnabled ? { opacity: 0, y: 4 } : {}}
                animate={animationsEnabled ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.05 }}
                className="mb-2 font-display text-2xl font-medium text-fg"
              >
                Level {pendingLevelUp.level}
              </motion.h2>

              <motion.p
                initial={animationsEnabled ? { opacity: 0, y: 4 } : {}}
                animate={animationsEnabled ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.1 }}
                className="mb-6 text-base text-fg-muted"
              >
                You are now a <span className="font-medium text-fg">{pendingLevelUp.title}</span>
              </motion.p>

              {/* Rewards */}
              <motion.div
                initial={animationsEnabled ? { opacity: 0, y: 4 } : {}}
                animate={animationsEnabled ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.15 }}
                className="mb-6 rounded-xl border border-line bg-subtle p-4"
              >
                <div className="mb-3 flex items-center justify-center gap-2 text-fg">
                  <Gift size={16} strokeWidth={1.5} className="text-fg-muted" />
                  <h3 className="text-sm font-medium">Rewards unlocked</h3>
                </div>
                <ul className="space-y-2 text-sm text-fg-muted">
                  {pendingLevelUp.rewards.map((reward, index) => (
                    <motion.li
                      key={index}
                      initial={animationsEnabled ? { opacity: 0 } : {}}
                      animate={animationsEnabled ? { opacity: 1 } : {}}
                      transition={{ delay: 0.2 + index * 0.05 }}
                      className="flex items-center justify-center gap-2"
                    >
                      <Check size={14} strokeWidth={1.5} className="text-ok" aria-hidden="true" />
                      {reward}
                    </motion.li>
                  ))}
                </ul>
              </motion.div>

              {/* Continue button */}
              <motion.div
                initial={animationsEnabled ? { opacity: 0, y: 4 } : {}}
                animate={animationsEnabled ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.2 }}
              >
                <Button onClick={handleClose} className="w-full">
                  Continue
                </Button>
              </motion.div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
