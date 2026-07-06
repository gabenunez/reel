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
import { reloadForFreshAssets } from "@/lib/stale-chunk-recovery";

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
  const cancelledRef = useRef(false);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runPollRef = useRef<() => Promise<void>>(async () => {});

  const schedulePoll = useCallback((delayMs: number) => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
    }
    pollTimeoutRef.current = setTimeout(() => {
      void runPollRef.current();
    }, delayMs);
  }, []);

  const refresh = useCallback(
    async (
      force = false,
      options: { reschedule?: boolean } = {},
    ): Promise<UpdateStatus | null> => {
      const { reschedule = true } = options;
      if (force) setChecking(true);

      try {
        const next = await api.checkForUpdates(force);
        setStatus(next);

        if (next?.updateInProgress) {
          wasUpdatingRef.current = true;
          setModalOpen(true);
          if (reschedule) {
            schedulePoll(0);
          }
        }

        return next;
      } catch {
        return null;
      } finally {
        setLoading(false);
        setChecking(false);
      }
    },
    [schedulePoll],
  );

  runPollRef.current = async () => {
    if (cancelledRef.current) return;

    if (wasUpdatingRef.current) {
      try {
        const progressRes = await api.getUpdateProgress();
        const stillUpdating = progressRes.updateInProgress;

        setStatus((prev) =>
          prev
            ? {
                ...prev,
                updateInProgress: stillUpdating,
                updateProgress: progressRes.progress,
              }
            : prev,
        );

        if (wasUpdatingRef.current && !stillUpdating) {
          wasUpdatingRef.current = false;
          await refresh(true, { reschedule: false });
          reloadForFreshAssets("server-update-complete");
          return;
        } else {
          wasUpdatingRef.current = stillUpdating;
        }
      } catch {
        // Server may be restarting — keep polling until it comes back.
      }

      if (!cancelledRef.current) {
        schedulePoll(
          wasUpdatingRef.current ? UPDATE_IN_PROGRESS_POLL_MS : UPDATE_POLL_MS,
        );
      }
      return;
    }

    const next = await refresh(false, { reschedule: false });
    if (cancelledRef.current) return;

    wasUpdatingRef.current = Boolean(next?.updateInProgress);
    if (next?.updateInProgress) {
      setModalOpen(true);
    }

    schedulePoll(
      wasUpdatingRef.current ? UPDATE_IN_PROGRESS_POLL_MS : UPDATE_POLL_MS,
    );
  };

  useEffect(() => {
    cancelledRef.current = false;

    void refresh(true, { reschedule: false }).then((next) => {
      if (cancelledRef.current) return;
      wasUpdatingRef.current = Boolean(next?.updateInProgress);
      schedulePoll(wasUpdatingRef.current ? 0 : UPDATE_POLL_MS);
    });

    return () => {
      cancelledRef.current = true;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, [refresh, schedulePoll]);

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
