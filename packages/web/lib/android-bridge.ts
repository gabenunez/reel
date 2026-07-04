export function notifyAndroidLogout() {
  if (typeof window === "undefined") return;
  window.ReelAndroid?.logout();
}

declare global {
  interface Window {
    ReelAndroid?: {
      logout: () => void;
    };
  }
}

export {};
