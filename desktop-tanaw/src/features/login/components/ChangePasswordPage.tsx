import { type CSSProperties, type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, MapPin, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { routePaths } from "../../../app/router/routePaths";
import { cn } from "../../../utils/cn";
import { PASSWORD_MIN_LENGTH, validatePasswordPolicy } from "../../../utils/password-policy";
import { useAuthStageGlow } from "../hooks/use-auth-stage-glow";
import { notifySuccess } from "../../toasts/services/toast-service";
import { changePassword, logout as logoutRequest } from "../api/login";
import { useAuthStore } from "../stores/auth-store";
import { AuthThemeToggle } from "./AuthThemeToggle";

const cityHallDayImage = `${import.meta.env.BASE_URL}images/dsc00386.jpg`;
const cityHallNightImage = `${import.meta.env.BASE_URL}images/dsc00386-night.png`;
const citySeal = "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Seal_of_San_Pedro%2C_Laguna.png/1280px-Seal_of_San_Pedro%2C_Laguna.png";

const authBackgroundImageStyle = {
  "--tanaw-auth-day-image": `url("${cityHallDayImage}")`,
  "--tanaw-auth-night-image": `url("${cityHallNightImage}")`,
} as CSSProperties;

type PasswordValues = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type PasswordErrors = Partial<Record<keyof PasswordValues, string>>;

const initialValues: PasswordValues = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

const particles = [
  { left: "7%", top: "58%", size: 3, delay: "0s", duration: "12s" },
  { left: "18%", top: "51%", size: 2, delay: "2.6s", duration: "11s" },
  { left: "23%", top: "74%", size: 3, delay: "0.4s", duration: "14s" },
  { left: "31%", top: "61%", size: 4, delay: "3.2s", duration: "12.5s" },
  { left: "44%", top: "55%", size: 3, delay: "4.1s", duration: "13s" },
  { left: "15%", top: "84%", size: 2, delay: "5.8s", duration: "16s" },
  { left: "88%", top: "78%", size: 2, delay: "7.1s", duration: "14s" },
];

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const setSession = useAuthStore((state) => state.setSession);
  const logout = useAuthStore((state) => state.logout);
  const [values, setValues] = useState<PasswordValues>(initialValues);
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [formMessage, setFormMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { stageGlowStyle, stageRef } = useAuthStageGlow<HTMLDivElement>();
  const renderedParticles = useMemo(() => particles, []);

  if (!user) {
    return <Navigate to={routePaths.login} replace />;
  }

  if (!user.mustChangePassword) {
    return <Navigate to={routePaths.enterpriseDashboard} replace />;
  }

  const updateField = (field: keyof PasswordValues) => (event: ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    if (formMessage) setFormMessage("");
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  };

  const validate = () => {
    const nextErrors: PasswordErrors = {};

    if (!values.currentPassword.trim()) {
      nextErrors.currentPassword = "Current temporary password is required.";
    }
    const policyError = validatePasswordPolicy(values.newPassword);
    if (policyError) nextErrors.newPassword = policyError;
    if (values.confirmPassword !== values.newPassword) {
      nextErrors.confirmPassword = "Passwords do not match.";
    }

    setErrors(nextErrors);
    setFormMessage("");
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!validate()) {
      setFormMessage("Review the password fields and try again.");
      return;
    }

    setIsSubmitting(true);
    try {
      const session = await changePassword(values.currentPassword, values.newPassword);
      queryClient.removeQueries({ queryKey: ["enterprise-current-user"] });
      setSession(session);
      notifySuccess("Password updated.");
      navigate(routePaths.enterpriseDashboard, { replace: true });
    } catch {
      setFormMessage("Unable to update password. Check the temporary password and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReturnToLogin = async () => {
    try {
      await logoutRequest();
    } finally {
      queryClient.removeQueries({ queryKey: ["enterprise-current-user"] });
      logout();
    }
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
        {renderedParticles.map((particle, index) => (
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
        className="tanaw-auth-card relative z-10 ml-auto w-full max-w-135 rounded-[30px] border border-white/80 bg-white/96 p-8 shadow-[0_30px_90px_rgba(3,20,12,0.32)] ring-1 ring-black/3 backdrop-blur-xl xl:p-10"
        onPointerMove={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleReturnToLogin}
          className="absolute top-5 left-5 rounded-full p-2 text-(--tanaw-muted) transition hover:bg-emerald-50 hover:text-(--tanaw-green) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none"
          aria-label="Return to login"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="tanaw-auth-reset-header mb-7 pt-4">
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

        <div className="tanaw-auth-reset-callout mb-6 rounded-3xl border border-amber-100 bg-amber-50 p-4">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
              <KeyRound size={18} />
            </span>
            <div>
              <p className="text-sm font-bold text-(--tanaw-text)">Temporary password verified</p>
              <h1 className="font-display mt-1 text-xl font-extrabold text-(--tanaw-green)">Enterprise Password Reset</h1>
              <p className="mt-1 text-sm leading-6 font-medium text-amber-800">Set a private password before accessing the Enterprise Desktop workspace.</p>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <PasswordField
            autoComplete="current-password"
            error={errors.currentPassword}
            label="Current Temporary Password"
            name="currentPassword"
            onChange={updateField("currentPassword")}
            value={values.currentPassword}
          />
          <PasswordField autoComplete="new-password" error={errors.newPassword} label="New Password" name="newPassword" onChange={updateField("newPassword")} value={values.newPassword} />
          <PasswordField
            autoComplete="new-password"
            error={errors.confirmPassword}
            label="Confirm New Password"
            name="confirmPassword"
            onChange={updateField("confirmPassword")}
            value={values.confirmPassword}
          />

          {formMessage ? (
            <div className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700" role="alert" aria-live="assertive">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none" strokeWidth={2.2} aria-hidden="true" />
              <span>{formMessage}</span>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="tanaw-auth-primary-action mt-3 flex h-15 w-full items-center justify-center gap-4 rounded-xl bg-[linear-gradient(135deg,var(--tanaw-green)_0%,var(--tanaw-green-dark)_100%)] px-6 text-base font-semibold text-white shadow-[0_16px_30px_rgba(6,78,47,0.22)] transition hover:-translate-y-px hover:shadow-[0_18px_36px_rgba(6,78,47,0.28)] focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-4 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-75"
          >
            <ShieldCheck className="h-5 w-5" strokeWidth={2} />
            {isSubmitting ? "Updating..." : "Update Password"}
            <ArrowRight className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
      </motion.form>
    </div>
  );
}

function PasswordField({
  autoComplete,
  error,
  label,
  name,
  onChange,
  value,
}: {
  autoComplete: "current-password" | "new-password";
  error?: string;
  label: string;
  name: keyof PasswordValues;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  value: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const errorId = `desktop-${name}-error`;

  return (
    <label className="mb-3 block">
      <span className="mb-2 block text-sm font-semibold text-(--tanaw-text)">{label}</span>
      <div
        className={cn(
          "tanaw-auth-field relative flex h-14 items-center rounded-xl border bg-white transition duration-200 focus-within:border-(--tanaw-green) focus-within:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]",
          error ? "border-(--tanaw-error) shadow-[0_0_0_4px_rgba(220,38,38,0.08)]" : "border-(--tanaw-border)",
        )}
      >
        <LockKeyhole className="pointer-events-none absolute left-5 h-5 w-5 text-[#7b8492]" strokeWidth={1.9} />
        <input
          name={name}
          type={showPassword ? "text" : "password"}
          minLength={autoComplete === "new-password" ? PASSWORD_MIN_LENGTH : undefined}
          required
          className="h-full w-full rounded-xl bg-transparent px-14 pr-24 text-[15px] font-medium text-(--tanaw-text) outline-none placeholder:text-[#8b93a1]"
          value={value}
          onChange={onChange}
          placeholder={label}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
        />
        {error ? <AlertCircle className="absolute right-12 h-5 w-5 text-(--tanaw-error)" strokeWidth={2.2} aria-hidden="true" /> : null}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShowPassword((current) => !current)}
          className="absolute right-4 rounded-full p-1 text-[#7b8492] transition hover:text-(--tanaw-green) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none"
          aria-label={showPassword ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {showPassword ? <EyeOff className="h-5 w-5" strokeWidth={1.9} /> : <Eye className="h-5 w-5" strokeWidth={1.9} />}
        </button>
      </div>
      <div id={errorId} className="mt-1 min-h-4" aria-live="polite">
        {error ? <span className="text-xs font-medium text-(--tanaw-error)">{error}</span> : null}
      </div>
    </label>
  );
}

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
