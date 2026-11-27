import { type CSSProperties, type ChangeEvent, type FormEvent, type SyntheticEvent, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AlertCircle, ExternalLink, Eye, EyeOff, Headphones, LockKeyhole, MapPin, UserRound } from "lucide-react";
import { routePaths } from "../../../app/router/routePaths";
import { Button } from "../../../ui-kit";
import { PASSWORD_INPUT_MAX_CODE_UNITS } from "../../../utils/password-policy";
import { useAuthStageGlow } from "../hooks/use-auth-stage-glow";
import { useLogin } from "../hooks/use-login";
import { loginSchema, type LoginFormValues } from "../schemas/login-schema";
import { isRememberEnabled, useAuthStore } from "../stores/auth-store";
import { AuthActionTrail } from "./AuthActionTrail";
import { AuthThemeToggle } from "./AuthThemeToggle";
import { PasswordRecoveryDialog } from "./PasswordRecoveryDialog";
import { SupportRequestDialog } from "./SupportRequestDialog";
import { CITY_HALL_DAY_IMAGE, CITY_HALL_NIGHT_IMAGE } from "../utils/login-background-assets";
import { TANAW_LOGO } from "../../../lib/assets";
import "../login.css";

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

function CriticalLoginBackground({ onReady }: { onReady: () => void }) {
  const [isReady, setIsReady] = useState(false);
  const hasSignaledReady = useRef(false);
  const preparedThemes = useRef(new Set<string>());

  const markReady = () => {
    if (hasSignaledReady.current) return;
    hasSignaledReady.current = true;
    setIsReady(true);
    onReady();
  };

  const handleLoad = async (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    await image.decode().catch(() => undefined);
    markThemePrepared(image.dataset.authBackgroundTheme);
  };

  const handleError = (event: SyntheticEvent<HTMLImageElement>) => {
    markThemePrepared(event.currentTarget.dataset.authBackgroundTheme);
  };

  const markThemePrepared = (theme: string | undefined) => {
    if (theme) preparedThemes.current.add(theme);
    if (preparedThemes.current.size === 2) markReady();
  };

  return (
    <div className="tanaw-login-photo absolute inset-0 w-full" data-ready={isReady} aria-hidden="true">
      <img
        src={CITY_HALL_DAY_IMAGE}
        alt=""
        className="tanaw-login-photo__image tanaw-login-photo__image--day"
        data-auth-background-theme="light"
        decoding="sync"
        fetchPriority="high"
        loading="eager"
        onLoad={handleLoad}
        onError={handleError}
      />
      <img
        src={CITY_HALL_NIGHT_IMAGE}
        alt=""
        className="tanaw-login-photo__image tanaw-login-photo__image--night"
        data-auth-background-theme="dark"
        decoding="sync"
        fetchPriority="high"
        loading="eager"
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  );
}

