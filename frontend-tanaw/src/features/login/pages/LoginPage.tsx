import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/app/store/authStore";
import { getRoleDashboardPath } from "@/app/routers/roleRoutes";
import { AuthBrandHeader, AuthHero, AuthStageLayout, LoginForm, TwoFactorLoginForm } from "../components";
import { useLogin } from "../hooks";

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
  const { cancelTwoFactor, clearLoginMessage, clearTwoFactorMessage, handleLoginSubmit, lockoutSeconds, loginMessage, submitTwoFactor, twoFactorMessage, twoFactorPending } = useLogin();

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
    <AuthStageLayout
      showParticles
      panelClassName="tanaw-login-card"
      hero={
        <AuthHero
          icon={
            <span className="tanaw-sampaguita-glow inline-flex">
              <SampaguitaIcon className="h-8 w-8" />
            </span>
          }
          title="Welcome to San Pedro"
          copy="Your platform to manage tourism, empower enterprises, and build a thriving community."
        />
      }
    >
      <AuthBrandHeader subtitle="San Pedro Tourism Management" />
      <LoginForm authMessage={loginMessage} lockoutSeconds={lockoutSeconds} onAuthMessageClear={clearLoginMessage} onSubmit={handleLoginSubmit} hidden={twoFactorPending} />
      {twoFactorPending ? (
        <TwoFactorLoginForm
          message={twoFactorMessage}
          lockoutSeconds={lockoutSeconds}
          onSubmit={submitTwoFactor}
          onMessageClear={clearTwoFactorMessage}
          onBack={() => {
            cancelTwoFactor();
            window.requestAnimationFrame(() => document.getElementById("login-password")?.focus());
          }}
        />
      ) : null}
    </AuthStageLayout>
  );
}
