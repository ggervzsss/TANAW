import { motion } from "motion/react";
import type { ReactNode } from "react";
import { fadeInDown } from "./motionVariants";

export function PageMotion({ children }: { children: ReactNode }) {
  return (
    <motion.div className="pb-12" initial="hidden" animate="visible" variants={fadeInDown} transition={{ duration: 0.25, ease: "easeOut" }} style={{ willChange: "transform, opacity" }}>
      {children}
    </motion.div>
  );
}
