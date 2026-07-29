import { useRef, useState, type SyntheticEvent } from "react";
import { SAN_PEDRO_GATEWAY_IMAGE, SAN_PEDRO_GATEWAY_NIGHT_IMAGE } from "../utils/loginAssets";

type LoginBackgroundProps = {
  className?: string;
  onReady: () => void;
};

export function LoginBackground({ className = "", onReady }: LoginBackgroundProps) {
  const [isReady, setIsReady] = useState(false);
  const hasSignaledReady = useRef(false);
  const preparedThemes = useRef(new Set<string>());

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

  const markReady = () => {
    if (hasSignaledReady.current) return;
    hasSignaledReady.current = true;
    setIsReady(true);
    onReady();
  };

  return (
    <div className={`tanaw-login-photo ${className}`} data-ready={isReady} aria-hidden="true">
      <img
        src={SAN_PEDRO_GATEWAY_IMAGE}
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
        src={SAN_PEDRO_GATEWAY_NIGHT_IMAGE}
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
