import { describe, expect, it } from "vitest";

import {
  LESSONS,
  type ChallengeVariant,
  type RunResult,
} from "./turtle-course";

const line = (x1: number, y1: number, x2: number, y2: number) => ({
  type: "line" as const,
  x1,
  y1,
  x2,
  y2,
  color: "#173f5f",
  width: 4,
});

const polygon = (sides: number, length: number, direction: 1 | -1 = -1) => {
  let x = 0;
  let y = 0;
  return Array.from({ length: sides }, (_, index) => {
    const angle = direction * index * 2 * Math.PI / sides;
    const nextX = x + Math.cos(angle) * length;
    const nextY = y + Math.sin(angle) * length;
    const side = line(x, y, nextX, nextY);
    x = nextX;
    y = nextY;
    return side;
  });
};

const runResult = (overrides: Partial<RunResult> = {}): RunResult => ({
  commands: [],
  output: "",
  error: null,
  globals: {},
  functions: [],
  modules: [],
  syntax: [],
  state: {
    x: 0,
    y: 0,
    heading: 0,
    color: "#173f5f",
    width: 4,
  },
  ...overrides,
  analysis: {
    calls: [],
    callSites: [],
    executedCalls: [],
    forLoops: [],
    functionDefs: [],
    ...overrides.analysis,
  },
});

const lesson = (number: number | string) => {
  const found = LESSONS.find((item) => item.number === number);
  if (!found) throw new Error(`Lesson ${number} not found`);
  return found;
};

const primaryVariant = (number: number | string): ChallengeVariant | undefined =>
  lesson(number).variants?.[0];

const check = (
  number: number | string,
  result: RunResult,
  code: string,
  variant = primaryVariant(number),
) => lesson(number).check(result, code, variant);

const executedCall = (
  id: number,
  site: number,
  name: string,
  args: RunResult["analysis"]["executedCalls"][number]["arguments"],
  options: {
    module?: string;
    sources?: Array<number | null>;
    resultSource?: number | null;
  } = {},
): RunResult["analysis"]["executedCalls"][number] => ({
  id,
  site,
  name,
  module: options.module ?? "__main__",
  arguments: args,
  argumentSources: options.sources ?? args.map(() => null),
  resultSource: options.resultSource ?? null,
});

