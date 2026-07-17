import { type CSSProperties, type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { AlertCircle, ArrowRight, ExternalLink, Eye, EyeOff, Headphones, LockKeyhole, MapPin, UserRound } from "lucide-react";
import { routePaths } from "../../../app/router/routePaths";
import { cn } from "../../../utils/cn";
import { PASSWORD_INPUT_MAX_CODE_UNITS } from "../../../utils/password-policy";
import { useAuthStageGlow } from "../hooks/use-auth-stage-glow";
import { useLogin } from "../hooks/use-login";
import { loginSchema, type LoginFormValues } from "../schemas/login-schema";
import { isRememberEnabled, useAuthStore } from "../stores/auth-store";
import { AuthThemeToggle } from "./AuthThemeToggle";
import { PasswordRecoveryDialog } from "./PasswordRecoveryDialog";
import { SupportRequestDialog } from "./SupportRequestDialog";

const cityHallDayImage = `${import.meta.env.BASE_URL}images/dsc00386.jpg`;
const cityHallNightImage = `${import.meta.env.BASE_URL}images/dsc00386-night.png`;

const citySeal = "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Seal_of_San_Pedro%2C_Laguna.png/1280px-Seal_of_San_Pedro%2C_Laguna.png";

const authBackgroundImageStyle = {
  "--tanaw-auth-day-image": `url("${cityHallDayImage}")`,
  "--tanaw-auth-night-image": `url("${cityHallNightImage}")`,
} as CSSProperties;

type FormErrors = Partial<Record<keyof LoginFormValues, string>>;
type DialogMode = "recovery" | "support" | null;

type LoginLocationState = {
  from?: {
    pathname?: string;
    search?: string;
  };
};

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

const formatLockout = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function LoginPage() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const location = useLocation();
  const locationState = location.state as LoginLocationState | null;
  const redirectTo = locationState?.from?.pathname ? `${locationState.from.pathname}${locationState.from.search ?? ""}` : undefined;
  const [authMessage, setAuthMessage] = useState("");
  const loginMutation = useLogin(redirectTo, { onAuthMessage: setAuthMessage });
  const particles = useMemo(
    () => [
      { left: "7%", top: "58%", size: 3, delay: "0s", duration: "12s" },
      { left: "18%", top: "51%", size: 2, delay: "2.6s", duration: "11s" },
      { left: "23%", top: "74%", size: 3, delay: "0.4s", duration: "14s" },
      { left: "31%", top: "61%", size: 4, delay: "3.2s", duration: "12.5s" },
      { left: "44%", top: "55%", size: 3, delay: "4.1s", duration: "13s" },
      { left: "15%", top: "84%", size: 2, delay: "5.8s", duration: "16s" },
      { left: "88%", top: "78%", size: 2, delay: "7.1s", duration: "14s" },
    ],
    [],
  );
  const [showPassword, setShowPassword] = useState(false);
  const [values, setValues] = useState<LoginFormValues>({
    username: "",
    password: "",
  });
  const [rememberMe, setRememberMe] = useState(() => isRememberEnabled());
  const [errors, setErrors] = useState<FormErrors>({});
  const [activeDialog, setActiveDialog] = useState<DialogMode>(null);
  const { stageGlowStyle, stageRef } = useAuthStageGlow<HTMLDivElement>();

  if (isAuthenticated) {
    return <Navigate to={routePaths.enterpriseDashboard} replace />;
  }

  const updateField = (field: keyof LoginFormValues) => (event: ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({
      ...current,
      [field]: event.target.value,
    }));
    if (authMessage) setAuthMessage("");
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthMessage("");
    const parsed = loginSchema.safeParse(values);

    if (!parsed.success) {
      const nextErrors: FormErrors = {};
      parsed.error.issues.forEach((issue) => {
        const field = issue.path[0] as keyof LoginFormValues;
        nextErrors[field] = issue.message;
      });
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    if (loginMutation.lockoutSeconds <= 0) loginMutation.mutate({ ...parsed.data, rememberMe });
  };

  return (
    <div
      ref={stageRef}
      className="tanaw-login-stage tanaw-auth-stage tanaw-auth-desktop-stage tanaw-auth-shell relative grid h-svh min-h-svh grid-cols-[minmax(0,1.04fr)_minmax(420px,0.72fr)] items-center gap-8 bg-(--tanaw-bg) px-6 py-6 text-(--tanaw-text) lg:gap-10 lg:px-10 lg:py-8"
      style={stageGlowStyle}
    >
      <div className="tanaw-login-photo absolute inset-y-0 left-0 w-[82%]" style={authBackgroundImageStyle} aria-hidden="true" />
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
      <AuthThemeToggle />

      <section className="tanaw-auth-hero relative z-10 flex min-h-[min(42rem,calc(100svh-2rem))] items-end overflow-visible px-2 pb-10 text-white xl:pb-14">
        <motion.div className="relative z-10 max-w-xl" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, ease: "easeOut" }}>
          <div className="tanaw-sampaguita-glow mb-5 inline-flex text-(--tanaw-gold)">
            <SampaguitaIcon className="h-8 w-8" />
          </div>
          <h1 className="tanaw-auth-hero-title font-display text-5xl leading-tight font-bold text-white drop-shadow-[0_10px_22px_rgba(0,0,0,0.28)]">Enterprise Portal</h1>
          <div className="tanaw-gold-shimmer mt-5 h-0.75 w-28 rounded-full bg-(--tanaw-gold)" />
          <p className="tanaw-auth-hero-copy mt-6 max-w-lg text-lg leading-8 font-medium text-white/95 drop-shadow-[0_8px_18px_rgba(0,0,0,0.25)]">
            Secure access for tourism enterprise reporting, camera monitoring, and operational compliance.
          </p>
          <div className="tanaw-auth-hero-location mt-10 flex items-center gap-3 text-xs font-bold tracking-[0.35em] text-white uppercase">
            <MapPin className="h-5 w-5 flex-none text-white" strokeWidth={2} />
            <span>San Pedro, Laguna, Philippines</span>
          </div>
        </motion.div>
      </section>

      <motion.form
        initial={{ opacity: 0, x: 18 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        onSubmit={handleSubmit}
        noValidate
        autoComplete="on"
        className="tanaw-auth-card relative z-10 ml-auto w-full max-w-145 rounded-[30px] border border-white/80 bg-white/96 p-8 shadow-[0_30px_90px_rgba(3,20,12,0.32)] ring-1 ring-black/3 backdrop-blur-xl xl:p-10"
        onPointerMove={(event) => event.stopPropagation()}
      >
        <div className="tanaw-auth-card-header mb-8">
          <div className="flex items-center gap-6">
            <img src={citySeal} alt="City of San Pedro seal" className="tanaw-auth-brand-seal h-20 w-20 object-contain drop-shadow-[0_12px_18px_rgba(3,61,36,0.08)]" />
            <div>
              <h2 className="tanaw-auth-brand-title font-display text-[2rem] leading-tight font-extrabold text-(--tanaw-green)">TANAW PORTAL</h2>
              <p className="tanaw-auth-brand-subtitle mt-2 text-base font-medium text-(--tanaw-muted)">Enterprise Tourism Management</p>
            </div>
          </div>
          <div className="tanaw-auth-divider mt-8 flex items-center gap-3 text-(--tanaw-gold)">
            <SampaguitaIcon className="h-4 w-4 flex-none" />
            <span className="tanaw-gold-shimmer h-px flex-1 bg-(--tanaw-gold)/75" />
          </div>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-(--tanaw-text)">Username or email</span>
            <div
              data-state={errors.username ? "invalid" : values.username ? "valid" : "empty"}
              className={cn(
                "tanaw-auth-field relative flex h-14 items-center rounded-xl border transition duration-200 focus-within:border-(--tanaw-green) focus-within:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]",
                errors.username ? "border-(--tanaw-error) shadow-[0_0_0_4px_rgba(220,38,38,0.08)]" : "border-(--tanaw-border)",
              )}
            >
              <UserRound size={19} className="tanaw-auth-field-icon pointer-events-none absolute left-5" />
              <input
                id="enterprise-login-identifier"
                name="username"
                type="text"
                autoComplete="username"
                className="tanaw-auth-input h-full w-full rounded-xl bg-transparent px-14 pr-12 text-[15px] font-medium outline-none"
                placeholder="Enter username or registered email"
                value={values.username}
                onChange={updateField("username")}
                disabled={loginMutation.isPending}
                aria-invalid={Boolean(errors.username)}
              />
              {errors.username ? <AlertCircle className="absolute right-5 h-5 w-5 text-(--tanaw-error)" strokeWidth={2.2} /> : null}
            </div>
            <span className="mt-1 block min-h-4 text-xs font-medium text-(--tanaw-error)">{errors.username}</span>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-(--tanaw-text)">Password</span>
            <div
              data-state={errors.password ? "invalid" : values.password ? "valid" : "empty"}
              className={cn(
                "tanaw-auth-field relative flex h-14 items-center rounded-xl border transition duration-200 focus-within:border-(--tanaw-green) focus-within:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]",
                errors.password ? "border-(--tanaw-error) shadow-[0_0_0_4px_rgba(220,38,38,0.08)]" : "border-(--tanaw-border)",
              )}
            >
              <LockKeyhole size={19} className="tanaw-auth-field-icon pointer-events-none absolute left-5" />
              <input
                id="enterprise-login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                className="tanaw-auth-input h-full w-full rounded-xl bg-transparent px-14 pr-24 text-[15px] font-medium outline-none"
                placeholder="Enter your password"
                value={values.password}
                onChange={updateField("password")}
                maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
                disabled={loginMutation.isPending}
                aria-invalid={Boolean(errors.password)}
              />
              {errors.password ? <AlertCircle className="absolute right-12 h-5 w-5 text-(--tanaw-error)" strokeWidth={2.2} /> : null}
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((current) => !current)}
                className="tanaw-auth-field-action absolute right-4 rounded-full p-1 transition hover:text-(--tanaw-green) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </div>
            <span className="mt-1 block min-h-4 text-xs font-medium text-(--tanaw-error)">{errors.password}</span>
          </label>
        </div>

        <div className="tanaw-auth-control-gap mt-1 mb-7 flex items-center justify-between gap-4">
          <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-(--tanaw-text)">
            <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} className="h-5 w-5 rounded border-(--tanaw-border) accent-(--tanaw-green)" />
            Remember me
          </label>
          <button
            type="button"
            onClick={() => setActiveDialog("recovery")}
            className="tanaw-soft-link -mr-2 rounded-full px-3 py-1.5 text-sm font-semibold text-(--tanaw-green) transition hover:text-(--tanaw-green-dark)"
          >
            Forgot password?
          </button>
        </div>

        {authMessage ? (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert" aria-live="assertive">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" strokeWidth={2.2} aria-hidden="true" />
            <span>{authMessage}</span>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loginMutation.isPending || loginMutation.lockoutSeconds > 0}
          className="tanaw-auth-primary-action flex h-15 w-full items-center justify-center gap-7 rounded-xl bg-[linear-gradient(135deg,var(--tanaw-green)_0%,var(--tanaw-green-dark)_100%)] px-6 text-base font-semibold text-white shadow-[0_16px_30px_rgba(6,78,47,0.22)] transition hover:-translate-y-px hover:shadow-[0_18px_36px_rgba(6,78,47,0.28)] disabled:cursor-not-allowed disabled:opacity-75"
        >
          {loginMutation.lockoutSeconds > 0 ? `Try again in ${formatLockout(loginMutation.lockoutSeconds)}` : loginMutation.isPending ? "Signing in..." : "Sign in"}
          <ArrowRight className="h-5 w-5" strokeWidth={2} />
        </button>

        <div className="tanaw-auth-divider-row my-8 flex items-center gap-4 text-sm font-semibold text-(--tanaw-muted)">
          <span className="h-px flex-1 bg-(--tanaw-border)" />
          <span>OR</span>
          <span className="h-px flex-1 bg-(--tanaw-border)" />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="tanaw-auth-support-icon flex h-12 w-12 flex-none items-center justify-center rounded-lg border border-(--tanaw-border) bg-white text-[#6f7785] shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
              <Headphones className="h-6 w-6" strokeWidth={1.9} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-(--tanaw-text)">Need help signing in?</span>
              <span className="block text-sm text-(--tanaw-muted)">Contact our support team.</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveDialog("support")}
            className="inline-flex items-center gap-2 text-sm font-semibold text-(--tanaw-green) transition hover:text-(--tanaw-green-dark)"
          >
            Contact support
            <ExternalLink className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </motion.form>

      {activeDialog === "recovery" ? <PasswordRecoveryDialog onClose={() => setActiveDialog(null)} /> : null}
      {activeDialog === "support" ? <SupportRequestDialog onClose={() => setActiveDialog(null)} /> : null}
    </div>
  );
}
