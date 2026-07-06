"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import {
  TV_MODE_HTML_CLASS,
  TV_READY_HTML_CLASS,
  initTvMode,
  initTv4KMode,
} from "@/lib/tv-mode-detect";

export { initTvMode } from "@/lib/tv-mode-detect";

const TvModeContext = createContext(false);

function getInitialTvMode(): boolean {
  if (typeof window === "undefined") return false;
  if (document.documentElement.classList.contains(TV_MODE_HTML_CLASS)) {
    return true;
  }
  return initTvMode();
}

export function TvModeProvider({ children }: { children: ReactNode }) {
  const [isTvMode, setIsTvMode] = useState(getInitialTvMode);

  useLayoutEffect(() => {
    const tv = initTvMode();
    if (tv) {
      document.documentElement.classList.add(TV_MODE_HTML_CLASS);
      document.documentElement.classList.add(TV_READY_HTML_CLASS);
      initTv4KMode();
    } else {
      document.documentElement.classList.remove(TV_MODE_HTML_CLASS);
      document.documentElement.classList.remove(TV_READY_HTML_CLASS);
    }
    setIsTvMode(tv);
  }, []);

  return (
    <TvModeContext.Provider value={isTvMode}>{children}</TvModeContext.Provider>
  );
}

export function useTvMode(): boolean {
  return useContext(TvModeContext);
}