const formatLockout = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function useStartupReveal() {
  const [isRevealed, setIsRevealed] = useState(() => !window.tanawStartup?.onRevealed);

  useEffect(() => {
    const subscribeToReveal = window.tanawStartup?.onRevealed;
    if (!subscribeToReveal) return undefined;
    return subscribeToReveal(() => setIsRevealed(true));
  }, []);

  return isRevealed;
}

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
  const [isBackgroundReady, setIsBackgroundReady] = useState(false);
  const isStartupRevealed = useStartupReveal();
  const shouldAnimateEntrance = isBackgroundReady && isStartupRevealed;

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
      className="tanaw-login-stage tanaw-auth-stage tanaw-auth-desktop-stage relative min-h-svh w-full bg-(--tanaw-bg) text-(--tanaw-text)"
      style={stageGlowStyle}
      data-auth-background-ready={isBackgroundReady}
      data-auth-entrance={shouldAnimateEntrance}
    >
      <CriticalLoginBackground onReady={() => setIsBackgroundReady(true)} />
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

      <div className="tanaw-auth-shell relative z-10">
        <section className="tanaw-auth-hero relative text-white">
          <div className="tanaw-auth-hero__inner">
            <div className="tanaw-auth-hero__icon tanaw-sampaguita-glow">
              <SampaguitaIcon className="h-8 w-8" />
            </div>
            <h1 className="tanaw-auth-hero-title">Enterprise Portal</h1>
            <span className="tanaw-auth-hero__mark" aria-hidden="true" />
            <p className="tanaw-auth-hero-copy">Secure access for tourism enterprise reporting, camera monitoring, and operational compliance.</p>
            <div className="tanaw-auth-hero-location">
              <MapPin className="h-4 w-4 flex-none" strokeWidth={2} aria-hidden="true" />
              <span>San Pedro, Laguna, Philippines</span>
            </div>
          </div>
        </section>

        <main className="tanaw-auth-main">
          <div className="tanaw-auth-card" onPointerMove={(event) => event.stopPropagation()}>
            <div className="tanaw-auth-card__body">
              <div className="tanaw-auth-card__content tanaw-auth-rise">
                <header className="tanaw-auth-card-header">
                  <img src={TANAW_LOGO} alt="" className="tanaw-auth-brand-logo" />
                  <div className="min-w-0">
                    <h2 className="tanaw-auth-brand-title">TANAW PORTAL</h2>
                    <p className="tanaw-auth-brand-subtitle">Enterprise Tourism Management</p>
                    <span className="tanaw-auth-civic-line" aria-hidden="true" />
                  </div>
                </header>

                <form onSubmit={handleSubmit} noValidate autoComplete="on">
                  <div className="tanaw-auth-field-group">
                    <label htmlFor="enterprise-login-identifier" className="tanaw-auth-label">
                      Username or email
                    </label>
                    <div className="tanaw-auth-field" data-state={errors.username ? "invalid" : values.username ? "valid" : "empty"}>
                      <UserRound className="tanaw-auth-field-icon pointer-events-none absolute left-4 h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
                      <input
                        id="enterprise-login-identifier"
                        name="username"
                        type="text"
                        autoComplete="username"
                        className="tanaw-auth-input h-full w-full rounded-tanaw-md bg-transparent pr-12 pl-12 text-[0.9375rem] outline-none"
                        placeholder="Enter username or registered email"
                        value={values.username}
                        onChange={updateField("username")}
                        disabled={loginMutation.isPending}
                        aria-invalid={Boolean(errors.username)}
                        aria-describedby={errors.username ? "enterprise-login-identifier-error" : undefined}
                      />
                      {errors.username ? <AlertCircle className="absolute right-4 h-5 w-5 text-(--tanaw-error)" strokeWidth={2.2} aria-hidden="true" /> : null}
                    </div>
                    <div id="enterprise-login-identifier-error" className="tanaw-auth-field-message" aria-live="polite">
                      {errors.username ? <p className="tanaw-auth-field-error">{errors.username}</p> : null}
                    </div>
                  </div>

                  <div className="tanaw-auth-field-group">
                    <label htmlFor="enterprise-login-password" className="tanaw-auth-label">
                      Password
                    </label>
                    <div className="tanaw-auth-field" data-state={errors.password ? "invalid" : values.password ? "valid" : "empty"}>
                      <LockKeyhole className="tanaw-auth-field-icon pointer-events-none absolute left-4 h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
                      <input
                        id="enterprise-login-password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        className="tanaw-auth-input h-full w-full rounded-tanaw-md bg-transparent pr-22 pl-12 text-[0.9375rem] outline-none"
                        placeholder="Enter your password"
                        value={values.password}
                        onChange={updateField("password")}
                        maxLength={PASSWORD_INPUT_MAX_CODE_UNITS}
                        disabled={loginMutation.isPending}
                        aria-invalid={Boolean(errors.password)}
                        aria-describedby={errors.password ? "enterprise-login-password-error" : undefined}
                      />
                      {errors.password ? <AlertCircle className="absolute right-12 h-5 w-5 text-(--tanaw-error)" strokeWidth={2.2} aria-hidden="true" /> : null}
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPassword((current) => !current)}
                        className="tanaw-auth-field-action absolute right-3"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff key="hide" className="h-5 w-5" strokeWidth={1.9} /> : <Eye key="show" className="h-5 w-5" strokeWidth={1.9} />}
                      </button>
                    </div>
                    <div id="enterprise-login-password-error" className="tanaw-auth-field-message" aria-live="polite">
                      {errors.password ? <p className="tanaw-auth-field-error">{errors.password}</p> : null}
                    </div>
                  </div>

                  <div className="tanaw-auth-control-gap flex items-center justify-between gap-4">
                    <label className="tanaw-auth-check">
                      <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
                      Remember me
                    </label>
                    <button type="button" onClick={() => setActiveDialog("recovery")} className="tanaw-auth-link">
                      Forgot password?
                    </button>
                  </div>

                  {authMessage ? (
                    <div className="tanaw-auth-alert mb-4" role="alert" aria-live="assertive">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-none" strokeWidth={2.2} aria-hidden="true" />
                      <span>{authMessage}</span>
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    disabled={loginMutation.isPending || loginMutation.lockoutSeconds > 0}
                    aria-busy={loginMutation.isPending || undefined}
                    size="lg"
                    fullWidth
                    className="tanaw-auth-primary-action tanaw-auth-sheen"
                    trailingIcon={<AuthActionTrail busy={loginMutation.isPending} />}
                  >
                    {loginMutation.lockoutSeconds > 0 ? `Try again in ${formatLockout(loginMutation.lockoutSeconds)}` : loginMutation.isPending ? "Signing in..." : "Sign in"}
                  </Button>

                  <div className="tanaw-auth-support-row">
                    <Headphones className="tanaw-auth-support-icon" strokeWidth={1.9} aria-hidden="true" />
                    <span className="tanaw-auth-support-row__text">
                      <span className="tanaw-auth-support-row__title">Need help signing in?</span>
                      <span className="tanaw-auth-support-row__copy">Contact our support team.</span>
                    </span>
                    <button type="button" onClick={() => setActiveDialog("support")} className="tanaw-auth-link tanaw-auth-support-row__action">
                      Contact support
                      <ExternalLink className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </main>
      </div>

      {activeDialog === "recovery" ? <PasswordRecoveryDialog onClose={() => setActiveDialog(null)} /> : null}
      {activeDialog === "support" ? <SupportRequestDialog onClose={() => setActiveDialog(null)} /> : null}
    </div>
  );
}
