"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, type UpdateStatus } from "@/lib/api";

const UPDATE_POLL_MS = 15 * 60 * 1000;
const UPDATE_IN_PROGRESS_POLL_MS = 2000;

type UpdateStatusContextValue = {
  status: UpdateStatus | null;
  loading: boolean;
  checking: boolean;
  refresh: (force?: boolean) => Promise<UpdateStatus | null>;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
};

const UpdateStatusContext = createContext<UpdateStatusContextValue | null>(null);

export function UpdateStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const wasUpdatingRef = useRef(false);

  const refresh = useCallback(async (force = false): Promise<UpdateStatus | null> => {
    if (force) setChecking(true);

    try {
      const next = await api.checkForUpdates(force);
      setStatus(next);
      return next;
    } catch {
      return null;
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;
    let firstPoll = true;

    const poll = async () => {
      if (cancelled) return;

      let updating = wasUpdatingRef.current;

      if (updating) {
        try {
          const progressRes = await api.getUpdateProgress();
          updating = progressRes.updateInProgress;
          setStatus((prev) =>
            prev
              ? {
                  ...prev,
                  updateInProgress: progressRes.updateInProgress,
                  updateProgress: progressRes.progress,
                }
              : prev,
          );
          if (wasUpdatingRef.current && !updating) {
            await refresh(true);
          }
        } catch {
          // Server may be restarting — keep polling until it comes back.
        }
      } else {
        const next = await refresh(firstPoll);
        firstPoll = false;
        if (cancelled) return;

        updating = Boolean(next?.updateInProgress);
        if (updating) {
          setModalOpen(true);
        }
      }

      wasUpdatingRef.current = updating;
      const interval = updating ? UPDATE_IN_PROGRESS_POLL_MS : UPDATE_POLL_MS;
      timeout = setTimeout(poll, interval);
    };

    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [refresh]);

  const openModal = useCallback(() => setModalOpen(true), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  return (
    <UpdateStatusContext.Provider
      value={{
        status,
        loading,
        checking,
        refresh,
        modalOpen,
        openModal,
        closeModal,
      }}
    >
      {children}
    </UpdateStatusContext.Provider>
  );
}

export function useUpdateStatus() {
  const context = useContext(UpdateStatusContext);
  if (!context) {
    throw new Error("useUpdateStatus must be used within UpdateStatusProvider");
  }
  return context;
}