describe("Turtle Trail validator regressions", () => {
  it("accepts Lesson 4F squares without an unstated side length", () => {
    const code = `for side in range(4):\n    forward(100)\n    right(90)`;
    const result = runResult({
      commands: polygon(4, 100),
      syntax: ["For"],
      analysis: {
        calls: ["range", "forward", "right"],
        callSites: [],
        executedCalls: [],
        forLoops: [{
          target: "side",
          iterator: "range",
          iterable: "range",
          arguments: [4],
          calls: ["forward", "right"],
        }],
        functionDefs: [],
      },
    });

    expect(check("4f", result, code).passed).toBe(true);
  });

  it("accepts Lesson 4F squares drawn from an equivalent four-item iterable", () => {
    const code = `for side in [1, 2, 3, 4]:\n    forward(80)\n    right(90)`;
    const result = runResult({
      commands: polygon(4, 80),
      syntax: ["For", "List"],
      analysis: {
        calls: ["forward", "right"],
        callSites: [],
        executedCalls: [],
        forLoops: [{
          target: "side",
          iterator: null,
          iterable: null,
          arguments: [],
          calls: ["forward", "right"],
        }],
        functionDefs: [],
      },
    });

    expect(check("4f", result, code).passed).toBe(true);
  });

  it("accepts a parenthesized function call in Lesson 8C", () => {
    const code = `import turtle\n\ndef draw_triangle():\n    for side in range(3):\n        turtle.forward(90)\n        turtle.left(120)\n\n(draw_triangle)()`;
    const result = runResult({
      commands: polygon(3, 90, 1),
      functions: ["draw_triangle"],
      analysis: {
        calls: ["range", "turtle.forward", "turtle.left", "draw_triangle"],
        callSites: [],
        executedCalls: [executedCall(0, 3, "draw_triangle", [])],
        forLoops: [],
        functionDefs: [],
      },
    });

    expect(check("8c", result, code).passed).toBe(true);
  });

  it("accepts an evaluated arithmetic argument in Lesson 9C", () => {
    const code = `import turtle\n\ndef draw_square(size):\n    for side in range(4):\n        turtle.forward(size)\n        turtle.left(90)\n\ndraw_square(55 * 2)`;
    const forwardCalls = Array.from({ length: 4 }, (_, id) =>
      executedCall(id, 0, "forward", [110]));
    const result = runResult({
      commands: polygon(4, 110, 1),
      functions: ["draw_square"],
      analysis: {
        calls: ["range", "turtle.forward", "turtle.left", "draw_square"],
        callSites: [{
          id: 0,
          name: "turtle.forward",
          scope: "draw_square",
          assignedNames: [],
          argumentNames: [["size"]],
          argumentCalls: [null],
        }],
        executedCalls: [...forwardCalls, executedCall(4, 3, "draw_square", [110])],
        forLoops: [],
        functionDefs: [{
          name: "draw_square",
          parameters: ["size"],
          calls: ["range", "turtle.forward", "turtle.left"],
        }],
      },
    });

    expect(check("9c", result, code).passed).toBe(true);
  });

  it("does not let inert source text satisfy Lesson 9C", () => {
    const code = `import turtle\n\ndef draw_square(size):\n    for side in range(4):\n        turtle.forward(110)\n        turtle.left(90)\n\ndraw_square(40)\n'''\ndraw_square(110)\n'''`;
    const result = runResult({
      commands: polygon(4, 110, 1),
      functions: ["draw_square"],
      analysis: {
        calls: ["range", "turtle.forward", "turtle.left", "draw_square"],
        callSites: [{
          id: 0,
          name: "turtle.forward",
          scope: "draw_square",
          assignedNames: [],
          argumentNames: [[]],
          argumentCalls: [null],
        }],
        executedCalls: [
          ...Array.from({ length: 4 }, (_, id) => executedCall(id, 0, "forward", [110])),
          executedCall(4, 3, "draw_square", [40]),
        ],
        forLoops: [],
        functionDefs: [{
          name: "draw_square",
          parameters: ["size"],
          calls: ["range", "turtle.forward", "turtle.left"],
        }],
      },
    });

    expect(check("9c", result, code).passed).toBe(false);
  });

  it("accepts math.sqrt data flow through a variable in Lesson 11D", () => {
    const code = `import math\n\nanswer = math.sqrt(144)\nprint(answer)`;
    const result = runResult({
      output: "12.0\n",
      modules: ["math"],
      analysis: {
        calls: ["math.sqrt", "print"],
        callSites: [
          {
            id: 0,
            name: "math.sqrt",
            scope: null,
            assignedNames: ["answer"],
            argumentNames: [[]],
            argumentCalls: [null],
          },
          {
            id: 1,
            name: "print",
            scope: null,
            assignedNames: [],
            argumentNames: [["answer"]],
            argumentCalls: [null],
          },
        ],
        executedCalls: [
          executedCall(0, 0, "sqrt", [144], { module: "math" }),
          executedCall(1, 1, "print", [12], { module: "builtins", sources: [0] }),
        ],
        forLoops: [],
        functionDefs: [],
      },
    });

    expect(check("11d", result, code).passed).toBe(true);
  });

  it("accepts random.choice data flow through a variable in Lesson 11E", () => {
    const code = `import random\n\nrandom.seed(4)\nchoice = random.choice(['sun', 'moon', 'star'])\nprint(choice)`;
    const choices = ["sun", "moon", "star"];
    const result = runResult({
      output: "sun\n",
      modules: ["random"],
      syntax: ["List"],
      analysis: {
        calls: ["random.seed", "random.choice", "print"],
        callSites: [
          {
            id: 1,
            name: "random.choice",
            scope: null,
            assignedNames: ["choice"],
            argumentNames: [[]],
            argumentCalls: [null],
          },
          {
            id: 2,
            name: "print",
            scope: null,
            assignedNames: [],
            argumentNames: [["choice"]],
            argumentCalls: [null],
          },
        ],
        executedCalls: [
          executedCall(0, 0, "seed", [4], { module: "random" }),
          executedCall(1, 1, "choice", [choices], { module: "random" }),
          executedCall(2, 2, "print", ["sun"], { module: "builtins", sources: [1] }),
        ],
        forLoops: [],
        functionDefs: [],
      },
    });

    expect(check("11e", result, code).passed).toBe(true);
  });

  it("accepts split forward movement while rejecting wrong direction and distance", () => {
    const split100 = runResult({
      commands: [line(0, 0, 50, 0), line(50, 0, 100, 0)],
      modules: ["turtle"],
      analysis: {
        calls: ["turtle.forward", "turtle.forward"],
        callSites: [],
        executedCalls: [
          executedCall(0, 0, "forward", [50]),
          executedCall(1, 1, "forward", [50]),
        ],
        forLoops: [],
        functionDefs: [],
      },
      state: { x: 100, y: 0, heading: 0, color: "#173f5f", width: 4 },
    });
    const split120 = runResult({
      ...split100,
      commands: [line(0, 0, 60, 0), line(60, 0, 120, 0)],
      analysis: {
        ...split100.analysis,
        executedCalls: [
          executedCall(0, 0, "forward", [60]),
          executedCall(1, 1, "forward", [60]),
        ],
      },
      state: { ...split100.state, x: 120 },
    });
    const backward = runResult({
      commands: [line(0, 0, -120, 0)],
      analysis: {
        calls: ["turtle.backward"],
        callSites: [],
        executedCalls: [executedCall(0, 0, "backward", [120])],
        forLoops: [],
        functionDefs: [],
      },
      state: { ...split100.state, x: -120 },
    });
    const short = runResult({
      commands: [line(0, 0, 117, 0)],
      analysis: {
        calls: ["turtle.forward"],
        callSites: [],
        executedCalls: [executedCall(0, 0, "forward", [117])],
        forLoops: [],
        functionDefs: [],
      },
      state: { ...split100.state, x: 117 },
    });

    expect(check(1, split100, "").passed).toBe(true);
    expect(check(2, split120, "").passed).toBe(true);
    expect(check(2, backward, "").passed).toBe(false);
    expect(check(2, short, "").passed).toBe(false);
  });

  it("requires both Lesson 3 movements to read distance", () => {
    const commands = [line(0, 0, 100, 0), line(100, 0, 100, 100)];
    const base = runResult({
      commands,
      globals: { distance: 100 },
      analysis: {
        calls: ["turtle.forward", "turtle.left", "turtle.forward"],
        callSites: [0, 1].map((id) => ({
          id,
          name: "turtle.forward",
          scope: null,
          assignedNames: [],
          argumentNames: [["distance"]],
          argumentCalls: [null],
        })),
        executedCalls: [
          executedCall(0, 0, "forward", [100]),
          executedCall(1, 1, "forward", [100]),
        ],
        forLoops: [],
        functionDefs: [],
      },
    });
    const bypass = runResult({
      ...base,
      analysis: {
        ...base.analysis,
        callSites: base.analysis.callSites.map((site) => ({ ...site, argumentNames: [[]] })),
      },
    });

    expect(check(3, base, "").passed).toBe(true);
    expect(check(3, bypass, "").passed).toBe(false);
  });

  it("requires Lesson 11F right turns to use the positive calculated value", () => {
    const degreeCall = executedCall(0, 0, "degrees", [2 * Math.PI / 5], { module: "math" });
    const result = (angle: number, source: number | null, direction: 1 | -1) => runResult({
      commands: polygon(5, 60, direction),
      modules: ["math"],
      syntax: ["For"],
      analysis: {
        calls: ["math.degrees", "range", "forward", "right"],
        callSites: [],
        executedCalls: [
          degreeCall,
          ...Array.from({ length: 5 }, (_, index) =>
            executedCall(index + 1, 2, "right", [angle], { sources: [source] })),
        ],
        forLoops: [],
        functionDefs: [],
      },
    });

    expect(check("11f", result(72, 0, -1), "").passed).toBe(true);
    expect(check("11f", result(-72, null, 1), "").passed).toBe(false);
  });

  it("does not accept Lesson 11E output disconnected from random.choice", () => {
    const result = runResult({
      output: "sun\n",
      modules: ["random"],
      syntax: ["List"],
      analysis: {
        calls: ["random.seed", "random.choice", "print"],
        callSites: [
          {
            id: 1,
            name: "random.choice",
            scope: null,
            assignedNames: [],
            argumentNames: [[]],
            argumentCalls: [null],
          },
          {
            id: 2,
            name: "print",
            scope: null,
            assignedNames: [],
            argumentNames: [[]],
            argumentCalls: [null],
          },
        ],
        executedCalls: [
          executedCall(0, 0, "seed", [4], { module: "random" }),
          executedCall(1, 1, "choice", [["sun", "moon", "star"]], { module: "random" }),
          executedCall(2, 2, "print", ["sun"], { module: "builtins", sources: [1] }),
        ],
        forLoops: [],
        functionDefs: [],
      },
    });

    expect(check("11e", result, "''\nprint(random.choice(...))\n''").passed).toBe(false);
  });
});
