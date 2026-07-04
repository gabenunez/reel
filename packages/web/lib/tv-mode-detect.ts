export const TV_MODE_KEY = "media-client";
export const TV_MODE_VALUE = "android-tv";
export const TV_MODE_HTML_CLASS = "tv-mode";
export const TV_READY_HTML_CLASS = "tv-ready";
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

/** Runs in a blocking head script before first paint. */
export const TV_MODE_BOOTSTRAP_SCRIPT = `(function(){try{var k=${JSON.stringify(TV_MODE_KEY)},v=${JSON.stringify(TV_MODE_VALUE)},t=${JSON.stringify(TV_UA_TOKEN)},lt=${JSON.stringify(LEGACY_TV_UA_TOKEN)},c=${JSON.stringify(TV_MODE_HTML_CLASS)},r=${JSON.stringify(TV_READY_HTML_CLASS)};var p=new URLSearchParams(location.search);if(p.get("tv")==="1")sessionStorage.setItem(k,v);var ua=navigator.userAgent;if(sessionStorage.getItem(k)===v||ua.indexOf(t)!==-1||ua.indexOf(lt)!==-1)document.documentElement.classList.add(c);setTimeout(function(){document.documentElement.classList.add(r)},2500)}catch(e){}})();`;

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
