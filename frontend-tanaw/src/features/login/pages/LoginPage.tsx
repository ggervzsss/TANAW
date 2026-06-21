import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { motion } from "motion/react";
import { Navigate } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { useAuthStore } from "@/app/store/authStore";
import { getRoleDashboardPath } from "@/shared/utils/routeUtils";
import { LoginForm } from "../components";
import { useLogin } from "../hooks";
import { SAN_PEDRO_GATEWAY_IMAGE, SAN_PEDRO_SEAL } from "../utils";

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

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

export function LoginPage() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const { handleLoginSubmit, lockoutSeconds } = useLogin();
  const particles = useMemo(
    () => [
      { left: "7%", top: "58%", size: 3, delay: "0s", duration: "12s" },
      { left: "12%", top: "66%", size: 4, delay: "1.1s", duration: "13.5s" },
      { left: "18%", top: "51%", size: 2, delay: "2.6s", duration: "11s" },
      { left: "23%", top: "74%", size: 3, delay: "0.4s", duration: "14s" },
      { left: "31%", top: "61%", size: 4, delay: "3.2s", duration: "12.5s" },
      { left: "38%", top: "80%", size: 2, delay: "1.8s", duration: "15s" },
      { left: "44%", top: "55%", size: 3, delay: "4.1s", duration: "13s" },
      { left: "52%", top: "70%", size: 2, delay: "2.2s", duration: "12s" },
      { left: "58%", top: "48%", size: 3, delay: "5s", duration: "14.5s" },
      { left: "15%", top: "84%", size: 2, delay: "5.8s", duration: "16s" },
      { left: "68%", top: "62%", size: 2, delay: "3.8s", duration: "15.5s" },
      { left: "78%", top: "26%", size: 3, delay: "6.4s", duration: "17s" },
      { left: "88%", top: "78%", size: 2, delay: "7.1s", duration: "14s" },
    ],
    [],
  );
  const [heroGlow, setHeroGlow] = useState({ x: 28, y: 72 });
  const stageRef = useRef<HTMLElement | null>(null);

  const handleStagePointerMove = (event: PointerEvent<HTMLElement>) => {
    const bounds = stageRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    setHeroGlow({
      x: clampPercent(((event.clientX - bounds.left) / bounds.width) * 100),
      y: clampPercent(((event.clientY - bounds.top) / bounds.height) * 100),
    });
  };

  useEffect(() => {
    if (user?.role === "enterprise") {
      logout();
    }
  }, [logout, user?.role]);

  if (user?.role === "enterprise") {
    return null;
  }

  if (user) {
    if (user.mustChangePassword) {
      return <Navigate to={routes.changePassword} replace />;
    }
    return <Navigate to={getRoleDashboardPath(user.role)} replace />;
  }

  return (
    <section
      ref={stageRef}
      className="tanaw-login-stage relative min-h-screen w-full overflow-hidden bg-[var(--tanaw-bg)] font-['Bai_Jamjuree'] text-(--tanaw-text)"
      onPointerMove={handleStagePointerMove}
      style={
        {
          "--hero-glow-x": `${heroGlow.x}%`,
          "--hero-glow-y": `${heroGlow.y}%`,
        } as CSSProperties
      }
    >
      <div className="tanaw-login-photo absolute inset-y-0 left-0 w-full lg:w-[82%]" style={{ backgroundImage: `url(${SAN_PEDRO_GATEWAY_IMAGE})` }} aria-hidden="true" />
      <div className="tanaw-login-color-grade absolute inset-0" aria-hidden="true" />
      <div className="tanaw-login-edge-blur absolute inset-0" aria-hidden="true" />
      <div className="tanaw-stage-glow absolute inset-0" aria-hidden="true" />
      <div className="tanaw-stage-particles absolute inset-0" aria-hidden="true">
        {particles.map((particle, index) => (
          <span
            key={index}
            className="tanaw-hero-particle"
            style={
              {
                left: particle.left,
                top: particle.top,
                width: `${particle.size}px`,
                height: `${particle.size}px`,
                "--particle-delay": particle.delay,
                "--particle-duration": particle.duration,
              } as CSSProperties
            }
          />
        ))}
      </div>

      <div className="relative z-10 grid min-h-screen items-center gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1.04fr)_minmax(520px,0.82fr)] lg:px-12 xl:px-20">
        <section className="relative hidden min-h-[calc(100vh-4rem)] items-end overflow-visible px-2 pb-14 text-white lg:flex xl:pb-[4.5rem]">
          <motion.div className="relative z-10 max-w-xl" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, ease: "easeOut" }}>
            <div className="tanaw-sampaguita-glow mb-5 inline-flex text-[var(--tanaw-gold)]">
              <SampaguitaIcon className="h-8 w-8" />
            </div>
            <h2 className="font-['Montserrat'] text-5xl leading-tight font-bold tracking-normal text-white drop-shadow-[0_10px_22px_rgba(0,0,0,0.28)] xl:text-6xl">Welcome to San Pedro</h2>
            <div className="tanaw-gold-shimmer mt-5 h-[3px] w-28 rounded-full bg-[var(--tanaw-gold)]" />
            <p className="mt-6 max-w-lg text-lg leading-8 font-medium text-white/95 drop-shadow-[0_8px_18px_rgba(0,0,0,0.25)]">
              Your gateway to manage tourism, empower enterprises, and build a thriving community.
            </p>
            <div className="mt-10 flex items-center gap-3 text-xs font-bold tracking-[0.35em] text-white uppercase">
              <MapPin className="h-5 w-5 flex-none text-white" strokeWidth={2} />
              <span>San Pedro, Laguna, Philippines</span>
            </div>
          </motion.div>
        </section>

        <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center lg:min-h-0 lg:justify-end">
          <motion.div
            className="relative z-10 w-full max-w-[580px] rounded-[30px] border border-white/80 bg-[var(--tanaw-card)]/96 px-6 py-8 shadow-[0_30px_90px_rgba(3,20,12,0.32)] ring-1 ring-black/[0.03] backdrop-blur-xl sm:px-10 sm:py-11 xl:px-12"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            onPointerMove={(event) => event.stopPropagation()}
          >
            <header className="mb-8">
              <div className="flex items-center gap-5 sm:gap-7">
                <img src={SAN_PEDRO_SEAL} alt="City of San Pedro seal" className="h-16 w-16 flex-none object-contain drop-shadow-[0_12px_18px_rgba(3,61,36,0.08)] sm:h-[86px] sm:w-[86px]" />
                <div className="min-w-0">
                  <h1 className="font-['Montserrat'] text-2xl leading-tight font-extrabold tracking-normal text-[var(--tanaw-green)] sm:text-[2.35rem]">TANAW PORTAL</h1>
                  <p className="mt-2 text-sm leading-6 font-medium text-[var(--tanaw-muted)] sm:text-lg">San Pedro Tourism Management</p>
                </div>
              </div>

              <div className="mt-8 flex items-center gap-3 text-[var(--tanaw-gold)]">
                <SampaguitaIcon className="h-4 w-4 flex-none" />
                <span className="tanaw-gold-shimmer h-px flex-1 bg-[var(--tanaw-gold)]/75" />
              </div>
            </header>

            <LoginForm onSubmit={handleLoginSubmit} lockoutSeconds={lockoutSeconds} />
          </motion.div>
        </main>
      </div>
    </section>
  );
}
