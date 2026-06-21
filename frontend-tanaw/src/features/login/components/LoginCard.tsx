import type { ReactNode } from "react";
import { motion } from "motion/react";

type LoginCardProps = {
  children: ReactNode;
};

export function LoginCard({ children }: LoginCardProps) {
  return (
    <motion.div
      className="border-t-tanaw-lime relative z-10 w-full max-w-md rounded-[40px] border-t-8 bg-white p-12 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] max-sm:rounded-[28px] max-sm:p-8"
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
