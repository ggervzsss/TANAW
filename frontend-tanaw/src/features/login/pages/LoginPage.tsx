import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { motion } from "motion/react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/app/store/authStore";
import { getRoleDashboardPath } from "@/app/routers/roleRoutes";
import { AuthParticles, AuthThemeToggle, LoginBackground, LoginForm } from "../components";
import { useAuthStageGlow, useLogin } from "../hooks";
import { SAN_PEDRO_SEAL } from "../utils";

function SampaguitaIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M20 18.5C18.2 14.1 18.9 9.8 20 6.7C21.1 9.8 21.8 14.1 20 18.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.2 20C12.8 18.3 10.3 14.7 8.9 11.7C12.2 12.1 16.3 13.6 19 17.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.9 23C12.5 24.8 8.3 23.9 5.4 22.7C8.4 21 12.4 19.9 16.9 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M23.1 20C27.5 18.3 30 14.7 31.1 11.7C27.8 12.1 23.7 13.6 21 17.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M23.1 23C27.5 24.8 31.7 23.9 34.6 22.7C31.6 21 27.6 19.9 23.1 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="21" r="2.4" fill="currentColor" />
    </svg>
  );
}

export function LoginPage() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const { clearLoginMessage, handleLoginSubmit, lockoutSeconds, loginMessage } = useLogin();
  const { stageGlowStyle, stageRef } = useAuthStageGlow<HTMLElement>();
  const [isBackgroundReady, setIsBackgroundReady] = useState(false);

  useEffect(() => {
    if (user?.role === "enterprise") {
      logout();
    }
  }, [logout, user?.role]);

  if (user?.role === "enterprise") {
    return null;
  }

  if (user) {
    return <Navigate to={getRoleDashboardPath(user.role)} replace />;
  }

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
        <section className="tanaw-auth-hero relative hidden min-h-[min(42rem,calc(100svh-2rem))] items-end overflow-visible px-2 pb-10 text-white lg:flex xl:pb-14">
          <motion.div className="relative z-10 max-w-xl" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, ease: "easeOut" }}>
            <div className="tanaw-sampaguita-glow mb-5 inline-flex text-(--tanaw-gold)">
              <SampaguitaIcon className="h-8 w-8" />
            </div>
            <h2 className="tanaw-auth-hero-title font-['Montserrat'] text-5xl leading-tight font-bold tracking-normal text-white drop-shadow-[0_10px_22px_rgba(0,0,0,0.28)] xl:text-6xl">
              Welcome to San Pedro
            </h2>
            <div className="tanaw-gold-shimmer mt-5 h-0.75 w-28 rounded-full bg-(--tanaw-gold)" />
            <p className="tanaw-auth-hero-copy mt-6 max-w-lg text-lg leading-8 font-medium text-white/95 drop-shadow-[0_8px_18px_rgba(0,0,0,0.25)]">
              Your platform to manage tourism, empower enterprises, and build a thriving community.
            </p>
            <div className="tanaw-auth-hero-location mt-10 flex items-center gap-3 text-xs font-bold tracking-[0.35em] text-white uppercase">
              <MapPin className="h-5 w-5 flex-none text-white" strokeWidth={2} />
              <span>San Pedro, Laguna, Philippines</span>
            </div>
          </motion.div>
        </section>

        <main className="flex min-h-0 items-center justify-center lg:justify-end">
          <motion.div
            className="tanaw-auth-card tanaw-login-card relative z-10 w-full max-w-145 rounded-[30px] border border-white/80 bg-(--tanaw-card)/96 px-6 py-8 shadow-[0_30px_90px_rgba(3,20,12,0.32)] ring-1 ring-black/3 backdrop-blur-xl sm:px-9 sm:py-9 xl:px-10"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
          >
            <header className="tanaw-auth-card-header mb-8">
              <div className="flex items-center gap-5 sm:gap-7">
                <img
                  src={SAN_PEDRO_SEAL}
                  alt="City of San Pedro seal"
                  className="tanaw-auth-brand-seal h-16 w-16 flex-none object-contain drop-shadow-[0_12px_18px_rgba(3,61,36,0.08)] sm:h-21.5 sm:w-21.5"
                />
                <div className="min-w-0">
                  <h1 className="tanaw-auth-brand-title font-['Montserrat'] text-2xl leading-tight font-extrabold tracking-normal text-(--tanaw-green) sm:text-[2.35rem]">TANAW PORTAL</h1>
                  <p className="tanaw-auth-brand-subtitle mt-2 text-sm leading-6 font-medium text-(--tanaw-muted) sm:text-lg">San Pedro Tourism Management</p>
                </div>
              </div>

              <div className="tanaw-auth-divider mt-8 flex items-center gap-3 text-(--tanaw-gold)">
                <SampaguitaIcon className="h-4 w-4 flex-none" />
                <span className="tanaw-gold-shimmer h-px flex-1 bg-(--tanaw-gold)/75" />
              </div>
            </header>

            <LoginForm authMessage={loginMessage} lockoutSeconds={lockoutSeconds} onAuthMessageClear={clearLoginMessage} onSubmit={handleLoginSubmit} />
          </motion.div>
        </main>
      </div>
    </section>
  );
}
