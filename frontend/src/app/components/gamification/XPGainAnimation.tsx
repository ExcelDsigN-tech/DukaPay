"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

interface XPGainAnimationProps {
  amount: number;
  show: boolean;
  onComplete?: () => void;
  position?: "top" | "center" | "bottom";
}

export function XPGainAnimation({
  amount,
  show,
  onComplete,
  position = "top",
}: XPGainAnimationProps) {
  const [isVisible, setIsVisible] = useState(show);

  useEffect(() => {
    if (show) {
      setIsVisible(true); // eslint-disable-line react-hooks/set-state-in-effect -- syncs visibility with prop
      const timer = setTimeout(() => {
        setIsVisible(false);
        onComplete?.();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [show, onComplete]);

  const positionClasses = {
    top: "top-4",
    center: "top-1/2 -translate-y-1/2",
    bottom: "bottom-4",
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className={`fixed left-1/2 ${positionClasses[position]} z-50 -translate-x-1/2`}
        >
          <div className="rounded-xl border border-line bg-surface px-4 py-2 shadow-sm">
            <span className="font-mono text-sm font-medium tabular-nums text-fg">+{amount} XP</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
