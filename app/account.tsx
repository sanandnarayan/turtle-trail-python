"use client";

import {
  Check,
  Cloud,
  CloudOff,
  LoaderCircle,
  LogOut,
  Mail,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type AccountUser = {
  id: string;
  email: string;
};

type AccountContextValue = {
  user: AccountUser | null;
  sessionStatus: "loading" | "ready" | "error";
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
};

export type CourseProgress = {
  completed: string[];
  unlocked: number;
  current: number;
  drafts: Record<string, string>;
};

export type ProgressSyncStatus =
  | "local"
  | "loading"
  | "saving"
  | "saved"
  | "error";

const AccountContext = createContext<AccountContextValue | null>(null);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isAccountUser = (value: unknown): value is AccountUser =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.email === "string";

const isCourseProgress = (value: unknown): value is CourseProgress =>
  isRecord(value) &&
  Array.isArray(value.completed) &&
  value.completed.every((id) => typeof id === "string") &&
  typeof value.unlocked === "number" &&
  Number.isInteger(value.unlocked) &&
  typeof value.current === "number" &&
  Number.isInteger(value.current) &&
  isRecord(value.drafts) &&
  Object.values(value.drafts).every((draft) => typeof draft === "string");

export function AccountProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [sessionStatus, setSessionStatus] = useState<"loading" | "ready" | "error">("loading");

  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Session request failed");
      const body: unknown = await response.json();
      const nextUser = isRecord(body) && isAccountUser(body.user) ? body.user : null;
      setUser((currentUser) =>
        currentUser?.id === nextUser?.id && currentUser?.email === nextUser?.email
          ? currentUser
          : nextUser,
      );
      setSessionStatus("ready");
    } catch {
      setUser(null);
      setSessionStatus("error");
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refreshSession(), 0);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshSession();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshSession]);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // The local account state should still reset if the network is unavailable.
    } finally {
      setUser(null);
      setSessionStatus("ready");
    }
  }, []);

  const value = useMemo(
    () => ({ user, sessionStatus, refreshSession, signOut }),
    [refreshSession, sessionStatus, signOut, user],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export const useAccount = () => {
  const account = useContext(AccountContext);
  if (!account) throw new Error("useAccount must be used inside AccountProvider");
  return account;
};

const syncCopy: Record<ProgressSyncStatus, string> = {
  local: "Autosaved on this device",
  loading: "Loading saved work…",
  saving: "Autosaving answers…",
  saved: "All changes autosaved",
  error: "Cloud sync paused",
};

const syncBadgeCopy: Record<ProgressSyncStatus, string> = {
  local: "Autosave on",
  loading: "Loading…",
  saving: "Saving…",
  saved: "Synced",
  error: "Sync paused",
};

const SyncIcon = ({ status }: { status: ProgressSyncStatus }) => {
  if (status === "loading" || status === "saving") {
    return <LoaderCircle className="account-spinner" aria-hidden="true" />;
  }
  if (status === "error") return <CloudOff aria-hidden="true" />;
  if (status === "saved") return <Check aria-hidden="true" />;
  return <Save aria-hidden="true" />;
};

export function AccountControl({
  returnTo,
  syncStatus,
  celebrateFirstLesson = false,
  openRequest = 0,
}: {
  returnTo: "/" | "/clock";
  syncStatus: ProgressSyncStatus;
  celebrateFirstLesson?: boolean;
  openRequest?: number;
}) {
  const { user, sessionStatus, signOut } = useAccount();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const handledOpenRequestRef = useRef(0);

  const closeDialog = useCallback(() => {
    setOpen(false);
    setError("");
    setSent(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (
      openRequest <= handledOpenRequestRef.current ||
      sessionStatus === "loading"
    ) {
      return;
    }
    const promptTimer = window.setTimeout(() => {
      handledOpenRequestRef.current = openRequest;
      if (!user) setOpen(true);
    }, 0);
    return () => window.clearTimeout(promptTimer);
  }, [openRequest, sessionStatus, user]);

  useEffect(() => {
    if (!open) return;
    const main = document.querySelector("main");
    const previousOverflow = document.body.style.overflow;
    if (main instanceof HTMLElement) main.inert = true;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => {
      (user ? closeRef.current : emailRef.current)?.focus();
    }, 0);
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeDialog();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
      if (main instanceof HTMLElement) main.inert = false;
      document.body.style.overflow = previousOverflow;
    };
  }, [closeDialog, open, user]);

  const requestLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/request", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, returnTo }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = isRecord(body) && typeof body.error === "string"
          ? body.error
          : "The sign-in link could not be sent.";
        throw new Error(message);
      }
      setSent(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Please try again.");
    } finally {
      setSending(false);
    }
  };

  const finishSignOut = async () => {
    await signOut();
    localStorage.removeItem("turtle-trail-progress-v1");
    localStorage.removeItem("turtle-clock-quest-progress-v1");
    window.location.assign(returnTo);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`course-link account-button ${user ? `signed-in sync-${syncStatus}` : ""}`}
        onClick={() => setOpen(true)}
        disabled={sessionStatus === "loading"}
        aria-label={user ? `Account for ${user.email}. ${syncCopy[syncStatus]}` : celebrateFirstLesson ? "Sign in to continue to lesson 2" : "Progress is autosaved on this device. Sign in for cloud sync"}
      >
        {user ? <SyncIcon status={syncStatus} /> : <Save aria-hidden="true" />}
        <span>{sessionStatus === "loading" ? "Checking…" : user ? syncBadgeCopy[syncStatus] : celebrateFirstLesson ? "Sign in to continue" : "Autosave on"}</span>
      </button>

      {open && createPortal(
        <div className="account-dialog-backdrop" onMouseDown={closeDialog}>
          <section
            className="account-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button ref={closeRef} type="button" className="account-dialog-close" onClick={closeDialog} aria-label="Close account dialog">
              <X />
            </button>

            {user ? (
              <>
                <span className="account-dialog-icon synced"><Cloud /></span>
                <p className="account-eyebrow">Progress account</p>
                <h2 id="account-dialog-title">Your Python work is safe</h2>
                <p className="account-description">
                  Lesson answers and progress autosave whenever they change.
                </p>
                <div className="account-email">{user.email}</div>
                <div className={`account-sync-state ${syncStatus}`} role="status">
                  <SyncIcon status={syncStatus} />
                  <span>{syncCopy[syncStatus]}</span>
                </div>
                <button type="button" className="account-secondary-button" onClick={() => void finishSignOut()}>
                  <LogOut /> Sign out
                </button>
              </>
            ) : sent ? (
              <>
                <span className="account-dialog-icon sent"><Mail /></span>
                <p className="account-eyebrow">{celebrateFirstLesson ? "Great teamwork!" : "Almost there"}</p>
                <h2 id="account-dialog-title">Check your email</h2>
                <p className="account-description">
                  Open the one-time link sent to <strong>{email}</strong>. It expires in 15 minutes.
                </p>
                <p className="account-local-note">This tab can stay open. It will notice when you sign in.</p>
                <button type="button" className="account-primary-button" onClick={closeDialog}>Done</button>
              </>
            ) : (
              <>
                <span className={`account-dialog-icon ${celebrateFirstLesson ? "first-win" : ""}`}>
                  {celebrateFirstLesson ? <Sparkles /> : <Save />}
                </span>
                <p className="account-eyebrow">
                  {celebrateFirstLesson ? "First lesson complete!" : "Free progress sync"}
                </p>
                <h2 id="account-dialog-title">
                  {celebrateFirstLesson ? "Brilliant start—save your trail" : "Save every Python answer"}
                </h2>
                <p className="account-description">
                  {celebrateFirstLesson
                    ? "Enter your email to keep your Python wins safe. We’ll send one sign-in link—no password needed."
                    : "Enter an email and we’ll send a one-time sign-in link. No password needed."}
                </p>
                <form className="account-form" onSubmit={requestLink}>
                  <label htmlFor="account-email">Email address</label>
                  <input
                    ref={emailRef}
                    id="account-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    maxLength={254}
                    required
                    autoFocus
                  />
                  {error && <p className="account-error" role="alert">{error}</p>}
                  <button type="submit" className="account-primary-button" disabled={sending}>
                    {sending
                      ? <><LoaderCircle className="account-spinner" /> Sending…</>
                      : <><Mail /> {celebrateFirstLesson ? "Save my Python trail" : "Email my sign-in link"}</>}
                  </button>
                </form>
                <p className="account-local-note">
                  Your work is already autosaved on this device. Lesson 2 unlocks after you open the email link and sign in.
                </p>
              </>
            )}
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}

export function useCourseProgressSync({
  course,
  hydrated,
  progress,
  mergeRemoteProgress,
}: {
  course: "turtle-basics" | "clock-quest";
  hydrated: boolean;
  progress: CourseProgress;
  mergeRemoteProgress: (remote: CourseProgress) => void;
}) {
  const { user, sessionStatus, refreshSession } = useAccount();
  const [syncStatus, setSyncStatus] = useState<ProgressSyncStatus>("local");
  const [readyUserId, setReadyUserId] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const userId = user?.id ?? null;
  const serializedProgress = useMemo(() => JSON.stringify(progress), [progress]);

  useEffect(() => {
    const retryWhenOnline = () => setRetryToken((token) => token + 1);
    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, []);

  useEffect(() => {
    if (!hydrated || sessionStatus === "loading") return;
    if (!userId) return;

    const controller = new AbortController();
    const loadingTimer = window.setTimeout(() => {
      setReadyUserId(null);
      setSyncStatus("loading");
    }, 0);
    void fetch(`/api/progress/${course}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        window.clearTimeout(loadingTimer);
        if (response.status === 401) {
          await refreshSession();
          throw new Error("Session expired");
        }
        if (!response.ok) throw new Error("Progress could not be loaded");
        const body: unknown = await response.json();
        if (isRecord(body) && isCourseProgress(body.progress)) {
          mergeRemoteProgress(body.progress);
        }
        setReadyUserId(userId);
        setSyncStatus("saving");
      })
      .catch((loadError: unknown) => {
        window.clearTimeout(loadingTimer);
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setSyncStatus("error");
      });
    return () => {
      window.clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [course, hydrated, mergeRemoteProgress, refreshSession, retryToken, sessionStatus, userId]);

  useEffect(() => {
    if (!hydrated || !userId || readyUserId !== userId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSyncStatus("saving");
      void fetch(`/api/progress/${course}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ progress: JSON.parse(serializedProgress) as unknown }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (response.status === 401) await refreshSession();
          if (!response.ok) throw new Error("Progress could not be saved");
          setSyncStatus("saved");
        })
        .catch((saveError: unknown) => {
          if (saveError instanceof DOMException && saveError.name === "AbortError") return;
          setSyncStatus("error");
        });
    }, 900);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [course, hydrated, readyUserId, refreshSession, retryToken, serializedProgress, userId]);

  if (!userId) return sessionStatus === "error" ? "error" : "local";
  return syncStatus;
}
