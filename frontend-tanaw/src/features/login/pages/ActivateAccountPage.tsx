import { MapPin, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { AccountActivationCard, AuthParticles, AuthThemeToggle, LoginBackground } from "../components";
import { useAccountActivation, useAuthStageGlow } from "../hooks";
import { useState } from "react";

export function ActivateAccountPage() {
  const activation = useAccountActivation();
  const { stageGlowStyle, stageRef } = useAuthStageGlow<HTMLElement>();
  const [isBackgroundReady, setIsBackgroundReady] = useState(false);

  return (
    <section
      ref={stageRef}
      className="tanaw-login-stage tanaw-auth-stage relative min-h-svh w-full bg-(--tanaw-bg) font-['Bai_Jamjuree'] text-(--tanaw-text)"
      style={stageGlowStyle}
      data-auth-background-ready={isBackgroundReady}
    >
      <LoginBackground className="absolute inset-y-0 left-0 w-full lg:w-[82%]" onReady={() => setIsBackgroundReady(true)} />
      <div className="tanaw-login-color-grade absolute inset-0" aria-hidden="true" />
      <div className="tanaw-login-edge-blur absolute inset-0" aria-hidden="true" />
      <div className="tanaw-stage-glow absolute inset-0" aria-hidden="true" />
      <AuthParticles />
      <AuthThemeToggle />
      <div className="tanaw-auth-shell relative z-10 grid min-h-svh items-center gap-8 px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1.04fr)_minmax(420px,0.82fr)] lg:gap-10 lg:px-12 xl:px-20">
        <section className="tanaw-auth-hero relative hidden min-h-[min(42rem,calc(100svh-2rem))] items-end px-2 pb-10 text-white lg:flex xl:pb-14">
          <motion.div className="relative z-10 max-w-xl" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, ease: "easeOut" }}>
            <ShieldCheck className="mb-5 h-9 w-9 text-(--tanaw-gold)" aria-hidden="true" />
            <h2 className="tanaw-auth-hero-title font-['Montserrat'] text-5xl leading-tight font-bold tracking-normal text-white drop-shadow-[0_10px_22px_rgba(0,0,0,0.28)] xl:text-6xl">
              Secure your TANAW account
            </h2>
            <div className="tanaw-gold-shimmer mt-5 h-0.75 w-28 rounded-full bg-(--tanaw-gold)" />
            <p className="tanaw-auth-hero-copy mt-6 max-w-lg text-lg leading-8 font-medium text-white/95 drop-shadow-[0_8px_18px_rgba(0,0,0,0.25)]">
              Confirm your registered email and create a private password before accessing TANAW.
            </p>
            <div className="tanaw-auth-hero-location mt-10 flex items-center gap-3 text-xs font-bold tracking-[0.35em] text-white uppercase">
              <MapPin className="h-5 w-5 flex-none text-white" strokeWidth={2} />
              <span>San Pedro, Laguna, Philippines</span>
            </div>
          </motion.div>
        </section>
        <main className="flex min-h-0 items-center justify-center lg:justify-end">
          <motion.section
            className="tanaw-auth-card tanaw-activation-card relative z-10 w-full max-w-145 rounded-[30px] border border-white/80 bg-(--tanaw-card)/96 px-6 py-8 shadow-[0_30px_90px_rgba(3,20,12,0.32)] ring-1 ring-black/3 backdrop-blur-xl sm:px-9 sm:py-9 xl:px-10"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
          >
            <AccountActivationCard {...activation} onChange={activation.updateField} onSubmit={activation.submit} />
          </motion.section>
        </main>
      </div>
    </section>
  );
}
