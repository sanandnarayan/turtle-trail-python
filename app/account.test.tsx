// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { type ReactNode, useCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AccountControl,
  AccountProvider,
  type CourseProgress,
  useCourseProgressSync,
} from "./account";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });

function SyncHarness({ progress }: { progress: CourseProgress }) {
  const mergeRemoteProgress = useCallback(() => undefined, []);
  const syncStatus = useCourseProgressSync({
    course: "turtle-basics",
    hydrated: true,
    progress,
    mergeRemoteProgress,
  });
  return <AccountControl returnTo="/" syncStatus={syncStatus} />;
}

const TestAccount = ({ children }: { children: ReactNode }) => (
  <AccountProvider>{children}</AccountProvider>
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("course progress synchronization", () => {
  it("shows a paused badge after a failed save and retries the latest work on reconnect", async () => {
    const savedBodies: unknown[] = [];
    let failSave = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/auth/session") {
        return jsonResponse({ user: { id: "student-1", email: "learner@example.com" } });
      }
      if (url === "/api/progress/turtle-basics" && !init?.method) {
        return jsonResponse({ progress: null });
      }
      if (url === "/api/progress/turtle-basics" && init?.method === "PUT") {
        savedBodies.push(JSON.parse(String(init.body)) as unknown);
        if (failSave) throw new TypeError("offline");
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const initialProgress: CourseProgress = {
      completed: [],
      unlocked: 0,
      current: 0,
      drafts: {},
    };
    const { rerender } = render(
      <TestAccount><SyncHarness progress={initialProgress} /></TestAccount>,
    );

    await screen.findByText("Synced", {}, { timeout: 2500 });
    failSave = true;
    const offlineProgress: CourseProgress = {
      ...initialProgress,
      drafts: { "function-guided": "# my offline lesson work" },
    };
    rerender(<TestAccount><SyncHarness progress={offlineProgress} /></TestAccount>);

    const pausedBadge = await screen.findByText("Sync paused", {}, { timeout: 2500 });
    expect(pausedBadge.closest("button")?.getAttribute("aria-label")).toContain("Cloud sync paused");
    const attemptsBeforeReconnect = savedBodies.length;

    failSave = false;
    act(() => window.dispatchEvent(new Event("online")));

    await screen.findByText("Synced", {}, { timeout: 2500 });
    expect(savedBodies.length).toBeGreaterThan(attemptsBeforeReconnect);
    expect(savedBodies.at(-1)).toEqual({ progress: offlineProgress });
  }, 10_000);
});
