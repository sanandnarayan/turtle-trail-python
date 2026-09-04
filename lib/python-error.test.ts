import { describe, expect, it } from "vitest";

import { sanitizePythonError } from "./python-error";

describe("sanitizePythonError", () => {
  it("removes Pyodide and parser frames before the actionable lesson syntax error", () => {
    const traceback = `Traceback (most recent call last):
  File "<exec>", line 109, in <module>
  File "/lib/python314.zip/ast.py", line 46, in parse
    return compile(source, filename, mode, flags)
  File "lesson.py", line 2
    turtle.forward(
                  ^
SyntaxError: '(' was never closed`;

    expect(sanitizePythonError(traceback)).toBe(`File "lesson.py", line 2
    turtle.forward(
                  ^
SyntaxError: '(' was never closed`);
  });

  it("preserves errors that do not contain a lesson frame", () => {
    expect(sanitizePythonError("Python could not start.")).toBe("Python could not start.");
  });
});
