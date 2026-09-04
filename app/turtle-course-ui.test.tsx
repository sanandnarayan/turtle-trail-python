// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountProvider } from "./account";
import { LESSONS, TurtleCourse } from "./turtle-course";

const STORAGE_KEY = "turtle-trail-progress-v1";
let remoteProgress: {
  completed: string[];
  unlocked: number;
  current: number;
  drafts: Record<string, string>;
} | null;

class WorkerMock {
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: (() => void) | null = null;

  constructor() {
    window.setTimeout(() => {
      this.onmessage?.({ data: { type: "status", status: "ready" } } as MessageEvent<unknown>);
    }, 0);
  }

  postMessage() {}
  terminate() {}
}

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });

const savedProgress = (current: number, overrides: Record<string, unknown> = {}) => ({
  completed: LESSONS.map((lesson) => lesson.id),
  unlocked: LESSONS.length - 1,
  current,
  drafts: {},
  variants: {},
  revealed: [],
  answers: {},
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  remoteProgress = null;
  vi.stubGlobal("Worker", WorkerMock);
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  Element.prototype.scrollIntoView = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/auth/session") {
      return jsonResponse({ user: { id: "student-1", email: "learner@example.com" } });
    }
    if (url === "/api/progress/turtle-basics" && !init?.method) {
      return jsonResponse({ progress: remoteProgress });
    }
    if (url === "/api/progress/turtle-basics" && init?.method === "PUT") {
      return jsonResponse({ ok: true });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Turtle Trail persisted interactions", () => {
  it("restores a quiz answer after refresh and includes later changes in autosave", async () => {
    const lessonIndex = LESSONS.findIndex((lesson) => lesson.id === "conditional-discover");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedProgress(lessonIndex, {
      answers: { "conditional-discover": "ready" },
    })));

    render(<AccountProvider><TurtleCourse /></AccountProvider>);

    const restoredAnswer = await screen.findByRole("radio", { name: "Ready!" });
    expect(restoredAnswer.getAttribute("aria-checked")).toBe("true");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Run Python" }).hasAttribute("disabled")).toBe(false);
    });

    fireEvent.click(screen.getByRole("radio", { name: "Keep practicing" }));
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as {
        answers?: Record<string, string>;
      };
      expect(saved.answers?.["conditional-discover"]).toBe("practice");
    });
  });

  it("restores a signed-in quiz answer from cloud progress", async () => {
    const lessonIndex = LESSONS.findIndex((lesson) => lesson.id === "conditional-discover");
    const local = savedProgress(lessonIndex);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    remoteProgress = {
      completed: local.completed,
      unlocked: local.unlocked,
      current: local.current,
      drafts: { "question-answer-conditional-discover": "ready" },
    };

    render(<AccountProvider><TurtleCourse /></AccountProvider>);

    const restoredAnswer = await screen.findByRole("radio", { name: "Ready!" });
    await waitFor(() => expect(restoredAnswer.getAttribute("aria-checked")).toBe("true"));
  });

  it("reveals the answer for a completed lesson and starts its fresh challenge", async () => {
    const lessonIndex = LESSONS.findIndex((lesson) => lesson.id === "function-independent");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedProgress(lessonIndex, {
      drafts: { "function-independent": "# stuck" },
    })));

    render(<AccountProvider><TurtleCourse /></AccountProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "Give me a hint" }));
    fireEvent.click(screen.getByRole("button", { name: "Give me another hint" }));
    fireEvent.click(screen.getByRole("button", { name: "Show answer and give me a fresh challenge" }));

    expect(await screen.findByText("Here is the answer you asked to see")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Start a fresh variant" }));

    expect(await screen.findByText(/Fresh variant active/)).toBeDefined();
    expect((screen.getByRole("textbox", { name: /Code editor for lesson 8d/ }) as HTMLTextAreaElement).value).toBe("");
  });
});
