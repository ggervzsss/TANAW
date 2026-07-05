import { motion } from "motion/react";
import type { ReactNode } from "react";
import { fadeInDown } from "./motionVariants";

type PageMotionProps = {
  children: ReactNode;
  className?: string;
};

export function PageMotion({ children, className = "pb-12" }: PageMotionProps) {
  return (
    <motion.div className={className} initial="hidden" animate="visible" variants={fadeInDown} transition={{ duration: 0.25, ease: "easeOut" }} style={{ willChange: "transform, opacity" }}>
      {children}
    </motion.div>
  );
}
