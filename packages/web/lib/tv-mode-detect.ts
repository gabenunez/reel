export const TV_MODE_KEY = "media-client";
export const TV_MODE_VALUE = "android-tv";
export const TV_MODE_HTML_CLASS = "tv-mode";
export const TV_READY_HTML_CLASS = "tv-ready";
export const TV_4K_HTML_CLASS = "tv-4k";
export const TV_UA_TOKEN = "MediaAndroidTV";
export const LEGACY_TV_UA_TOKEN = "ReelAndroidTV";

export function isTvUserAgent(userAgent: string): boolean {
  return (
    userAgent.includes(TV_UA_TOKEN) || userAgent.includes(LEGACY_TV_UA_TOKEN)
  );
}

function readStoredTvMode(): boolean {
  if (typeof window === "undefined") return false;
  if (sessionStorage.getItem(TV_MODE_KEY) === TV_MODE_VALUE) return true;
  return isTvUserAgent(navigator.userAgent);
}

/** Inline in head before globals.css so TV clients never flash desktop while hydrating. */
export const TV_CRITICAL_CSS = `html.${TV_MODE_HTML_CLASS}:not(.${TV_READY_HTML_CLASS}) body{visibility:hidden!important}html.${TV_MODE_HTML_CLASS} [data-web-only]{display:none!important}`;

/** Runs in a blocking head script before first paint. */
export const TV_MODE_BOOTSTRAP_SCRIPT = `(function(){try{var k=${JSON.stringify(TV_MODE_KEY)},v=${JSON.stringify(TV_MODE_VALUE)},t=${JSON.stringify(TV_UA_TOKEN)},lt=${JSON.stringify(LEGACY_TV_UA_TOKEN)},c=${JSON.stringify(TV_MODE_HTML_CLASS)},r=${JSON.stringify(TV_READY_HTML_CLASS)},k4=${JSON.stringify(TV_4K_HTML_CLASS)};var p=new URLSearchParams(location.search);if(p.get("tv")==="1")sessionStorage.setItem(k,v);var ua=navigator.userAgent;var isTv=sessionStorage.getItem(k)===v||ua.indexOf(t)!==-1||ua.indexOf(lt)!==-1;if(isTv){document.documentElement.classList.add(c);var sm=Math.max(screen.width,screen.height),vm=Math.max(innerWidth,innerHeight),dpr=devicePixelRatio||1;if(sm>=3840||(sm>=2160&&dpr>=1.25)||(vm>=1920&&dpr>=1.5))document.documentElement.classList.add(k4)}setTimeout(function(){if(!document.documentElement.classList.contains(r))document.documentElement.classList.add(r)},15000)}catch(e){}})();`;

export function initTvMode(): boolean {
  if (typeof window === "undefined") return false;

  const params = new URLSearchParams(window.location.search);
  if (params.get("tv") === "1") {
    sessionStorage.setItem(TV_MODE_KEY, TV_MODE_VALUE);
    const url = new URL(window.location.href);
    url.searchParams.delete("tv");
    const next =
      url.pathname +
      (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") +
      url.hash;
    window.history.replaceState({}, "", next);
  }

  return readStoredTvMode();
}

export function isTvClient(): boolean {
  return readStoredTvMode();
}

/** Detect 4K TV panels for sharper assets and slightly larger 10-foot UI. */
export function initTv4KMode(): boolean {
  if (typeof window === "undefined" || !readStoredTvMode()) return false;

  const screenMax = Math.max(window.screen.width, window.screen.height);
  const viewportMax = Math.max(window.innerWidth, window.innerHeight);
  const dpr = window.devicePixelRatio || 1;

  const is4KPanel =
    screenMax >= 3840 ||
    (screenMax >= 2160 && dpr >= 1.25) ||
    (viewportMax >= 1920 && dpr >= 1.5);

  if (is4KPanel) {
    document.documentElement.classList.add(TV_4K_HTML_CLASS);
    return true;
  }

  document.documentElement.classList.remove(TV_4K_HTML_CLASS);
  return false;
}

export function isTv4KClient(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains(TV_4K_HTML_CLASS);
}
