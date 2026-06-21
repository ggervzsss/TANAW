import { type CSSProperties, type ChangeEvent, type FormEvent, type PointerEvent, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, MapPin, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { routePaths } from "../../../app/router/routePaths";
import { cn } from "../../../utils/cn";
import { notifyError, notifySuccess } from "../../toasts/services/toast-service";
import { changePassword, logout as logoutRequest } from "../api/login";
import { useAuthStore } from "../stores/auth-store";

const cityHallImage = `${import.meta.env.BASE_URL}images/dsc00386.jpg`;
const citySeal = "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Seal_of_San_Pedro%2C_Laguna.png/1280px-Seal_of_San_Pedro%2C_Laguna.png";

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
];

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const setSession = useAuthStore((state) => state.setSession);
  const logout = useAuthStore((state) => state.logout);
  const [values, setValues] = useState<PasswordValues>(initialValues);
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [heroGlow, setHeroGlow] = useState({ x: 28, y: 72 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const renderedParticles = useMemo(() => particles, []);

  if (!user) {
    return <Navigate to={routePaths.login} replace />;
  }

  if (!user.mustChangePassword) {
    return <Navigate to={routePaths.enterpriseCameras} replace />;
  }

  const updateField = (field: keyof PasswordValues) => (event: ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  };

  const validate = () => {
    const nextErrors: PasswordErrors = {};

    if (!values.currentPassword.trim()) {
      nextErrors.currentPassword = "Current temporary password is required.";
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/.test(values.newPassword)) {
      nextErrors.newPassword =
        "Use 6+ characters with uppercase, lowercase, number, and special character.";
    }
    if (values.confirmPassword !== values.newPassword) {
      nextErrors.confirmPassword = "Passwords do not match.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleStagePointerMove = (event: PointerEvent<HTMLElement>) => {
    const bounds = stageRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    setHeroGlow({
      x: clampPercent(((event.clientX - bounds.left) / bounds.width) * 100),
      y: clampPercent(((event.clientY - bounds.top) / bounds.height) * 100),
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const session = await changePassword(values.currentPassword, values.newPassword);
      queryClient.removeQueries({ queryKey: ["enterprise-current-user"] });
      setSession(session);
      notifySuccess("Password updated.");
      navigate(routePaths.enterpriseCameras, { replace: true });
    } catch {
      notifyError("Unable to update password. Check the temporary password and try again.");
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
      className="tanaw-login-stage relative grid min-h-screen grid-cols-[minmax(0,1.04fr)_minmax(460px,0.72fr)] items-center gap-10 overflow-hidden bg-[var(--tanaw-bg)] px-10 py-8 text-(--tanaw-text)"
      onPointerMove={handleStagePointerMove}
      style={
        {
          "--hero-glow-x": `${heroGlow.x}%`,
          "--hero-glow-y": `${heroGlow.y}%`,
        } as CSSProperties
      }
    >
      <div className="tanaw-login-photo absolute inset-y-0 left-0 w-[82%]" style={{ backgroundImage: `url("${cityHallImage}")` }} aria-hidden="true" />
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

      <section className="relative z-10 flex min-h-[calc(100vh-4rem)] items-end overflow-visible px-2 pb-14 text-white">
        <motion.div className="relative z-10 max-w-xl" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, ease: "easeOut" }}>
          <div className="tanaw-sampaguita-glow mb-5 inline-flex text-[var(--tanaw-gold)]">
            <SampaguitaIcon className="h-8 w-8" />
          </div>
          <h1 className="font-display text-5xl leading-tight font-bold text-white drop-shadow-[0_10px_22px_rgba(0,0,0,0.28)]">Enterprise Portal</h1>
          <div className="tanaw-gold-shimmer mt-5 h-[3px] w-28 rounded-full bg-[var(--tanaw-gold)]" />
          <p className="mt-6 max-w-lg text-lg leading-8 font-medium text-white/95 drop-shadow-[0_8px_18px_rgba(0,0,0,0.25)]">
            Secure access for tourism enterprise reporting, camera monitoring, and operational compliance.
          </p>
          <div className="mt-10 flex items-center gap-3 text-xs font-bold tracking-[0.35em] text-white uppercase">
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
        className="relative z-10 ml-auto w-full max-w-[540px] rounded-[30px] border border-white/80 bg-white/96 p-10 shadow-[0_30px_90px_rgba(3,20,12,0.32)] ring-1 ring-black/[0.03] backdrop-blur-xl"
        onPointerMove={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleReturnToLogin}
          className="absolute top-5 left-5 rounded-full p-2 text-[var(--tanaw-muted)] transition hover:bg-emerald-50 hover:text-(--tanaw-green) focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-2 focus-visible:outline-none"
          aria-label="Return to login"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="mb-7 pt-4">
          <div className="flex items-center gap-6">
            <img src={citySeal} alt="City of San Pedro seal" className="h-20 w-20 object-contain drop-shadow-[0_12px_18px_rgba(3,61,36,0.08)]" />
            <div>
              <h2 className="font-display text-[2rem] leading-tight font-extrabold text-[var(--tanaw-green)]">TANAW PORTAL</h2>
              <p className="mt-2 text-base font-medium text-[var(--tanaw-muted)]">Enterprise Tourism Management</p>
            </div>
          </div>
          <div className="mt-8 flex items-center gap-3 text-[var(--tanaw-gold)]">
            <SampaguitaIcon className="h-4 w-4 flex-none" />
            <span className="tanaw-gold-shimmer h-px flex-1 bg-[var(--tanaw-gold)]/75" />
          </div>
        </div>

        <div className="mb-6 rounded-[24px] border border-amber-100 bg-amber-50 p-4">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm">
              <KeyRound size={18} />
            </span>
            <div>
              <p className="text-sm font-bold text-(--tanaw-text)">Temporary password verified</p>
              <h1 className="mt-1 font-display text-xl font-extrabold text-[var(--tanaw-green)]">Enterprise Password Reset</h1>
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

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-3 flex h-15 w-full items-center justify-center gap-4 rounded-xl bg-[linear-gradient(135deg,var(--tanaw-green)_0%,var(--tanaw-green-dark)_100%)] px-6 text-base font-semibold text-white shadow-[0_16px_30px_rgba(6,78,47,0.22)] transition hover:-translate-y-px hover:shadow-[0_18px_36px_rgba(6,78,47,0.28)] focus-visible:ring-2 focus-visible:ring-(--tanaw-green) focus-visible:ring-offset-4 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-75"
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
          "relative flex h-14 items-center rounded-xl border bg-white transition duration-200 focus-within:border-[var(--tanaw-green)] focus-within:shadow-[0_0_0_4px_rgba(6,78,47,0.13)]",
          error ? "border-[var(--tanaw-error)] shadow-[0_0_0_4px_rgba(220,38,38,0.08)]" : "border-[var(--tanaw-border)]",
        )}
      >
        <LockKeyhole className="pointer-events-none absolute left-5 h-5 w-5 text-[#7b8492]" strokeWidth={1.9} />
        <input
          name={name}
          type={showPassword ? "text" : "password"}
          minLength={autoComplete === "new-password" ? 6 : undefined}
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

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}
