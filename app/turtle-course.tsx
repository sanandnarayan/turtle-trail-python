"use client";

import {
  Check,
  ChevronRight,
  Circle,
  Clock3,
  Eye,
  Lightbulb,
  LockKeyhole,
  Play,
  Repeat2,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Turtle,
} from "lucide-react";
import Link from "next/link";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { CourseVictory } from "@/components/course-victory";
import { Progress } from "@/components/ui/progress";

import {
  AccountControl,
  type CourseProgress,
  useAccount,
  useCourseProgressSync,
} from "./account";
import { PythonEditor } from "./python-editor";

type TurtleLine = {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
};

type TurtleDot = {
  type: "dot";
  x: number;
  y: number;
  size: number;
  color: string;
};

type TurtleText = {
  type: "text";
  x: number;
  y: number;
  text: string;
  color: string;
};

type TurtleBackground = { type: "bg"; color: string };
type TurtleCommand = TurtleLine | TurtleDot | TurtleText | TurtleBackground;

type ForLoopAnalysis = {
  target: string | null;
  iterator: string | null;
  iterable: string | null;
  arguments: Array<string | number | null>;
  calls: string[];
};

type FunctionDefAnalysis = {
  name: string;
  parameters: string[];
  calls: string[];
};

type TraceValue = null | string | number | boolean | TraceValue[];

type CallSiteAnalysis = {
  id: number;
  name: string;
  scope: string | null;
  assignedNames: string[];
  argumentNames: string[][];
  argumentCalls: Array<number | null>;
};

type ExecutedCallAnalysis = {
  id: number;
  site: number;
  name: string | null;
  module: string | null;
  arguments: TraceValue[];
  argumentSources: Array<number | null>;
  resultSource: number | null;
};

export type RunResult = {
  commands: TurtleCommand[];
  output: string;
  error: string | null;
  globals: Record<string, unknown>;
  functions: string[];
  modules: string[];
  syntax: string[];
  analysis: {
    calls: string[];
    callSites: CallSiteAnalysis[];
    executedCalls: ExecutedCallAnalysis[];
    forLoops: ForLoopAnalysis[];
    functionDefs: FunctionDefAnalysis[];
  };
  state: {
    x: number;
    y: number;
    heading: number;
    color: string;
    width: number;
  };
};

type RunResultMessage = { type: "result"; id: number } & RunResult;

type CheckResult = { passed: boolean; message: string };

type MoveVariant = {
  kind: "move";
  mission: string;
  answer: string;
  repeats: number;
  distance: number;
};

type PrintVariant = {
  kind: "print";
  mission: string;
  answer: string;
  repeats: number;
  text: string;
};

type ShapeVariant = {
  kind: "shape";
  mission: string;
  answer: string;
  sides: number;
  distance?: number;
  turn: number;
};

type CustomVariant = {
  kind: "custom";
  key: string;
  mission: string;
  answer: string;
};

export type ChallengeVariant = MoveVariant | PrintVariant | ShapeVariant | CustomVariant;

type LessonQuestion = {
  eyebrow: string;
  prompt: string;
  choices: Array<[value: string, label: string]>;
  correct: string;
  incorrect: string;
};

type Lesson = {
  id: string;
  number: number | string;
  title: string;
  concept: string;
  explanation: string;
  mission: string;
  starter: string;
  phase?: string;
  readOnly?: boolean;
  output?: "turtle" | "print";
  question?: LessonQuestion;
  hints: string[];
  success: string;
  variants?: ChallengeVariant[];
  check: (result: RunResult, code: string, variant?: ChallengeVariant) => CheckResult;
};

type PendingRun = {
  lessonIndex: number;
  code: string;
  variantIndex: number;
  answer: string | null;
};

type SavedProgress = CourseProgress & {
  variants: Record<string, number>;
  revealed: string[];
};

const INDEPENDENT_LOOP_ID = "loop-independent";
const TRANSFER_LOOP_ID = "loop-transfer";
const BOSS_LOOP_ID = "loop-boss";
const ANSWER_STATE_PREFIX = "answer-state-";
const MASTERY_IDS: Record<string, [independent: string, transfer: string]> = {
  "4": [INDEPENDENT_LOOP_ID, TRANSFER_LOOP_ID],
  "5": ["variable-independent", "variable-transfer"],
  "6": ["conditional-independent", "conditional-transfer"],
  "7": ["while-independent", "while-transfer"],
  "8": ["function-independent", "function-transfer"],
  "9": ["parameter-independent", "parameter-transfer"],
  "10": ["list-independent", "list-transfer"],
  "11": ["module-independent", "module-transfer"],
  "12": ["finale-independent", "finale-transfer"],
};

const lineCommands = (result: RunResult) =>
  result.commands.filter((command): command is TurtleLine => command.type === "line");

const lineLength = (line: TurtleLine) =>
  Math.hypot(line.x2 - line.x1, line.y2 - line.y1);

const isNear = (first: number, second: number, tolerance = 3) =>
  Math.abs(first - second) <= tolerance;

const isClosed = (lines: TurtleLine[], tolerance = 5) => {
  if (lines.length < 2) return false;
  const first = lines[0];
  const last = lines[lines.length - 1];
  return isNear(first.x1, last.x2, tolerance) && isNear(first.y1, last.y2, tolerance);
};

const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;

const lineHeading = (line: TurtleLine) =>
  normalizeAngle((Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180) / Math.PI);

const angleDistance = (first: number, second: number) => {
  const difference = Math.abs(normalizeAngle(first) - normalizeAngle(second));
  return Math.min(difference, 360 - difference);
};

const isRegularClosedShape = (
  lines: TurtleLine[],
  sides: number,
  expectedLength: number | undefined,
  expectedTurn: number,
) => {
  const sideLength = expectedLength ?? (lines[0] ? lineLength(lines[0]) : 0);
  if (
    lines.length !== sides ||
    !isClosed(lines) ||
    sideLength <= 0 ||
    !lines.every((line) => isNear(lineLength(line), sideLength))
  ) {
    return false;
  }

  return lines.every((line, index) => {
    const next = lines[(index + 1) % lines.length];
    const joinsNext =
      isNear(line.x2, next.x1, 4) &&
      isNear(line.y2, next.y1, 4);
    const turn = normalizeAngle(lineHeading(next) - lineHeading(line));
    const turnsEitherDirection = Math.min(
      angleDistance(turn, expectedTurn),
      angleDistance(turn, 360 - expectedTurn),
    ) <= 2;
    return joinsNext && turnsEitherDirection;
  });
};

const callMatches = (actual: string, expected: string) =>
  actual === expected || actual.endsWith(`.${expected}`);

const callCount = (result: RunResult, name: string) =>
  result.analysis.calls.filter((call) => callMatches(call, name)).length;

const isExact = (first: number, second: number) =>
  Math.abs(first - second) <= 0.000001;

const executedCalls = (result: RunResult, name: string, module?: string) =>
  result.analysis.executedCalls.filter(
    (call) => call.name === name && (module === undefined || call.module === module),
  );

const callSite = (result: RunResult, id: number) =>
  result.analysis.callSites.find((site) => site.id === id);

const callResultFlowsTo = (
  result: RunResult,
  source: number | null,
  producer: number,
) => {
  const visited = new Set<number>();
  let current = source;
  while (current !== null && !visited.has(current)) {
    if (current === producer) return true;
    visited.add(current);
    current = result.analysis.executedCalls.find((call) => call.id === current)?.resultSource ?? null;
  }
  return false;
};

const callResultFlowsIntoArgument = (
  result: RunResult,
  producer: ExecutedCallAnalysis,
  consumer: ExecutedCallAnalysis,
  argumentIndex: number,
) => {
  if (!callResultFlowsTo(result, consumer.argumentSources[argumentIndex] ?? null, producer.id)) {
    return false;
  }
  const producerSite = callSite(result, producer.site);
  const consumerSite = callSite(result, consumer.site);
  return consumerSite?.argumentCalls[argumentIndex] === producer.site ||
    Boolean(producerSite?.assignedNames.some((name) =>
      consumerSite?.argumentNames[argumentIndex]?.includes(name),
    ));
};

const MOVEMENT_CALLS = new Set([
  "forward",
  "backward",
  "goto",
  "setpos",
  "setposition",
  "setx",
  "sety",
  "home",
  "circle",
]);

const hasExactForwardTrail = (result: RunResult, distance: number) => {
  const movements = result.analysis.executedCalls.filter(
    (call) => call.name !== null && MOVEMENT_CALLS.has(call.name),
  );
  const lines = lineCommands(result);
  return movements.length > 0 &&
    movements.every(
      (call) =>
        call.name === "forward" &&
        typeof call.arguments[0] === "number" &&
        call.arguments[0] > 0,
    ) &&
    lines.length === movements.length &&
    isExact(
      movements.reduce((total, call) => total + (call.arguments[0] as number), 0),
      distance,
    ) &&
    lines.every(
      (line) => isExact(line.y1, 0) && isExact(line.y2, 0) && line.x2 > line.x1,
    ) &&
    isExact(result.state.x, distance) &&
    isExact(result.state.y, 0);
};

const hasRangeLoop = (
  result: RunResult,
  repeats: number,
  requiredCalls: string[],
) =>
  result.analysis.forLoops.some(
    (loop) =>
      callMatches(loop.iterator ?? "", "range") &&
      loop.arguments.length === 1 &&
      loop.arguments[0] === repeats &&
      requiredCalls.every((required) =>
        loop.calls.some((call) => callMatches(call, required)),
      ),
  );

const repeatedMovement = (result: RunResult, repeats: number, distance: number) => {
  const lines = lineCommands(result);
  return lines.length === repeats && lines.every((line) => isNear(lineLength(line), distance));
};

const lineLengthsMatch = (result: RunResult, expected: number[]) => {
  const lines = lineCommands(result);
  return lines.length === expected.length &&
    lines.every((line, index) => isNear(lineLength(line), expected[index]));
};

const lineColorsMatch = (result: RunResult, expected: string[]) => {
  const lines = lineCommands(result);
  return lines.length === expected.length &&
    lines.every((line, index) => line.color === expected[index]);
};

const turnSequenceMatches = (lines: TurtleLine[], expectedTurn: number) =>
  lines.slice(0, -1).every((line, index) => {
    const turn = normalizeAngle(lineHeading(lines[index + 1]) - lineHeading(line));
    return Math.min(
      angleDistance(turn, expectedTurn),
      angleDistance(turn, 360 - expectedTurn),
    ) <= 2;
  });

const hasForLoopCalls = (result: RunResult, requiredCalls: string[]) =>
  result.analysis.forLoops.some((loop) =>
    requiredCalls.every((required) =>
      loop.calls.some((call) => callMatches(call, required)),
    ),
  );

const hasForIterable = (
  result: RunResult,
  iterable: string,
  requiredCalls: string[],
) => result.analysis.forLoops.some((loop) =>
  loop.iterable === iterable &&
  requiredCalls.every((required) =>
    loop.calls.some((call) => callMatches(call, required)),
  ),
);

const hasFunctionDefinition = (
  result: RunResult,
  name: string,
  parameters: string[],
  requiredCalls: string[],
) => result.analysis.functionDefs.some((definition) =>
  definition.name === name &&
  definition.parameters.join("|") === parameters.join("|") &&
  requiredCalls.every((required) =>
    definition.calls.some((call) => callMatches(call, required)),
  ),
);

const customKey = (variant?: ChallengeVariant) =>
  variant?.kind === "custom" ? variant.key : null;

const isShapeRosette = (
  result: RunResult,
  shapes: number,
  sides: number,
  distance: number,
  betweenShapes: number,
) => {
  const lines = lineCommands(result);
  if (lines.length !== shapes * sides) return false;
  const groups = Array.from({ length: shapes }, (_, index) =>
    lines.slice(index * sides, index * sides + sides),
  );
  if (!groups.every((shape) =>
    isRegularClosedShape(shape, sides, distance, 360 / sides),
  )) return false;
  const headings = groups.map((shape) => lineHeading(shape[0]));
  return headings.every((heading, index) => {
    const next = headings[(index + 1) % headings.length];
    const turn = normalizeAngle(next - heading);
    return Math.min(
      angleDistance(turn, betweenShapes),
      angleDistance(turn, 360 - betweenShapes),
    ) <= 2;
  });
};

const printedLines = (output: string) => {
  const lines = output.replaceAll("\r", "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

const checkMoveChallenge = (
  result: RunResult,
  _code: string,
  variant?: ChallengeVariant,
): CheckResult => {
  if (!variant || variant.kind !== "move") {
    return { passed: false, message: "Reset this challenge and try again." };
  }
  if (!result.syntax.includes("For") || !hasRangeLoop(result, variant.repeats, ["forward"])) {
    return { passed: false, message: "Use a for loop with range( ) and put forward( ) inside its indented block." };
  }
  if (callCount(result, "forward") !== 1) {
    return { passed: false, message: "Keep exactly one forward( ) instruction in your whole program." };
  }
  return repeatedMovement(result, variant.repeats, variant.distance)
    ? { passed: true, message: "Your loop did every move from one forward instruction." }
    : { passed: false, message: `Run the loop ${variant.repeats} times and move ${variant.distance} each time.` };
};

const checkPrintChallenge = (
  result: RunResult,
  _code: string,
  variant?: ChallengeVariant,
): CheckResult => {
  if (!variant || variant.kind !== "print") {
    return { passed: false, message: "Reset this challenge and try again." };
  }
  if (!result.syntax.includes("For") || !hasRangeLoop(result, variant.repeats, ["print"])) {
    return { passed: false, message: "The printed result is not enough—put print( ) inside a for loop." };
  }
  if (callCount(result, "print") !== 1) {
    return { passed: false, message: "Use only one print( ) instruction and let the loop repeat it." };
  }
  const lines = printedLines(result.output);
  return lines.length === variant.repeats && lines.every((line) => line === variant.text)
    ? { passed: true, message: "You transferred the loop idea from drawing to printed words." }
    : { passed: false, message: `Print ${variant.text} exactly ${variant.repeats} times.` };
};

const checkShapeChallenge = (
  result: RunResult,
  _code: string,
  variant?: ChallengeVariant,
): CheckResult => {
  if (!variant || variant.kind !== "shape") {
    return { passed: false, message: "Reset this challenge and try again." };
  }
  if (!result.syntax.includes("For") || !hasForLoopCalls(result, ["forward", "right"])) {
    return { passed: false, message: "Put both forward( ) and right( ) inside one for loop." };
  }
  if (callCount(result, "forward") !== 1 || callCount(result, "right") !== 1) {
    return { passed: false, message: "Use only one forward( ) and one right( ) instruction." };
  }
  return isRegularClosedShape(lineCommands(result), variant.sides, variant.distance, variant.turn)
    ? { passed: true, message: "One repeated block drew the whole shape." }
    : {
      passed: false,
      message: variant.distance === undefined
        ? "The loop is there. Check its repeats and turn angle, and keep every side equal."
        : "The loop is there. Check its repeats, distance, and turn angle.",
    };
};

export const LESSONS: Lesson[] = [
  {
    id: "meet-turtle",
    number: 1,
    title: "Meet your turtle",
    concept: "Imports bring tools into your program",
    explanation:
      "The first line brings Python’s turtle toolbox into your program. The second line asks one tool inside it—forward—to move 100 steps.",
    mission: "Run the program and wake up your turtle.",
    starter: `import turtle

turtle.forward(100)`,
    hints: [
      "No changes needed for this first one—just press Run.",
      "Python reads the two lines from top to bottom.",
    ],
    success: "You imported a module and called your first Turtle command.",
    check: (result) => {
      return hasExactForwardTrail(result, 100) && result.modules.includes("turtle")
        ? { passed: true, message: "Your turtle is awake!" }
        : { passed: false, message: "Keep both original lines, then run them together." };
    },
  },
  {
    id: "numbers",
    number: 2,
    title: "Numbers control movement",
    concept: "A value inside parentheses is an argument",
    explanation:
      "The number inside forward( ) tells the turtle how far to travel. Change the value and the picture changes immediately.",
    mission: "Change 40 to 120 so the turtle crosses the finish flag.",
    starter: `import turtle

turtle.forward(40)`,
    hints: [
      "Only one number needs to change.",
      "Your final line should say turtle.forward(120).",
    ],
    success: "You passed a number into a function.",
    check: (result) => {
      return hasExactForwardTrail(result, 120)
        ? { passed: true, message: "Exactly 120 steps!" }
        : { passed: false, message: "The trail needs to be exactly 120 steps long." };
    },
  },
  {
    id: "variables",
    number: 3,
    title: "Remember with a variable",
    concept: "Variables give values memorable names",
    explanation:
      "A variable is a labeled box. Store 100 in distance, then both forward commands can reuse that same value.",
    mission: "Change distance so both sides of the corner are 100 steps long.",
    starter: `import turtle

distance = 40
turtle.forward(distance)
turtle.left(90)
turtle.forward(distance)`,
    hints: [
      "Change the value stored in distance, not the forward commands.",
      "Use distance = 100.",
    ],
    success: "One variable controlled two different movements.",
    check: (result) => {
      const lines = lineCommands(result);
      const forwards = executedCalls(result, "forward");
      const distancePoweredMoves = forwards.length === 2 && forwards.every((call) =>
        call.arguments[0] === 100 &&
        callSite(result, call.site)?.argumentNames[0]?.includes("distance"),
      );
      const movements = result.analysis.executedCalls.filter(
        (call) => call.name !== null && MOVEMENT_CALLS.has(call.name),
      );
      const rightLengths = lines.length === 2 && lines.every((line) => isExact(lineLength(line), 100));
      return result.globals.distance === 100 &&
        movements.length === forwards.length &&
        distancePoweredMoves &&
        rightLengths
        ? { passed: true, message: "Your variable powered both sides!" }
        : { passed: false, message: "Store 100 in distance and keep using its name twice." };
    },
  },
  {
    id: "loop-discover",
    number: "4a",
    phase: "Notice",
    title: "Discover repetition",
    concept: "Repeated instructions are a pattern",
    explanation:
      "Python follows each line from top to bottom. Before learning a shorter way, notice what this program asks the turtle to do again and again.",
    mission: "Which instruction repeats, and how many times? Choose an answer, then run the program.",
    starter: `forward(50)
forward(50)
forward(50)
forward(50)`,
    readOnly: true,
    question: {
      eyebrow: "Before you run",
      prompt: "Which instruction repeats, and how many times?",
      choices: [
        ["forward-four", "forward(50) repeats 4 times"],
        ["forward-fifty", "forward repeats 50 times"],
        ["none", "Nothing repeats"],
      ],
      correct: "forward-four",
      incorrect: "Watch the four moves, then count the identical forward(50) lines again.",
    },
    hints: [
      "Look for lines with exactly the same words, parentheses, and number.",
      "Count the identical lines—not the number inside the parentheses.",
    ],
    success: "You spotted forward(50) repeated four times—the pattern a loop can replace.",
    check: (result) => repeatedMovement(result, 4, 50)
      ? { passed: true, message: "Four identical instructions made four turtle moves." }
      : { passed: false, message: "Keep the four shown forward(50) instructions unchanged." },
  },
  {
    id: "loop-understand",
    number: "4b",
    phase: "Understand",
    title: "Meet a for loop",
    concept: "range(4) gives the loop four step values",
    explanation:
      "The indented instruction runs once for every value from range(4). Python starts at zero, so step becomes 0, 1, 2, then 3.",
    mission: "Predict how many times the turtle will move. Lock in your answer before you run it.",
    starter: `for step in range(4):
    forward(50)`,
    readOnly: true,
    question: {
      eyebrow: "Predict first",
      prompt: "How many times will the turtle move?",
      choices: [["3", "3"], ["4", "4"], ["5", "5"]],
      correct: "4",
      incorrect: "The turtle moved four times: once for step = 0, 1, 2, and 3. Update your prediction and rerun.",
    },
    hints: [
      "range(4) starts at 0 and stops just before 4.",
      "Write down 0, 1, 2, 3, then count the values.",
    ],
    success: "You predicted four moves and watched step change from 0 through 3.",
    check: (result) =>
      repeatedMovement(result, 4, 50) && hasRangeLoop(result, 4, ["forward"])
        ? { passed: true, message: "The loop ran once for each of four step values." }
        : { passed: false, message: "Keep the shown range(4) loop unchanged." },
  },
  {
    id: "loop-guided",
    number: "4c",
    phase: "Practice",
    title: "Complete the loop",
    concept: "The number in range controls the repeats",
    explanation:
      "Now you choose how many values range should make. This guided step connects the repeat count to the turtle’s movement.",
    mission: "Make the turtle move six times.",
    starter: `for step in range(__):
    forward(50)`,
    hints: [
      "Replace the underscores with the number of moves you need.",
      "Keep forward(50) indented so it stays inside the loop.",
    ],
    success: "Six values produced six moves. Next, you write the entire loop yourself.",
    check: (result) =>
      repeatedMovement(result, 6, 50) &&
      hasRangeLoop(result, 6, ["forward"]) &&
      callCount(result, "forward") === 1
        ? { passed: true, message: "Your range created exactly six repeats." }
        : { passed: false, message: "Put 6 inside range( ) and keep one indented forward(50)." },
  },
  {
    id: INDEPENDENT_LOOP_ID,
    number: "4d",
    phase: "Prove it",
    title: "Write a loop from scratch",
    concept: "Independent challenge · mastery proof 1 of 2",
    explanation:
      "No starter code this time. Passing this challenge proves you can create repetition—not just edit one number.",
    mission: "Make the turtle move forward five times. You may use only one forward() instruction.",
    starter: "",
    hints: [
      "Start a for loop with a variable, the word in, range( ), and a colon.",
      "Indent one forward(50) instruction beneath the loop. The repeat count belongs inside range( ).",
    ],
    success: "Independent proof complete: you wrote a real for loop from a blank editor.",
    variants: [
      {
        kind: "move",
        mission: "Make the turtle move forward five times. You may use only one forward() instruction.",
        answer: `for step in range(5):
    forward(50)`,
        repeats: 5,
        distance: 50,
      },
      {
        kind: "move",
        mission: "Fresh challenge: move forward seven times. Use only one forward(40) instruction.",
        answer: `for move in range(7):
    forward(40)`,
        repeats: 7,
        distance: 40,
      },
    ],
    check: checkMoveChallenge,
  },
  {
    id: TRANSFER_LOOP_ID,
    number: "4e",
    phase: "Transfer",
    title: "Use a loop without Turtle",
    concept: "Transfer challenge · mastery proof 2 of 2",
    explanation:
      "Loops are a Python idea, not just a Turtle trick. Start blank again and apply the same structure to a different instruction.",
    mission: "Print Jump! eight times. You may use only one print() instruction.",
    starter: "",
    output: "print",
    hints: [
      "Use the same for … in range(…): structure you used for movement.",
      "Indent one print instruction under the loop. Put Jump! inside quotation marks.",
    ],
    success: "Mastery proven: you independently used a loop for movement and printed output.",
    variants: [
      {
        kind: "print",
        mission: "Print Jump! eight times. You may use only one print() instruction.",
        answer: `for count in range(8):
    print("Jump!")`,
        repeats: 8,
        text: "Jump!",
      },
      {
        kind: "print",
        mission: "Fresh challenge: print Bounce! six times. Use only one print() instruction.",
        answer: `for count in range(6):
    print("Bounce!")`,
        repeats: 6,
        text: "Bounce!",
      },
    ],
    check: checkPrintChallenge,
  },
  {
    id: BOSS_LOOP_ID,
    number: "4f",
    phase: "Boss",
    title: "Build a shape with one block",
    concept: "Combine movement and turning in one loop",
    explanation:
      "A square repeats two actions together: move one side, then turn one corner. Write the whole program from an empty editor.",
    mission: "Draw a square using only one forward() and one right() instruction.",
    starter: "",
    hints: [
      "A square has four equal sides and four equal turns.",
      "Put both instructions inside one indented block. A square corner turns 90 degrees.",
    ],
    success: "Boss cleared: one forward and one right instruction built an entire square.",
    variants: [
      {
        kind: "shape",
        mission: "Draw a square using only one forward() and one right() instruction.",
        answer: `for side in range(4):
    forward(80)
    right(90)`,
        sides: 4,
        turn: 90,
      },
      {
        kind: "shape",
        mission: "Fresh boss: draw an equilateral triangle with one forward(90) and one right() instruction.",
        answer: `for side in range(3):
    forward(90)
    right(120)`,
        sides: 3,
        distance: 90,
        turn: 120,
      },
    ],
    check: checkShapeChallenge,
  },
  {
    id: "variable-discover",
    number: "5a",
    phase: "Notice",
    title: "Watch a value change",
    concept: "A loop variable receives each value in turn",
    explanation:
      "The list gives size a different value on every repeat. The same forward instruction can therefore make lines with different lengths.",
    mission: "Which distances will the turtle move? Choose an answer, then run the example.",
    starter: `for size in [20, 40, 60]:
    forward(size)`,
    readOnly: true,
    question: {
      eyebrow: "Look for the changing value",
      prompt: "Which distances will forward(size) use?",
      choices: [
        ["20-40-60", "20, then 40, then 60"],
        ["60-60-60", "60 three times"],
        ["size", "The word size"],
      ],
      correct: "20-40-60",
      incorrect: "size receives the next list item on each repeat: first 20, then 40, then 60.",
    },
    hints: [
      "Read the values inside the square brackets from left to right.",
      "Trace the program once for each list item.",
    ],
    success: "You found the three values that flowed through size.",
    check: (result) => {
      return lineLengthsMatch(result, [20, 40, 60]) && result.syntax.includes("For")
        ? { passed: true, message: "size changed before every move." }
        : { passed: false, message: "Keep the shown example unchanged." };
    },
  },
  {
    id: "variable-understand",
    number: "5b",
    phase: "Understand",
    title: "Trace the loop variable",
    concept: "range can generate changing values",
    explanation:
      "range(20, 81, 20) starts at 20, adds 20 each time, and stops before 81. Predict the final value before Python draws.",
    mission: "What value will size have on the final repeat?",
    starter: `for size in range(20, 81, 20):
    forward(size)
    right(90)`,
    readOnly: true,
    question: {
      eyebrow: "Predict first",
      prompt: "What is the final value of size?",
      choices: [["60", "60"], ["80", "80"], ["100", "100"]],
      correct: "80",
      incorrect: "range stops before 81, so its values are 20, 40, 60, and 80.",
    },
    hints: [
      "Begin at 20 and keep adding the third range number.",
      "Stop before you reach 81.",
    ],
    success: "You traced size through 20, 40, 60, and 80.",
    check: (result) => lineLengthsMatch(result, [20, 40, 60, 80]) && result.syntax.includes("For")
      ? { passed: true, message: "The range generated four growing values." }
      : { passed: false, message: "Keep the shown range loop unchanged." },
  },
  {
    id: "variable-guided",
    number: "5c",
    phase: "Practice",
    title: "Use the changing value",
    concept: "A loop variable can control an instruction",
    explanation:
      "The loop already calculates 20, 40, 60, 80, and 100. Replace the fixed distance with the variable that holds those values.",
    mission: "Replace the fixed 20 with size to make every line grow.",
    starter: `import turtle

for size in range(20, 101, 20):
    turtle.forward(20)
    turtle.left(90)`,
    hints: [
      "The changing value has already been named size.",
      "Use turtle.forward(size).",
    ],
    success: "One instruction made five different line lengths.",
    check: (result) => lineLengthsMatch(result, [20, 40, 60, 80, 100]) && result.syntax.includes("For")
      ? { passed: true, message: "The loop variable built a growing spiral." }
      : { passed: false, message: "Use size inside forward( )." },
  },
  {
    id: "variable-independent",
    number: "5d",
    phase: "Prove it",
    title: "Create changing moves",
    concept: "Independent challenge · mastery proof 1 of 2",
    explanation:
      "Start blank and make one forward instruction produce four different lengths. The running picture and Python structure must both match.",
    mission: "Draw connected lines of 30, 60, 90, then 120 steps. Use a loop variable and only one forward() instruction. Turn right(90) after each line.",
    starter: "",
    hints: [
      "A three-part range can choose the start, stop, and amount added each time.",
      "Loop over range(30, 121, 30), then use the loop variable inside forward( ).",
    ],
    success: "Independent proof complete: your loop variable controlled four changing moves.",
    variants: [
      {
        kind: "custom",
        key: "variable-moves-primary",
        mission: "Draw connected lines of 30, 60, 90, then 120 steps. Use a loop variable and only one forward() instruction. Turn right(90) after each line.",
        answer: `for distance in range(30, 121, 30):
    forward(distance)
    right(90)`,
      },
      {
        kind: "custom",
        key: "variable-moves-fresh",
        mission: "Fresh challenge: draw connected lines of 25, 50, 75, then 100 steps. Use one forward() and turn right(90) each time.",
        answer: `for distance in range(25, 101, 25):
    forward(distance)
    right(90)`,
      },
    ],
    check: (result, _code, variant) => {
      const expected = customKey(variant) === "variable-moves-fresh"
        ? [25, 50, 75, 100]
        : [30, 60, 90, 120];
      const structure = result.syntax.includes("For") &&
        hasForLoopCalls(result, ["forward", "right"]) &&
        callCount(result, "forward") === 1;
      return structure &&
        lineLengthsMatch(result, expected) &&
        turnSequenceMatches(lineCommands(result), 90)
        ? { passed: true, message: "One changing variable produced every requested length." }
        : { passed: false, message: "Use one forward( ) inside a for loop, and pass it the changing loop variable." };
    },
  },
  {
    id: "variable-transfer",
    number: "5e",
    phase: "Transfer",
    title: "Print changing values",
    concept: "Transfer challenge · mastery proof 2 of 2",
    explanation:
      "The loop variable works outside Turtle too. Start blank and use it as the value printed on every repeat.",
    mission: "Print the numbers 1, 2, 3, and 4 on separate lines. Use a for loop and only one print() instruction.",
    starter: "",
    output: "print",
    hints: [
      "Let range create the four values you need.",
      "Start range at 1, stop before 5, and print the loop variable.",
    ],
    success: "Mastery proven: you transferred a changing loop variable to printed output.",
    variants: [
      {
        kind: "custom",
        key: "variable-print-primary",
        mission: "Print the numbers 1, 2, 3, and 4 on separate lines. Use a for loop and only one print() instruction.",
        answer: `for number in range(1, 5):
    print(number)`,
      },
      {
        kind: "custom",
        key: "variable-print-fresh",
        mission: "Fresh challenge: print 2, 3, 4, and 5 on separate lines with one print() instruction.",
        answer: `for number in range(2, 6):
    print(number)`,
      },
    ],
    check: (result, _code, variant) => {
      const expected = customKey(variant) === "variable-print-fresh"
        ? ["2", "3", "4", "5"]
        : ["1", "2", "3", "4"];
      const structure = result.syntax.includes("For") &&
        hasForLoopCalls(result, ["print"]) &&
        callCount(result, "print") === 1;
      return structure && printedLines(result.output).join("|") === expected.join("|")
        ? { passed: true, message: "The changing variable printed every value in order." }
        : { passed: false, message: "Print the loop variable once inside a for loop." };
    },
  },
  {
    id: "variable-boss",
    number: "5f",
    phase: "Boss",
    title: "Build a growing spiral",
    concept: "Combine a changing distance with repeated turns",
    explanation:
      "Your loop variable, movement, and turning now work together. Write the complete growing pattern from an empty editor.",
    mission: "Draw five lines of 20, 40, 60, 80, and 100 steps. Use one forward() and one right(90) instruction.",
    starter: "",
    hints: [
      "Generate the distances with a three-part range.",
      "Use range(20, 101, 20), then pass its loop variable to forward( ).",
    ],
    success: "Boss cleared: one changing value built a complete growing spiral.",
    variants: [
      {
        kind: "custom",
        key: "variable-boss-primary",
        mission: "Draw five lines of 20, 40, 60, 80, and 100 steps. Use one forward() and one right(90) instruction.",
        answer: `for size in range(20, 101, 20):
    forward(size)
    right(90)`,
      },
      {
        kind: "custom",
        key: "variable-boss-fresh",
        mission: "Fresh boss: draw four lines of 30, 60, 90, and 120 steps. Use one forward() and one right(60) instruction.",
        answer: `for size in range(30, 121, 30):
    forward(size)
    right(60)`,
      },
    ],
    check: (result, _code, variant) => {
      const expected = customKey(variant) === "variable-boss-fresh"
        ? [30, 60, 90, 120]
        : [20, 40, 60, 80, 100];
      const structure = result.syntax.includes("For") &&
        hasForLoopCalls(result, ["forward", "right"]) &&
        callCount(result, "forward") === 1 &&
        callCount(result, "right") === 1;
      return structure &&
        lineLengthsMatch(result, expected) &&
        turnSequenceMatches(lineCommands(result), customKey(variant) === "variable-boss-fresh" ? 60 : 90)
        ? { passed: true, message: "Your loop built the growing spiral from one repeated block." }
        : { passed: false, message: "Use one forward( ) and one right( ) inside a loop with changing distances." };
    },
  },
  {
    id: "conditional-discover",
    number: "6a",
    phase: "Notice",
    title: "Discover a decision",
    concept: "if chooses whether an indented block runs",
    explanation:
      "Python checks the condition after if. When it is true, Python runs the first indented block and skips the else block.",
    mission: "Which message will this program print? Choose before you run it.",
    starter: `score = 7

if score >= 5:
    print("Ready!")
else:
    print("Keep practicing")`,
    readOnly: true,
    output: "print",
    question: {
      eyebrow: "Follow the condition",
      prompt: "Which branch will Python choose?",
      choices: [
        ["ready", "Ready!"],
        ["practice", "Keep practicing"],
        ["both", "Both messages"],
      ],
      correct: "ready",
      incorrect: "7 is greater than or equal to 5, so the if branch runs and else is skipped.",
    },
    hints: [
      "Compare the stored score with 5.",
      "Only one branch of an if/else runs.",
    ],
    success: "You followed a condition to the branch Python chose.",
    check: (result) => result.syntax.includes("If") && result.output === "Ready!\n"
      ? { passed: true, message: "The true condition selected the first branch." }
      : { passed: false, message: "Keep the shown if/else example unchanged." },
  },
  {
    id: "conditional-understand",
    number: "6b",
    phase: "Understand",
    title: "Trace both branches",
    concept: "% can help a condition find even and odd numbers",
    explanation:
      "number % 2 is zero for even numbers and one for odd numbers. Each loop value therefore sends Python down one of two branches.",
    mission: "Predict the four printed words, then run the program to check.",
    starter: `for number in range(4):
    if number % 2 == 0:
        print("even")
    else:
        print("odd")`,
    readOnly: true,
    output: "print",
    question: {
      eyebrow: "Predict first",
      prompt: "What order will Python print?",
      choices: [
        ["even-odd-even-odd", "even, odd, even, odd"],
        ["odd-even-odd-even", "odd, even, odd, even"],
        ["all-even", "even four times"],
      ],
      correct: "even-odd-even-odd",
      incorrect: "range(4) begins at 0. The values alternate even, odd, even, odd.",
    },
    hints: [
      "Write the range values: 0, 1, 2, 3.",
      "Test whether each value leaves remainder 0 after division by 2.",
    ],
    success: "You traced four decisions in the correct order.",
    check: (result) => result.syntax.includes("If") &&
      result.syntax.includes("For") &&
      printedLines(result.output).join("|") === "even|odd|even|odd"
      ? { passed: true, message: "Each value selected exactly one branch." }
      : { passed: false, message: "Keep the shown conditional loop unchanged." },
  },
  {
    id: "conditional-guided",
    number: "6c",
    phase: "Practice",
    title: "Fix the condition",
    concept: "A comparison decides when each block runs",
    explanation:
      "The remainder operator % tells us whether the current ray is even or odd. Right now the comparison is impossible, so every ray gets the same color.",
    mission: "Change the comparison so even rays are blue and odd rays are coral.",
    starter: `import turtle

for ray in range(8):
    if ray % 2 == 3:
        turtle.pencolor("deepskyblue")
    else:
        turtle.pencolor("coral")
    turtle.forward(100)
    turtle.backward(100)
    turtle.left(45)`,
    hints: [
      "An even number leaves no remainder when divided by 2.",
      "Compare ray % 2 with 0.",
    ],
    success: "Your program made a different choice for even and odd rays.",
    check: (result) => {
      const lines = lineCommands(result);
      const expectedColors = Array.from({ length: 8 }, (_, ray) =>
        ray % 2 === 0 ? "deepskyblue" : "coral",
      ).flatMap((color) => [color, color]);
      const colorsMatch = lines.every((line, index) => line.color === expectedColors[index]);
      return lines.length === 16 && colorsMatch && result.syntax.includes("If")
        ? { passed: true, message: "Your decision created alternating colors." }
        : { passed: false, message: "Make the condition true for even ray numbers." };
    },
  },
  {
    id: "conditional-independent",
    number: "6d",
    phase: "Prove it",
    title: "Write a decision from scratch",
    concept: "Independent challenge · mastery proof 1 of 2",
    explanation:
      "Start blank. Your program must contain a real if/else and use it to choose each ray’s color while Python runs.",
    mission: "Draw six 70-step rays. Even ray numbers must be deepskyblue and odd ray numbers coral. Return to the center after every ray.",
    starter: "",
    hints: [
      "Loop over six ray numbers and test the remainder after division by 2.",
      "Set one color in if and the other in else, then draw forward and backward before turning 60°.",
    ],
    success: "Independent proof complete: your own if/else controlled the drawing.",
    variants: [
      {
        kind: "custom",
        key: "conditional-rays-primary",
        mission: "Draw six 70-step rays. Even ray numbers must be deepskyblue and odd ray numbers coral. Return to the center after every ray.",
        answer: `import turtle

for ray in range(6):
    if ray % 2 == 0:
        turtle.pencolor("deepskyblue")
    else:
        turtle.pencolor("coral")
    turtle.forward(70)
    turtle.backward(70)
    turtle.right(60)`,
      },
      {
        kind: "custom",
        key: "conditional-rays-fresh",
        mission: "Fresh challenge: draw four 80-step rays. Even ray numbers must be gold and odd ray numbers mediumseagreen. Return to the center and turn 90° each time.",
        answer: `import turtle

for ray in range(4):
    if ray % 2 == 0:
        turtle.pencolor("gold")
    else:
        turtle.pencolor("mediumseagreen")
    turtle.forward(80)
    turtle.backward(80)
    turtle.right(90)`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "conditional-rays-fresh";
      const repeats = fresh ? 4 : 6;
      const even = fresh ? "gold" : "deepskyblue";
      const odd = fresh ? "mediumseagreen" : "coral";
      const expectedColors = Array.from({ length: repeats }, (_, index) =>
        index % 2 === 0 ? even : odd,
      ).flatMap((color) => [color, color]);
      const lines = lineCommands(result);
      const outwardLines = lines.filter((_, index) => index % 2 === 0);
      const structure = result.syntax.includes("If") &&
        result.syntax.includes("For") &&
        callCount(result, "forward") === 1 &&
        callCount(result, "backward") === 1;
      return structure &&
        lineColorsMatch(result, expectedColors) &&
        lines.every((line) => isNear(lineLength(line), fresh ? 80 : 70)) &&
        turnSequenceMatches(outwardLines, fresh ? 90 : 60)
        ? { passed: true, message: "Your condition chose every ray color at runtime." }
        : { passed: false, message: "Use one if/else inside a loop to alternate the requested colors." };
    },
  },
  {
    id: "conditional-transfer",
    number: "6e",
    phase: "Transfer",
    title: "Classify printed numbers",
    concept: "Transfer challenge · mastery proof 2 of 2",
    explanation:
      "Now use the same decision away from Turtle. Start blank and classify every number produced by a loop.",
    mission: "For the numbers 0 through 4, print even or odd on separate lines. Use a for loop with an if/else.",
    starter: "",
    output: "print",
    hints: [
      "Loop over range(5), then test number % 2.",
      "A remainder of 0 means even; otherwise the number is odd.",
    ],
    success: "Mastery proven: your if/else worked in a new printed problem.",
    variants: [
      {
        kind: "custom",
        key: "conditional-print-primary",
        mission: "For the numbers 0 through 4, print even or odd on separate lines. Use a for loop with an if/else.",
        answer: `for number in range(5):
    if number % 2 == 0:
        print("even")
    else:
        print("odd")`,
      },
      {
        kind: "custom",
        key: "conditional-print-fresh",
        mission: "Fresh challenge: for the numbers 1 through 5, print odd or even on separate lines using if/else.",
        answer: `for number in range(1, 6):
    if number % 2 == 1:
        print("odd")
    else:
        print("even")`,
      },
    ],
    check: (result, _code, variant) => {
      const expected = customKey(variant) === "conditional-print-fresh"
        ? "odd|even|odd|even|odd"
        : "even|odd|even|odd|even";
      const structure = result.syntax.includes("If") &&
        result.syntax.includes("For") &&
        hasForLoopCalls(result, ["print"]);
      return structure && printedLines(result.output).join("|") === expected
        ? { passed: true, message: "Your condition classified every number correctly." }
        : { passed: false, message: "Use if/else inside a for loop and print the requested word for each number." };
    },
  },
  {
    id: "conditional-boss",
    number: "6f",
    phase: "Boss",
    title: "Color a shape by decision",
    concept: "Combine a condition, loop, color, and geometry",
    explanation:
      "Make every side of a shape pass through your condition. The final trail must prove both branches ran.",
    mission: "Draw an 80-step square. Even sides must be deepskyblue and odd sides coral. Use one forward() and one right() instruction.",
    starter: "",
    hints: [
      "Loop over four side numbers and test side % 2.",
      "Choose the color inside if/else, then move 80 and turn 90 in the same loop.",
    ],
    success: "Boss cleared: decisions painted a complete alternating shape.",
    variants: [
      {
        kind: "custom",
        key: "conditional-boss-primary",
        mission: "Draw an 80-step square. Even sides must be deepskyblue and odd sides coral. Use one forward() and one right() instruction.",
        answer: `import turtle

for side in range(4):
    if side % 2 == 0:
        turtle.pencolor("deepskyblue")
    else:
        turtle.pencolor("coral")
    turtle.forward(80)
    turtle.right(90)`,
      },
      {
        kind: "custom",
        key: "conditional-boss-fresh",
        mission: "Fresh boss: draw a 90-step triangle. Even sides must be gold and odd sides mediumseagreen. Use one forward() and one right() instruction.",
        answer: `import turtle

for side in range(3):
    if side % 2 == 0:
        turtle.pencolor("gold")
    else:
        turtle.pencolor("mediumseagreen")
    turtle.forward(90)
    turtle.right(120)`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "conditional-boss-fresh";
      const sides = fresh ? 3 : 4;
      const colors = fresh
        ? ["gold", "mediumseagreen", "gold"]
        : ["deepskyblue", "coral", "deepskyblue", "coral"];
      const structure = result.syntax.includes("If") &&
        result.syntax.includes("For") &&
        callCount(result, "forward") === 1 &&
        callCount(result, "right") === 1;
      return structure &&
        lineColorsMatch(result, colors) &&
        isRegularClosedShape(lineCommands(result), sides, fresh ? 90 : 80, fresh ? 120 : 90)
        ? { passed: true, message: "Your condition colored both branches of a closed shape." }
        : { passed: false, message: "Use if/else inside one loop to color and draw every side." };
    },
  },
  {
    id: "while-discover",
    number: "7a",
    phase: "Notice",
    title: "Discover a stopping condition",
    concept: "while repeats while its condition remains true",
    explanation:
      "Unlike for, a while loop checks a condition before every repeat. Something inside the loop must eventually make that condition false.",
    mission: "Which line helps this loop stop? Choose an answer, then run it.",
    starter: `steps = 0

while steps < 3:
    print(steps)
    steps += 1`,
    readOnly: true,
    output: "print",
    question: {
      eyebrow: "Find the change",
      prompt: "Which instruction helps the loop stop?",
      choices: [
        ["start", "steps = 0"],
        ["print", "print(steps)"],
        ["increase", "steps += 1"],
      ],
      correct: "increase",
      incorrect: "steps += 1 changes the value until steps < 3 becomes false.",
    },
    hints: [
      "The condition depends on the value stored in steps.",
      "Find the instruction inside the loop that changes steps.",
    ],
    success: "You found the changing value that lets a while loop finish.",
    check: (result) => result.syntax.includes("While") &&
      result.globals.steps === 3 &&
      printedLines(result.output).join("|") === "0|1|2"
      ? { passed: true, message: "The counter made the condition false after three repeats." }
      : { passed: false, message: "Keep the shown while example unchanged." },
  },
  {
    id: "while-understand",
    number: "7b",
    phase: "Understand",
    title: "Trace a while loop",
    concept: "The condition is checked before every move",
    explanation:
      "steps starts at zero. Each repeat moves once and adds one, then Python checks steps < 4 again.",
    mission: "Predict how many times the turtle moves before the condition becomes false.",
    starter: `steps = 0

while steps < 4:
    forward(30)
    steps += 1`,
    readOnly: true,
    question: {
      eyebrow: "Predict first",
      prompt: "How many times will the turtle move?",
      choices: [["3", "3"], ["4", "4"], ["5", "5"]],
      correct: "4",
      incorrect: "The loop runs with steps equal to 0, 1, 2, and 3: four moves.",
    },
    hints: [
      "List each value that is smaller than 4, starting at zero.",
      "The loop stops when steps becomes 4.",
    ],
    success: "You predicted every repeat before the while loop stopped.",
    check: (result) => result.syntax.includes("While") &&
      result.globals.steps === 4 &&
      repeatedMovement(result, 4, 30)
      ? { passed: true, message: "The condition allowed exactly four moves." }
      : { passed: false, message: "Keep the shown while loop unchanged." },
  },
  {
    id: "while-guided",
    number: "7c",
    phase: "Practice",
    title: "Choose the stopping point",
    concept: "A while limit controls when repetition ends",
    explanation:
      "steps starts at zero and grows by one each time. The loop stops as soon as steps is no longer smaller than the limit.",
    mission: "Raise the limit from 3 to 6 and close the hexagon.",
    starter: `import turtle

steps = 0
while steps < 3:
    turtle.forward(70)
    turtle.left(60)
    steps += 1`,
    hints: [
      "A hexagon needs six repeats.",
      "The condition should be while steps < 6.",
    ],
    success: "You controlled repetition with a changing condition.",
    check: (result) => {
      const lines = lineCommands(result);
      return (
        isRegularClosedShape(lines, 6, 70, 60) &&
        result.globals.steps === 6 &&
        result.syntax.includes("While")
      )
        ? { passed: true, message: "Six repeats made a closed hexagon." }
        : { passed: false, message: "Let the while loop continue until steps reaches 6." };
    },
  },
  {
    id: "while-independent",
    number: "7d",
    phase: "Prove it",
    title: "Write a while loop",
    concept: "Independent challenge · mastery proof 1 of 2",
    explanation:
      "Start blank. Build the counter, condition, repeated movement, and update yourself. Python will stop programs that never finish.",
    mission: "Move forward(45) exactly four times with a while loop. Use only one forward() instruction.",
    starter: "",
    hints: [
      "Create a counter before the loop and compare it with 4.",
      "Inside the loop, move once and increase the counter by 1.",
    ],
    success: "Independent proof complete: you wrote a safe, working while loop.",
    variants: [
      {
        kind: "custom",
        key: "while-move-primary",
        mission: "Move forward(45) exactly four times with a while loop. Use only one forward() instruction.",
        answer: `steps = 0
while steps < 4:
    forward(45)
    steps += 1`,
      },
      {
        kind: "custom",
        key: "while-move-fresh",
        mission: "Fresh challenge: move forward(35) exactly five times with a while loop and one forward() instruction.",
        answer: `steps = 0
while steps < 5:
    forward(35)
    steps += 1`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "while-move-fresh";
      const repeats = fresh ? 5 : 4;
      const distance = fresh ? 35 : 45;
      return result.syntax.includes("While") &&
        callCount(result, "forward") === 1 &&
        repeatedMovement(result, repeats, distance)
        ? { passed: true, message: "Your condition repeated one move and then stopped safely." }
        : { passed: false, message: "Use one forward( ) inside a while loop that stops after the requested repeats." };
    },
  },
  {
    id: "while-transfer",
    number: "7e",
    phase: "Transfer",
    title: "Repeat words with while",
    concept: "Transfer challenge · mastery proof 2 of 2",
    explanation:
      "A while loop can repeat any instruction. Start blank and transfer your counter pattern to printed output.",
    mission: "Print Go! exactly five times with a while loop and only one print() instruction.",
    starter: "",
    output: "print",
    hints: [
      "Use a counter that starts at zero and continues while it is less than 5.",
      "Print once and increase the counter inside the loop.",
    ],
    success: "Mastery proven: your while loop worked outside Turtle too.",
    variants: [
      {
        kind: "custom",
        key: "while-print-primary",
        mission: "Print Go! exactly five times with a while loop and only one print() instruction.",
        answer: `count = 0
while count < 5:
    print("Go!")
    count += 1`,
      },
      {
        kind: "custom",
        key: "while-print-fresh",
        mission: "Fresh challenge: print Hop! exactly four times with a while loop and one print() instruction.",
        answer: `count = 0
while count < 4:
    print("Hop!")
    count += 1`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "while-print-fresh";
      const repeats = fresh ? 4 : 5;
      const text = fresh ? "Hop!" : "Go!";
      const output = printedLines(result.output);
      return result.syntax.includes("While") &&
        callCount(result, "print") === 1 &&
        output.length === repeats &&
        output.every((line) => line === text)
        ? { passed: true, message: "Your counter repeated the message and stopped." }
        : { passed: false, message: "Use one print( ) inside a while loop with a changing counter." };
    },
  },
  {
    id: "while-boss",
    number: "7f",
    phase: "Boss",
    title: "Draw a shape with while",
    concept: "Combine a counter, condition, movement, and turn",
    explanation:
      "This shape depends on every part of a while loop: the starting counter, stopping condition, body, and counter update.",
    mission: "Draw a 90-step triangle with a while loop. Use only one forward() and one right() instruction.",
    starter: "",
    hints: [
      "A triangle needs three repeats and a 120° exterior turn.",
      "Increase your side counter inside the loop so it reaches 3.",
    ],
    success: "Boss cleared: your while loop drew a complete closed shape.",
    variants: [
      {
        kind: "custom",
        key: "while-boss-primary",
        mission: "Draw a 90-step triangle with a while loop. Use only one forward() and one right() instruction.",
        answer: `side = 0
while side < 3:
    forward(90)
    right(120)
    side += 1`,
      },
      {
        kind: "custom",
        key: "while-boss-fresh",
        mission: "Fresh boss: draw a 70-step square with a while loop and only one forward() and one right() instruction.",
        answer: `side = 0
while side < 4:
    forward(70)
    right(90)
    side += 1`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "while-boss-fresh";
      const sides = fresh ? 4 : 3;
      const distance = fresh ? 70 : 90;
      const turn = fresh ? 90 : 120;
      return result.syntax.includes("While") &&
        callCount(result, "forward") === 1 &&
        callCount(result, "right") === 1 &&
        isRegularClosedShape(lineCommands(result), sides, distance, turn)
        ? { passed: true, message: "Your while loop stopped exactly when the shape closed." }
        : { passed: false, message: "Use one move and turn inside a while loop with the correct stopping count." };
    },
  },
  {
    id: "function-discover",
    number: "8a",
    phase: "Notice",
    title: "Discover a named action",
    concept: "def teaches Python a new instruction",
    explanation:
      "The indented body does not run when Python reads def. It runs later, every time the function’s name is called with parentheses.",
    mission: "How many times will the turtle move? Choose an answer, then run the example.",
    starter: `def move():
    forward(40)

move()
move()`,
    readOnly: true,
    question: {
      eyebrow: "Count the calls",
      prompt: "How many times does the body of move() run?",
      choices: [["1", "1 time"], ["2", "2 times"], ["3", "3 times"]],
      correct: "2",
      incorrect: "Defining move does not draw. The two move() calls each run the body once.",
    },
    hints: [
      "Find every move() line outside the definition.",
      "Each call runs the indented body once.",
    ],
    success: "You separated defining a function from calling it.",
    check: (result) => hasFunctionDefinition(result, "move", [], ["forward"]) &&
      callCount(result, "move") === 2 &&
      repeatedMovement(result, 2, 40)
      ? { passed: true, message: "Two calls ran the same named action twice." }
      : { passed: false, message: "Keep the shown function example unchanged." },
  },
  {
    id: "function-understand",
    number: "8b",
    phase: "Understand",
    title: "Trace function calls",
    concept: "A function body runs from top to bottom on every call",
    explanation:
      "Python remembers the cheer body, returns to the main program, then enters that body for each cheer() call.",
    mission: "Predict the printed output before you run the program.",
    starter: `def cheer():
    print("Go!")

cheer()
cheer()`,
    readOnly: true,
    output: "print",
    question: {
      eyebrow: "Predict first",
      prompt: "What will Python print?",
      choices: [
        ["once", "Go! once"],
        ["twice", "Go! twice"],
        ["nothing", "Nothing"],
      ],
      correct: "twice",
      incorrect: "There are two cheer() calls, so the print instruction runs twice.",
    },
    hints: [
      "The def line stores the action but does not call it.",
      "Count the cheer() calls after the blank line.",
    ],
    success: "You traced both calls into and out of the function body.",
    check: (result) => hasFunctionDefinition(result, "cheer", [], ["print"]) &&
      printedLines(result.output).join("|") === "Go!|Go!"
      ? { passed: true, message: "Each call printed one Go!." }
      : { passed: false, message: "Keep the shown function example unchanged." },
  },
  {
    id: "function-guided",
    number: "8c",
    phase: "Practice",
    title: "Call a function",
    concept: "Defining stores an action; calling performs it",
    explanation:
      "def creates a new command named draw_triangle. Defining it teaches Python the command; calling it actually performs the drawing.",
    mission: "Call draw_triangle below the comment so the triangle appears.",
    starter: `import turtle

def draw_triangle():
    for side in range(3):
        turtle.forward(90)
        turtle.left(120)

# Call your function below
`,
    hints: [
      "Call it outside the indented function block.",
      "Add draw_triangle() on the final line.",
    ],
    success: "You defined a function and then called it.",
    check: (result) => {
      const lines = lineCommands(result);
      return (
        result.functions.includes("draw_triangle") &&
        executedCalls(result, "draw_triangle").length > 0 &&
        isRegularClosedShape(lines, 3, 90, 120)
      )
        ? { passed: true, message: "Python remembered your new triangle command." }
        : { passed: false, message: "The function exists, but remember to call draw_triangle()." };
    },
  },
  {
    id: "function-independent",
    number: "8d",
    phase: "Prove it",
    title: "Define your own movement",
    concept: "Independent challenge · mastery proof 1 of 2",
    explanation:
      "Start blank. Create and call the requested function. The forward instruction must live inside its definition, not beside it.",
    mission: "Define move_twice() to move forward(60) twice using one forward() instruction, then call move_twice() once.",
    starter: "",
    hints: [
      "Begin with def move_twice(): and indent its body.",
      "Put a two-repeat for loop and one forward(60) inside the function, then call it after the definition.",
    ],
    success: "Independent proof complete: you defined and called a real function.",
    variants: [
      {
        kind: "custom",
        key: "function-move-primary",
        mission: "Define move_twice() to move forward(60) twice using one forward() instruction, then call move_twice() once.",
        answer: `def move_twice():
    for step in range(2):
        forward(60)

move_twice()`,
      },
      {
        kind: "custom",
        key: "function-move-fresh",
        mission: "Fresh challenge: define move_three() to move forward(40) three times with one forward() instruction, then call it once.",
        answer: `def move_three():
    for step in range(3):
        forward(40)

move_three()`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "function-move-fresh";
      const name = fresh ? "move_three" : "move_twice";
      const repeats = fresh ? 3 : 2;
      const distance = fresh ? 40 : 60;
      return hasFunctionDefinition(result, name, [], ["forward"]) &&
        result.syntax.includes("For") &&
        callCount(result, name) === 1 &&
        callCount(result, "forward") === 1 &&
        repeatedMovement(result, repeats, distance)
        ? { passed: true, message: "Your named function performed the whole repeated move." }
        : { passed: false, message: `Define ${name} with the loop inside it, then call the function once.` };
    },
  },
  {
    id: "function-transfer",
    number: "8e",
    phase: "Transfer",
    title: "Name a printed action",
    concept: "Transfer challenge · mastery proof 2 of 2",
    explanation:
      "Functions can organize any kind of work. Start blank and create a reusable printed action instead of a Turtle action.",
    mission: "Define cheer() to print Ready! once. Use a for loop to call cheer() three times. Keep only one print() instruction.",
    starter: "",
    output: "print",
    hints: [
      "Put one print instruction inside def cheer():.",
      "After the definition, loop three times and call cheer() inside that loop.",
    ],
    success: "Mastery proven: you transferred function structure to printed output.",
    variants: [
      {
        kind: "custom",
        key: "function-print-primary",
        mission: "Define cheer() to print Ready! once. Use a for loop to call cheer() three times. Keep only one print() instruction.",
        answer: `def cheer():
    print("Ready!")

for call in range(3):
    cheer()`,
      },
      {
        kind: "custom",
        key: "function-print-fresh",
        mission: "Fresh challenge: define signal() to print Set! once, then call signal() twice from a for loop. Use one print().",
        answer: `def signal():
    print("Set!")

for call in range(2):
    signal()`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "function-print-fresh";
      const name = fresh ? "signal" : "cheer";
      const repeats = fresh ? 2 : 3;
      const text = fresh ? "Set!" : "Ready!";
      const output = printedLines(result.output);
      return hasFunctionDefinition(result, name, [], ["print"]) &&
        result.syntax.includes("For") &&
        hasForLoopCalls(result, [name]) &&
        callCount(result, "print") === 1 &&
        output.length === repeats &&
        output.every((line) => line === text)
        ? { passed: true, message: "Your printed function was reused from one loop." }
        : { passed: false, message: `Define ${name} with one print( ), then call it from a for loop.` };
    },
  },
  {
    id: "function-boss",
    number: "8f",
    phase: "Boss",
    title: "Package a whole shape",
    concept: "A function can hide a complete repeated process",
    explanation:
      "Put every drawing instruction inside one named function. Calling that function should be enough to create the whole shape.",
    mission: "Define draw_square() to draw an 80-step square using one forward() and one right(). Then call draw_square() once.",
    starter: "",
    hints: [
      "Define draw_square with no parameters and put a four-repeat loop inside.",
      "After the definition ends, call draw_square() with no indentation.",
    ],
    success: "Boss cleared: one function call drew an entire shape.",
    variants: [
      {
        kind: "custom",
        key: "function-boss-primary",
        mission: "Define draw_square() to draw an 80-step square using one forward() and one right(). Then call draw_square() once.",
        answer: `def draw_square():
    for side in range(4):
        forward(80)
        right(90)

draw_square()`,
      },
      {
        kind: "custom",
        key: "function-boss-fresh",
        mission: "Fresh boss: define draw_triangle() to draw a 90-step triangle with one forward() and one right(), then call it once.",
        answer: `def draw_triangle():
    for side in range(3):
        forward(90)
        right(120)

draw_triangle()`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "function-boss-fresh";
      const name = fresh ? "draw_triangle" : "draw_square";
      const sides = fresh ? 3 : 4;
      const distance = fresh ? 90 : 80;
      const turn = fresh ? 120 : 90;
      return hasFunctionDefinition(result, name, [], ["forward", "right"]) &&
        hasRangeLoop(result, sides, ["forward", "right"]) &&
        callCount(result, name) === 1 &&
        callCount(result, "forward") === 1 &&
        callCount(result, "right") === 1 &&
        isRegularClosedShape(lineCommands(result), sides, distance, turn)
        ? { passed: true, message: "Your one function call built the complete shape." }
        : { passed: false, message: `Put the whole repeated shape inside ${name}, then call it once.` };
    },
  },
  {
    id: "parameter-discover",
    number: "9a",
    phase: "Notice",
    title: "Discover a placeholder",
    concept: "A parameter receives the value from each call",
    explanation:
      "distance is a placeholder inside move. Each call supplies an argument, and that value is used while the function body runs.",
    mission: "Which values will distance receive? Choose before you run the example.",
    starter: `def move(distance):
    forward(distance)

move(30)
move(60)`,
    readOnly: true,
    question: {
      eyebrow: "Follow the arguments",
      prompt: "Which values does distance receive?",
      choices: [
        ["30-60", "30, then 60"],
        ["distance", "The word distance twice"],
        ["90", "90 once"],
      ],
      correct: "30-60",
      incorrect: "The first move call passes 30; the second call passes 60.",
    },
    hints: [
      "Look inside the parentheses of each move call.",
      "An argument fills the parameter for that one call.",
    ],
    success: "You traced both arguments into the distance parameter.",
    check: (result) => hasFunctionDefinition(result, "move", ["distance"], ["forward"]) &&
      callCount(result, "move") === 2 &&
      lineLengthsMatch(result, [30, 60])
      ? { passed: true, message: "The same function used two different argument values." }
      : { passed: false, message: "Keep the shown parameter example unchanged." },
  },
  {
    id: "parameter-understand",
    number: "9b",
    phase: "Understand",
    title: "Trace parameters through calls",
    concept: "A new argument replaces the parameter on every call",
    explanation:
      "word is local to shout. It becomes Hello during the first call and Bye during the second, without changing the function definition.",
    mission: "Predict the two lines of printed output.",
    starter: `def shout(word):
    print(word)

shout("Hello")
shout("Bye")`,
    readOnly: true,
    output: "print",
    question: {
      eyebrow: "Predict first",
      prompt: "What will Python print?",
      choices: [
        ["hello-bye", "Hello, then Bye"],
        ["word-word", "word twice"],
        ["bye-hello", "Bye, then Hello"],
      ],
      correct: "hello-bye",
      incorrect: "Each call supplies its own word, and calls run from top to bottom.",
    },
    hints: [
      "Trace the first call completely before the second.",
      "Replace word with the argument from the current call.",
    ],
    success: "You followed two arguments through one reusable function.",
    check: (result) => hasFunctionDefinition(result, "shout", ["word"], ["print"]) &&
      printedLines(result.output).join("|") === "Hello|Bye"
      ? { passed: true, message: "Each argument flowed into word at the right time." }
      : { passed: false, message: "Keep the shown parameter example unchanged." },
  },
  {
    id: "parameter-guided",
    number: "9c",
    phase: "Practice",
    title: "Pass a new size",
    concept: "An argument supplies a function parameter",
    explanation:
      "size is a placeholder inside the function. The number used when you call draw_square becomes that function’s size.",
    mission: "Ask draw_square to make a 110-step square instead of a tiny one.",
    starter: `import turtle

def draw_square(size):
    for side in range(4):
        turtle.forward(size)
        turtle.left(90)

draw_square(40)`,
    hints: [
      "Leave the function itself unchanged.",
      "Change the final call to draw_square(110).",
    ],
    success: "Your argument flowed into the function through a parameter.",
    check: (result) => {
      const lines = lineCommands(result);
      const drawCalls = executedCalls(result, "draw_square");
      const forwardCalls = executedCalls(result, "forward");
      const usesParameter = forwardCalls.length === 4 && forwardCalls.every((call) => {
        const site = callSite(result, call.site);
        return site?.scope === "draw_square" &&
          site.argumentNames[0]?.includes("size") &&
          call.arguments[0] === 110;
      });
      const passesArgument = drawCalls.length === 1 && drawCalls[0].arguments[0] === 110;
      const largeSquare = isRegularClosedShape(lines, 4, 110, 90);
      return hasFunctionDefinition(result, "draw_square", ["size"], []) &&
        usesParameter &&
        passesArgument &&
        largeSquare
        ? { passed: true, message: "One parameter resized the entire square." }
        : { passed: false, message: "Pass 110 into draw_square on the final line." };
    },
  },
  {
    id: "parameter-independent",
    number: "9d",
    phase: "Prove it",
    title: "Build a parameterized move",
    concept: "Independent challenge · mastery proof 1 of 2",
    explanation:
      "Start blank. Define the parameter yourself, use it inside the function, then prove two calls can create two different results.",
    mission: "Define draw_line(length) with one forward() instruction. Call it with 70, then with 40, so it draws those two lengths in order.",
    starter: "",
    hints: [
      "Put length between the parentheses in both the def line and forward call.",
      "After the definition, write draw_line(70) and draw_line(40).",
    ],
    success: "Independent proof complete: one parameterized function handled two values.",
    variants: [
      {
        kind: "custom",
        key: "parameter-line-primary",
        mission: "Define draw_line(length) with one forward() instruction. Call it with 70, then with 40, so it draws those two lengths in order.",
        answer: `def draw_line(length):
    forward(length)

draw_line(70)
draw_line(40)`,
      },
      {
        kind: "custom",
        key: "parameter-line-fresh",
        mission: "Fresh challenge: define move_line(amount) with one forward(), then call it with 50 and 80 in that order.",
        answer: `def move_line(amount):
    forward(amount)

move_line(50)
move_line(80)`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "parameter-line-fresh";
      const name = fresh ? "move_line" : "draw_line";
      const parameter = fresh ? "amount" : "length";
      const lengths = fresh ? [50, 80] : [70, 40];
      return hasFunctionDefinition(result, name, [parameter], ["forward"]) &&
        callCount(result, name) === 2 &&
        callCount(result, "forward") === 1 &&
        lineLengthsMatch(result, lengths)
        ? { passed: true, message: "Your parameter gave one function two different behaviors." }
        : { passed: false, message: `Define ${name} with its parameter inside forward( ), then call it with both values.` };
    },
  },
  {
    id: "parameter-transfer",
    number: "9e",
    phase: "Transfer",
    title: "Parameterize printed repetition",
    concept: "Transfer challenge · mastery proof 2 of 2",
    explanation:
      "Use two parameters in a new setting: one for what to print and another for how many times to print it.",
    mission: "Define repeat(word, times) with one print() in a loop. Call repeat(\"Jump!\", 3).",
    starter: "",
    output: "print",
    hints: [
      "Your def line needs two parameter names separated by a comma.",
      "Loop over range(times), print word inside, then call the function with Jump! and 3.",
    ],
    success: "Mastery proven: two parameters controlled content and repetition.",
    variants: [
      {
        kind: "custom",
        key: "parameter-print-primary",
        mission: "Define repeat(word, times) with one print() in a loop. Call repeat(\"Jump!\", 3).",
        answer: `def repeat(word, times):
    for count in range(times):
        print(word)

repeat("Jump!", 3)`,
      },
      {
        kind: "custom",
        key: "parameter-print-fresh",
        mission: "Fresh challenge: define echo(message, times) with one print() in a loop. Call echo(\"Bounce!\", 2).",
        answer: `def echo(message, times):
    for count in range(times):
        print(message)

echo("Bounce!", 2)`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "parameter-print-fresh";
      const name = fresh ? "echo" : "repeat";
      const parameters = fresh ? ["message", "times"] : ["word", "times"];
      const text = fresh ? "Bounce!" : "Jump!";
      const repeats = fresh ? 2 : 3;
      const output = printedLines(result.output);
      return hasFunctionDefinition(result, name, parameters, ["print"]) &&
        result.syntax.includes("For") &&
        callCount(result, "print") === 1 &&
        output.length === repeats &&
        output.every((line) => line === text)
        ? { passed: true, message: "Your parameters controlled both the message and repeat count." }
        : { passed: false, message: `Define ${name} with both parameters and use them inside the function.` };
    },
  },
  {
    id: "parameter-boss",
    number: "9f",
    phase: "Boss",
    title: "Build a flexible polygon function",
    concept: "Parameters can control an entire algorithm",
    explanation:
      "Use one parameter for the number of sides and another for their length. One function can then draw more than one kind of polygon.",
    mission: "Define polygon(sides, length) with one forward() and one right(). Turn by 360 / sides. Call polygon(3, 90).",
    starter: "",
    hints: [
      "Loop over range(sides) inside the function.",
      "Move by length and turn by 360 / sides, then call polygon with 3 and 90.",
    ],
    success: "Boss cleared: two parameters controlled a complete polygon.",
    variants: [
      {
        kind: "custom",
        key: "parameter-boss-primary",
        mission: "Define polygon(sides, length) with one forward() and one right(). Turn by 360 / sides. Call polygon(3, 90).",
        answer: `def polygon(sides, length):
    for side in range(sides):
        forward(length)
        right(360 / sides)

polygon(3, 90)`,
      },
      {
        kind: "custom",
        key: "parameter-boss-fresh",
        mission: "Fresh boss: define polygon(sides, length) the same flexible way, then call polygon(4, 70).",
        answer: `def polygon(sides, length):
    for side in range(sides):
        forward(length)
        right(360 / sides)

polygon(4, 70)`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "parameter-boss-fresh";
      const sides = fresh ? 4 : 3;
      const distance = fresh ? 70 : 90;
      const turn = fresh ? 90 : 120;
      return hasFunctionDefinition(result, "polygon", ["sides", "length"], ["forward", "right"]) &&
        hasForLoopCalls(result, ["forward", "right"]) &&
        callCount(result, "forward") === 1 &&
        callCount(result, "right") === 1 &&
        isRegularClosedShape(lineCommands(result), sides, distance, turn)
        ? { passed: true, message: "Your parameters produced the requested polygon." }
        : { passed: false, message: "Use both parameters inside polygon, then call it with the requested values." };
    },
  },
  {
    id: "list-discover",
    number: "10a",
    phase: "Notice",
    title: "Discover a collection",
    concept: "Square brackets keep several values in one list",
    explanation:
      "A list has one name but can hold many items. A for loop can visit those items from left to right without using an index.",
    mission: "How many times will the loop run? Choose an answer, then watch it use every color.",
    starter: `import turtle

colors = ["deepskyblue", "coral", "gold"]

for paint in colors:
    turtle.pencolor(paint)
    turtle.forward(70)
    turtle.right(120)`,
    readOnly: true,
    question: {
      eyebrow: "Count the items",
      prompt: "How many values will paint receive?",
      choices: [["2", "2"], ["3", "3"], ["70", "70"]],
      correct: "3",
      incorrect: "There are three comma-separated items inside the list, so the loop runs three times.",
    },
    hints: [
      "Count the quoted values between [ and ].",
      "The forward distance is not a list item.",
    ],
    success: "You connected three list items to three loop repeats.",
    check: (result) => result.syntax.includes("List") &&
      hasForIterable(result, "colors", ["pencolor", "forward"]) &&
      lineColorsMatch(result, ["deepskyblue", "coral", "gold"])
      ? { passed: true, message: "The loop visited all three colors in order." }
      : { passed: false, message: "Keep the shown list example unchanged." },
  },
  {
    id: "list-understand",
    number: "10b",
    phase: "Understand",
    title: "Trace items in order",
    concept: "The loop variable becomes one list item at a time",
    explanation:
      "On each repeat, word receives the next string in the list. The list’s order therefore controls the program’s output order.",
    mission: "Predict the printed order before you run the program.",
    starter: `words = ["Ready", "Set", "Go!"]

for word in words:
    print(word)`,
    readOnly: true,
    output: "print",
    question: {
      eyebrow: "Predict first",
      prompt: "What order will Python print?",
      choices: [
        ["ready-set-go", "Ready, Set, Go!"],
        ["go-set-ready", "Go!, Set, Ready"],
        ["all", "All three on one line"],
      ],
      correct: "ready-set-go",
      incorrect: "A for loop visits list items from left to right, printing one item per repeat.",
    },
    hints: [
      "Start with the first item after the opening bracket.",
      "Each print call ends with a new line.",
    ],
    success: "You traced the list from its first item to its last.",
    check: (result) => result.syntax.includes("List") &&
      hasForIterable(result, "words", ["print"]) &&
      printedLines(result.output).join("|") === "Ready|Set|Go!"
      ? { passed: true, message: "The loop kept the list’s left-to-right order." }
      : { passed: false, message: "Keep the shown list loop unchanged." },
  },
  {
    id: "list-guided",
    number: "10c",
    phase: "Practice",
    title: "Add an item",
    concept: "Commas separate items inside a list",
    explanation:
      "Square brackets create a list. The loop picks up each color in order and uses it for one side of the triangle.",
    mission: "Add \"gold\" as a third item so the drawing gets three colored sides.",
    starter: `import turtle

colors = ["deepskyblue", "coral"]

for paint in colors:
    turtle.pencolor(paint)
    turtle.forward(100)
    turtle.left(120)`,
    hints: [
      "Items in a list are separated with commas.",
      "Use colors = [\"deepskyblue\", \"coral\", \"gold\"].",
    ],
    success: "Your loop visited every item stored in a list.",
    check: (result) => {
      const lines = lineCommands(result);
      const storedColors = result.globals.colors;
      const expectedColors = ["deepskyblue", "coral", "gold"];
      const listMatches =
        Array.isArray(storedColors) &&
        storedColors.length === expectedColors.length &&
        storedColors.every((color, index) => color === expectedColors[index]);
      const trailMatches =
        lines.length === expectedColors.length &&
        lines.every((line, index) => line.color === expectedColors[index]);
      return listMatches && trailMatches && isRegularClosedShape(lines, 3, 100, 120)
        ? { passed: true, message: "Three list items became three bright sides." }
        : { passed: false, message: "Put three color strings inside the colors list." };
    },
  },
  {
    id: "list-independent",
    number: "10d",
    phase: "Prove it",
    title: "Build and use a list",
    concept: "Independent challenge · mastery proof 1 of 2",
    explanation:
      "Start blank. Create the list yourself and loop over its items. One forward instruction must draw every requested distance.",
    mission: "Create distances = [30, 60, 90]. Loop over distances, move each amount with one forward(), and turn right(90) after every line.",
    starter: "",
    hints: [
      "Store the three numbers between square brackets and separate them with commas.",
      "Write for distance in distances:, then pass distance into forward( ).",
    ],
    success: "Independent proof complete: you created and consumed a list.",
    variants: [
      {
        kind: "custom",
        key: "list-moves-primary",
        mission: "Create distances = [30, 60, 90]. Loop over distances, move each amount with one forward(), and turn right(90) after every line.",
        answer: `distances = [30, 60, 90]

for distance in distances:
    forward(distance)
    right(90)`,
      },
      {
        kind: "custom",
        key: "list-moves-fresh",
        mission: "Fresh challenge: create distances = [25, 50, 75, 100]. Loop over it with one forward() and turn right(90) each time.",
        answer: `distances = [25, 50, 75, 100]

for distance in distances:
    forward(distance)
    right(90)`,
      },
    ],
    check: (result, _code, variant) => {
      const expected = customKey(variant) === "list-moves-fresh"
        ? [25, 50, 75, 100]
        : [30, 60, 90];
      return result.syntax.includes("List") &&
        hasForIterable(result, "distances", ["forward", "right"]) &&
        callCount(result, "forward") === 1 &&
        lineLengthsMatch(result, expected) &&
        turnSequenceMatches(lineCommands(result), 90)
        ? { passed: true, message: "One loop visited every distance in your list." }
        : { passed: false, message: "Create distances as a list, then loop over that list with one forward( )." };
    },
  },
  {
    id: "list-transfer",
    number: "10e",
    phase: "Transfer",
    title: "Loop through a word list",
    concept: "Transfer challenge · mastery proof 2 of 2",
    explanation:
      "Transfer the same list pattern to text. Start blank, store the words together, and let one print instruction visit all of them.",
    mission: "Create words = [\"Ready\", \"Set\", \"Go!\"]. Print each item on its own line with a loop and one print().",
    starter: "",
    output: "print",
    hints: [
      "Strings need quotation marks inside the square brackets.",
      "Loop with for word in words:, then print word once inside the block.",
    ],
    success: "Mastery proven: you transferred list iteration to text.",
    variants: [
      {
        kind: "custom",
        key: "list-print-primary",
        mission: "Create words = [\"Ready\", \"Set\", \"Go!\"]. Print each item on its own line with a loop and one print().",
        answer: `words = ["Ready", "Set", "Go!"]

for word in words:
    print(word)`,
      },
      {
        kind: "custom",
        key: "list-print-fresh",
        mission: "Fresh challenge: create animals = [\"Turtle\", \"Fox\", \"Owl\"]. Print each item with one loop and one print().",
        answer: `animals = ["Turtle", "Fox", "Owl"]

for animal in animals:
    print(animal)`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "list-print-fresh";
      const iterable = fresh ? "animals" : "words";
      const expected = fresh ? "Turtle|Fox|Owl" : "Ready|Set|Go!";
      return result.syntax.includes("List") &&
        hasForIterable(result, iterable, ["print"]) &&
        callCount(result, "print") === 1 &&
        printedLines(result.output).join("|") === expected
        ? { passed: true, message: "Your loop printed every list item in order." }
        : { passed: false, message: `Create the ${iterable} list and loop over it with one print( ).` };
    },
  },
  {
    id: "list-boss",
    number: "10f",
    phase: "Boss",
    title: "Paint a shape from a list",
    concept: "List items can control a repeated drawing",
    explanation:
      "Make the number and order of colors match the sides of a shape. Each loop repeat should pick one color and draw one side.",
    mission: "Create colors = [\"deepskyblue\", \"coral\", \"gold\"]. Loop over it to draw a 90-step triangle with one forward() and one right().",
    starter: "",
    hints: [
      "Import turtle so you can set pencolor, then loop directly over colors.",
      "Inside the loop, set the color, move 90, and turn right 120.",
    ],
    success: "Boss cleared: one list supplied every side color.",
    variants: [
      {
        kind: "custom",
        key: "list-boss-primary",
        mission: "Create colors = [\"deepskyblue\", \"coral\", \"gold\"]. Loop over it to draw a 90-step triangle with one forward() and one right().",
        answer: `import turtle

colors = ["deepskyblue", "coral", "gold"]

for color in colors:
    turtle.pencolor(color)
    turtle.forward(90)
    turtle.right(120)`,
      },
      {
        kind: "custom",
        key: "list-boss-fresh",
        mission: "Fresh boss: create colors = [\"coral\", \"gold\", \"mediumseagreen\", \"deepskyblue\"]. Loop over it to draw a 70-step square.",
        answer: `import turtle

colors = ["coral", "gold", "mediumseagreen", "deepskyblue"]

for color in colors:
    turtle.pencolor(color)
    turtle.forward(70)
    turtle.right(90)`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "list-boss-fresh";
      const colors = fresh
        ? ["coral", "gold", "mediumseagreen", "deepskyblue"]
        : ["deepskyblue", "coral", "gold"];
      const sides = fresh ? 4 : 3;
      const distance = fresh ? 70 : 90;
      const turn = fresh ? 90 : 120;
      return result.syntax.includes("List") &&
        hasForIterable(result, "colors", ["pencolor", "forward", "right"]) &&
        callCount(result, "forward") === 1 &&
        callCount(result, "right") === 1 &&
        lineColorsMatch(result, colors) &&
        isRegularClosedShape(lineCommands(result), sides, distance, turn)
        ? { passed: true, message: "Your list painted every side of the shape in order." }
        : { passed: false, message: "Loop over the colors list and draw one correctly colored side per item." };
    },
  },
  {
    id: "module-discover",
    number: "11a",
    phase: "Notice",
    title: "Discover a module",
    concept: "import makes another toolbox available",
    explanation:
      "Python’s math module contains functions and values for calculations. After import math, a dot selects a tool from that module.",
    mission: "Which module provides sqrt? Choose an answer, then run the example.",
    starter: `import math

print(math.sqrt(81))`,
    readOnly: true,
    output: "print",
    question: {
      eyebrow: "Find the toolbox",
      prompt: "Where does the sqrt function come from?",
      choices: [
        ["math", "The math module"],
        ["print", "The print function"],
        ["81", "The number 81"],
      ],
      correct: "math",
      incorrect: "The name before the dot shows the toolbox: math.sqrt comes from the math module.",
    },
    hints: [
      "Look at the word imported on the first line.",
      "The same word appears before the dot on the last line.",
    ],
    success: "You connected an imported module to one of its functions.",
    check: (result) => result.modules.includes("math") &&
      callCount(result, "math.sqrt") === 1 &&
      result.output === "9.0\n"
      ? { passed: true, message: "The imported math toolbox calculated the square root." }
      : { passed: false, message: "Keep the shown module example unchanged." },
  },
  {
    id: "module-understand",
    number: "11b",
    phase: "Understand",
    title: "Read a module call",
    concept: "random.choice returns one item from a sequence",
    explanation:
      "The module name comes before the dot, the function comes after it, and the list inside the parentheses is the function’s argument.",
    mission: "Predict what kind of result random.choice will print.",
    starter: `import random

random.seed(3)
print(random.choice(["red", "blue"]))`,
    readOnly: true,
    output: "print",
    question: {
      eyebrow: "Predict first",
      prompt: "What can random.choice return here?",
      choices: [
        ["one", "One item: red or blue"],
        ["both", "Both items together"],
        ["number", "A random number"],
      ],
      correct: "one",
      incorrect: "choice selects one item from the list supplied to it.",
    },
    hints: [
      "The function is named choice, not choices.",
      "Its argument is a list containing two strings.",
    ],
    success: "You identified the module, function, argument, and returned value.",
    check: (result) => result.modules.includes("random") &&
      callCount(result, "random.choice") === 1 &&
      ["red", "blue"].includes(result.output.trim())
      ? { passed: true, message: "random.choice selected one list item." }
      : { passed: false, message: "Keep the shown random example unchanged." },
  },
  {
    id: "module-guided",
    number: "11c",
    phase: "Practice",
    title: "Import a new superpower",
    concept: "A module must be imported before it is used",
    explanation:
      "random is another module. Its choice function can select a surprise item from your colors list each time around the loop.",
    mission: "Add import random below import turtle, then run the firework.",
    starter: `import turtle
# Import random on the next line

colors = ["deepskyblue", "coral", "gold", "mediumseagreen"]
random.seed(7)

for ray in range(12):
    turtle.pencolor(random.choice(colors))
    turtle.forward(110)
    turtle.backward(110)
    turtle.left(30)`,
    hints: [
      "Imports usually sit together at the top of a file.",
      "Add the line import random.",
    ],
    success: "You imported a second module and used one of its functions.",
    check: (result, code) => {
      const lines = lineCommands(result);
      const colors = new Set(lines.map((line) => line.color));
      const usesRandomChoice = /random\.choice\s*\(/.test(code);
      return result.modules.includes("random") && usesRandomChoice && lines.length === 24 && colors.size >= 2
        ? { passed: true, message: "Random choices lit up your firework." }
        : { passed: false, message: "Import random before the program tries to use it." };
    },
  },
  {
    id: "module-independent",
    number: "11d",
    phase: "Prove it",
    title: "Import and calculate",
    concept: "Independent challenge · mastery proof 1 of 2",
    explanation:
      "Start blank. Choose the correct module, import it, and call the requested function yourself. Printing the answer alone is not enough.",
    mission: "Import math and print the result of math.sqrt(144). Use one print() instruction.",
    starter: "",
    output: "print",
    hints: [
      "The import goes on its own line at the top.",
      "Nest math.sqrt(144) inside print( ) so Python prints the calculated result.",
    ],
    success: "Independent proof complete: you imported and used a module function.",
    variants: [
      {
        kind: "custom",
        key: "module-math-primary",
        mission: "Import math and print the result of math.sqrt(144). Use one print() instruction.",
        answer: `import math

print(math.sqrt(144))`,
      },
      {
        kind: "custom",
        key: "module-math-fresh",
        mission: "Fresh challenge: import math and print the result of math.sqrt(225) with one print() instruction.",
        answer: `import math

print(math.sqrt(225))`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "module-math-fresh";
      const expected = fresh ? "15.0" : "12.0";
      const argument = fresh ? 225 : 144;
      const sqrtCalls = executedCalls(result, "sqrt", "math").filter(
        (call) => call.arguments[0] === argument,
      );
      const printedSqrtResult = sqrtCalls.length === 1 && executedCalls(result, "print", "builtins").some(
        (call) => callResultFlowsIntoArgument(result, sqrtCalls[0], call, 0),
      );
      return result.modules.includes("math") &&
        callCount(result, "math.sqrt") === 1 &&
        callCount(result, "print") === 1 &&
        printedSqrtResult &&
        result.output.trim() === expected
        ? { passed: true, message: "Your imported math function produced the answer." }
        : { passed: false, message: "Import math and print the result of the requested math.sqrt( ) call." };
    },
  },
  {
    id: "module-transfer",
    number: "11e",
    phase: "Transfer",
    title: "Select from a list",
    concept: "Transfer challenge · mastery proof 2 of 2",
    explanation:
      "Use a different module and data type together. Start blank and make random.choice select the value that gets printed.",
    mission: "Import random, set random.seed(4), and print random.choice([\"sun\", \"moon\", \"star\"]). Use one print().",
    starter: "",
    output: "print",
    hints: [
      "Import random before calling anything from it.",
      "Set the seed, then put random.choice with the three-item list inside print( ).",
    ],
    success: "Mastery proven: you transferred module use to a list-selection problem.",
    variants: [
      {
        kind: "custom",
        key: "module-random-primary",
        mission: "Import random, set random.seed(4), and print random.choice([\"sun\", \"moon\", \"star\"]). Use one print().",
        answer: `import random

random.seed(4)
print(random.choice(["sun", "moon", "star"]))`,
      },
      {
        kind: "custom",
        key: "module-random-fresh",
        mission: "Fresh challenge: import random, set random.seed(9), and print random.choice([\"fox\", \"owl\", \"turtle\"]).",
        answer: `import random

random.seed(9)
print(random.choice(["fox", "owl", "turtle"]))`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "module-random-fresh";
      const choices = fresh ? ["fox", "owl", "turtle"] : ["sun", "moon", "star"];
      const seed = fresh ? 9 : 4;
      const choiceCalls = executedCalls(result, "choice", "random").filter((call) =>
        Array.isArray(call.arguments[0]) &&
        call.arguments[0].length === choices.length &&
        call.arguments[0].every((choice, index) => choice === choices[index]),
      );
      const printedChoiceResult = choiceCalls.length === 1 &&
        executedCalls(result, "print", "builtins").some(
          (call) => callResultFlowsIntoArgument(result, choiceCalls[0], call, 0),
        );
      const usesSeed = executedCalls(result, "seed", "random").some(
        (call) => call.arguments[0] === seed,
      );
      return result.modules.includes("random") &&
        result.syntax.includes("List") &&
        callCount(result, "random.choice") === 1 &&
        callCount(result, "print") === 1 &&
        printedChoiceResult &&
        usesSeed &&
        choices.includes(result.output.trim())
        ? { passed: true, message: "Your imported function selected and printed one list item." }
        : { passed: false, message: "Import random, set the requested seed, and print its choice from the shown list." };
    },
  },
  {
    id: "module-boss",
    number: "11f",
    phase: "Boss",
    title: "Turn with math",
    concept: "A module calculation can control Turtle geometry",
    explanation:
      "Use math.pi and math.degrees to calculate a shape’s turn instead of typing the angle directly. The calculation must control the drawing.",
    mission: "Import math. Set sides = 5 and turn = math.degrees(2 * math.pi / sides). Use a for loop, one forward(60), and one right(turn) to draw a pentagon.",
    starter: "",
    hints: [
      "Calculate turn before the loop with math.degrees and math.pi.",
      "Loop over range(sides), then move 60 and turn by the calculated variable.",
    ],
    success: "Boss cleared: a module calculation controlled the whole shape.",
    variants: [
      {
        kind: "custom",
        key: "module-boss-primary",
        mission: "Import math. Set sides = 5 and turn = math.degrees(2 * math.pi / sides). Use a for loop, one forward(60), and one right(turn) to draw a pentagon.",
        answer: `import math

sides = 5
turn = math.degrees(2 * math.pi / sides)

for side in range(sides):
    forward(60)
    right(turn)`,
      },
      {
        kind: "custom",
        key: "module-boss-fresh",
        mission: "Fresh boss: use math.degrees(2 * math.pi / sides) with sides = 6, then draw a hexagon with one forward(50) and one right(turn).",
        answer: `import math

sides = 6
turn = math.degrees(2 * math.pi / sides)

for side in range(sides):
    forward(50)
    right(turn)`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "module-boss-fresh";
      const sides = fresh ? 6 : 5;
      const distance = fresh ? 50 : 60;
      const turn = 360 / sides;
      const degreeCalls = executedCalls(result, "degrees", "math");
      const rightCalls = executedCalls(result, "right");
      const usesCalculation = degreeCalls.length === 1 &&
        rightCalls.length === sides &&
        rightCalls.every(
          (call) =>
            typeof call.arguments[0] === "number" &&
            isExact(call.arguments[0], turn) &&
            callResultFlowsTo(result, call.argumentSources[0] ?? null, degreeCalls[0].id),
        );
      return result.modules.includes("math") &&
        callCount(result, "math.degrees") === 1 &&
        result.syntax.includes("For") &&
        callCount(result, "forward") === 1 &&
        callCount(result, "right") === 1 &&
        usesCalculation &&
        isRegularClosedShape(lineCommands(result), sides, distance, turn)
        ? { passed: true, message: "Your math calculation produced the exact polygon turn." }
        : { passed: false, message: "Calculate turn with math, then use that value inside one drawing loop." };
    },
  },
  {
    id: "finale-discover",
    number: "12a",
    phase: "Notice",
    title: "Discover ideas working together",
    concept: "Programs combine data, functions, parameters, and loops",
    explanation:
      "This short program stores data in a list, passes each item into a function, and calls that function from a loop. Larger programs grow from combinations like this.",
    mission: "Which Python ideas are working together? Choose an answer, then run the program.",
    starter: `def announce(word):
    print(word)

words = ["Ready", "Go!"]

for word in words:
    announce(word)`,
    readOnly: true,
    output: "print",
    question: {
      eyebrow: "Find the combination",
      prompt: "Which ideas does this program combine?",
      choices: [
        ["all", "A list, function, parameter, and loop"],
        ["only-print", "Only print"],
        ["while", "A while loop and module"],
      ],
      correct: "all",
      incorrect: "words is a list, announce is a function, word is a parameter, and for creates the loop.",
    },
    hints: [
      "Look at the square brackets, def line, and for line.",
      "The value moves from the list, through the loop, into the function.",
    ],
    success: "You identified how four Python ideas cooperate in one program.",
    check: (result) => result.syntax.includes("List") &&
      hasFunctionDefinition(result, "announce", ["word"], ["print"]) &&
      hasForIterable(result, "words", ["announce"]) &&
      printedLines(result.output).join("|") === "Ready|Go!"
      ? { passed: true, message: "Each idea handed work to the next one." }
      : { passed: false, message: "Keep the shown combined example unchanged." },
  },
  {
    id: "finale-understand",
    number: "12b",
    phase: "Understand",
    title: "Trace a combined drawing",
    concept: "Nested repetition multiplies the work",
    explanation:
      "draw_square makes four lines. The outer loop calls it twice, so Python completes one whole square and then repeats the function call.",
    mission: "Predict the total number of line segments before you run the drawing.",
    starter: `def draw_square(size):
    for side in range(4):
        forward(size)
        right(90)

for turn in range(2):
    draw_square(40)
    right(180)`,
    readOnly: true,
    question: {
      eyebrow: "Predict first",
      prompt: "How many line segments will Python draw?",
      choices: [["4", "4"], ["8", "8"], ["180", "180"]],
      correct: "8",
      incorrect: "Each square has four sides, and the outer loop draws two squares: 4 × 2 = 8.",
    },
    hints: [
      "First count the lines made by one draw_square call.",
      "Then multiply by the number of outer-loop repeats.",
    ],
    success: "You traced repetition across a function call and an outer loop.",
    check: (result) => hasFunctionDefinition(result, "draw_square", ["size"], ["forward", "right"]) &&
      hasRangeLoop(result, 2, ["draw_square", "right"]) &&
      isShapeRosette(result, 2, 4, 40, 180)
      ? { passed: true, message: "Two four-side calls produced eight line segments." }
      : { passed: false, message: "Keep the shown combined drawing unchanged." },
  },
  {
    id: "finale-guided",
    number: "12c",
    phase: "Practice",
    title: "Complete the rosette",
    concept: "Small ideas combine into a complete program",
    explanation:
      "This program combines a list, a function, a parameter, nested loops, and changing color. Two values are holding the flower back.",
    mission: "Draw 12 squares and turn 30° after each one to complete the rosette.",
    starter: `import turtle

colors = ["deepskyblue", "coral", "gold", "mediumseagreen"]

def draw_square(size):
    for side in range(4):
        turtle.forward(size)
        turtle.left(90)

for turn in range(4):
    turtle.pencolor(colors[turn % len(colors)])
    draw_square(75)
    turtle.left(90)`,
    hints: [
      "A full turn is 360°. Divide it into 12 equal turns.",
      "Use range(12) and turtle.left(30).",
    ],
    success: "You combined the foundations of Python into a colorful program of your own.",
    check: (result) => {
      const lines = lineCommands(result);
      const colors = new Set(lines.map((line) => line.color));
      return isShapeRosette(result, 12, 4, 75, 30) &&
        colors.size === 4 &&
        result.functions.includes("draw_square")
        ? { passed: true, message: "Trail complete—your rosette has 12 petals!" }
        : { passed: false, message: "You need 12 squares with a 30° turn between them." };
    },
  },
  {
    id: "finale-independent",
    number: "12d",
    phase: "Prove it",
    title: "Compose a drawing from scratch",
    concept: "Independent challenge · mastery proof 1 of 2",
    explanation:
      "Start blank and connect every idea yourself: a list, parameterized function, inner loop, and outer list loop.",
    mission: "Make a colors list with deepskyblue and coral. Define draw_square(size) with one forward() and one right(). Loop over colors to draw two 60-step squares, turning right(45) after each square.",
    starter: "",
    hints: [
      "Build and test draw_square(size) first, then create the colors list.",
      "Loop over colors: set pencolor, call draw_square(60), then turn 45° before the next item.",
    ],
    success: "Independent finale proof complete: you composed a multi-part Turtle program.",
    variants: [
      {
        kind: "custom",
        key: "finale-drawing-primary",
        mission: "Make a colors list with deepskyblue and coral. Define draw_square(size) with one forward() and one right(). Loop over colors to draw two 60-step squares, turning right(45) after each square.",
        answer: `import turtle

colors = ["deepskyblue", "coral"]

def draw_square(size):
    for side in range(4):
        turtle.forward(size)
        turtle.right(90)

for color in colors:
    turtle.pencolor(color)
    draw_square(60)
    turtle.right(45)`,
      },
      {
        kind: "custom",
        key: "finale-drawing-fresh",
        mission: "Fresh challenge: use gold, mediumseagreen, and coral. Define draw_triangle(size), then loop over colors to draw three 70-step triangles, turning right(120) after each.",
        answer: `import turtle

colors = ["gold", "mediumseagreen", "coral"]

def draw_triangle(size):
    for side in range(3):
        turtle.forward(size)
        turtle.right(120)

for color in colors:
    turtle.pencolor(color)
    draw_triangle(70)
    turtle.right(120)`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "finale-drawing-fresh";
      const name = fresh ? "draw_triangle" : "draw_square";
      const sides = fresh ? 3 : 4;
      const shapes = fresh ? 3 : 2;
      const distance = fresh ? 70 : 60;
      const between = fresh ? 120 : 45;
      const colors = fresh
        ? ["gold", "mediumseagreen", "coral"]
        : ["deepskyblue", "coral"];
      const expectedLineColors = colors.flatMap((color) => Array(sides).fill(color));
      return result.syntax.includes("List") &&
        hasFunctionDefinition(result, name, ["size"], ["forward", "right"]) &&
        hasForIterable(result, "colors", ["pencolor", name, "right"]) &&
        callCount(result, "forward") === 1 &&
        lineColorsMatch(result, expectedLineColors) &&
        isShapeRosette(result, shapes, sides, distance, between)
        ? { passed: true, message: "Your list, function, parameter, and loops built one composed drawing." }
        : { passed: false, message: "Combine the requested colors list, shape function, and outer loop in one program." };
    },
  },
  {
    id: "finale-transfer",
    number: "12e",
    phase: "Transfer",
    title: "Compose a non-Turtle program",
    concept: "Transfer challenge · mastery proof 2 of 2",
    explanation:
      "Prove the same composition works without drawing. Start blank and pass a list into a function that loops over its parameter.",
    mission: "Define announce(items) to loop over items with one print(). Create words = [\"Plan\", \"Build\", \"Share\"] and call announce(words).",
    starter: "",
    output: "print",
    hints: [
      "Inside announce(items), write a for loop that visits each item.",
      "After the function, create words as a list and pass words into announce( ).",
    ],
    success: "Finale mastery proven: you transferred a composed program beyond Turtle.",
    variants: [
      {
        kind: "custom",
        key: "finale-print-primary",
        mission: "Define announce(items) to loop over items with one print(). Create words = [\"Plan\", \"Build\", \"Share\"] and call announce(words).",
        answer: `def announce(items):
    for item in items:
        print(item)

words = ["Plan", "Build", "Share"]
announce(words)`,
      },
      {
        kind: "custom",
        key: "finale-print-fresh",
        mission: "Fresh challenge: define show(entries) to print each entry. Create steps = [\"Think\", \"Try\", \"Learn\"] and call show(steps).",
        answer: `def show(entries):
    for entry in entries:
        print(entry)

steps = ["Think", "Try", "Learn"]
show(steps)`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "finale-print-fresh";
      const name = fresh ? "show" : "announce";
      const parameter = fresh ? "entries" : "items";
      const expected = fresh ? "Think|Try|Learn" : "Plan|Build|Share";
      return result.syntax.includes("List") &&
        hasFunctionDefinition(result, name, [parameter], ["print"]) &&
        hasForIterable(result, parameter, ["print"]) &&
        callCount(result, name) === 1 &&
        callCount(result, "print") === 1 &&
        printedLines(result.output).join("|") === expected
        ? { passed: true, message: "Your function accepted and processed an entire list." }
        : { passed: false, message: `Define ${name} with the requested list parameter, then call it with the list.` };
    },
  },
  {
    id: "finale-boss",
    number: "12f",
    phase: "Final boss",
    title: "Build the final rosette",
    concept: "Create a complete program from an empty editor",
    explanation:
      "This is the full Turtle Trail finale. No starter code: combine imports, a color list, a parameterized shape function, and nested repetition.",
    mission: "Draw a 12-square rosette. Use four colors, draw_square(size) with one forward() and one right(), 75-step squares, and a 30° turn between squares.",
    starter: "",
    hints: [
      "First define draw_square(size) with a four-repeat loop. Then make a four-color list.",
      "Use an outer range(12) loop: choose colors[turn % len(colors)], call draw_square(75), and turn 30°.",
    ],
    success: "Final boss cleared: you independently combined the foundations of Python.",
    variants: [
      {
        kind: "custom",
        key: "finale-boss-primary",
        mission: "Draw a 12-square rosette. Use four colors, draw_square(size) with one forward() and one right(), 75-step squares, and a 30° turn between squares.",
        answer: `import turtle

colors = ["deepskyblue", "coral", "gold", "mediumseagreen"]

def draw_square(size):
    for side in range(4):
        turtle.forward(size)
        turtle.right(90)

for turn in range(12):
    turtle.pencolor(colors[turn % len(colors)])
    draw_square(75)
    turtle.right(30)`,
      },
      {
        kind: "custom",
        key: "finale-boss-fresh",
        mission: "Fresh final boss: draw an 8-triangle rosette. Use four colors, draw_triangle(size), 65-step triangles, and a 45° turn between triangles.",
        answer: `import turtle

colors = ["coral", "gold", "mediumseagreen", "deepskyblue"]

def draw_triangle(size):
    for side in range(3):
        turtle.forward(size)
        turtle.right(120)

for turn in range(8):
    turtle.pencolor(colors[turn % len(colors)])
    draw_triangle(65)
    turtle.right(45)`,
      },
    ],
    check: (result, _code, variant) => {
      const fresh = customKey(variant) === "finale-boss-fresh";
      const name = fresh ? "draw_triangle" : "draw_square";
      const shapes = fresh ? 8 : 12;
      const sides = fresh ? 3 : 4;
      const distance = fresh ? 65 : 75;
      const between = fresh ? 45 : 30;
      const colors = new Set(lineCommands(result).map((line) => line.color));
      return result.modules.includes("turtle") &&
        result.syntax.includes("List") &&
        hasFunctionDefinition(result, name, ["size"], ["forward", "right"]) &&
        hasRangeLoop(result, shapes, ["pencolor", name, "right"]) &&
        callCount(result, "forward") === 1 &&
        colors.size === 4 &&
        isShapeRosette(result, shapes, sides, distance, between)
        ? { passed: true, message: "Trail complete—your independent rosette combines every core idea!" }
        : { passed: false, message: "Combine the shape function, color list, and outer loop to build the full rosette." };
    },
  },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isStringArray = (value: unknown, maxItems = 200): value is string[] =>
  Array.isArray(value) &&
  value.length <= maxItems &&
  value.every((item) => typeof item === "string" && item.length <= 120);

const isForLoopAnalysis = (value: unknown): value is ForLoopAnalysis =>
  isRecord(value) &&
  (value.target === null || (typeof value.target === "string" && value.target.length <= 120)) &&
  (value.iterator === null || (typeof value.iterator === "string" && value.iterator.length <= 120)) &&
  (value.iterable === null || (typeof value.iterable === "string" && value.iterable.length <= 120)) &&
  Array.isArray(value.arguments) &&
  value.arguments.length <= 10 &&
  value.arguments.every(
    (argument) =>
      argument === null ||
      isFiniteNumber(argument) ||
      (typeof argument === "string" && argument.length <= 120),
  ) &&
  isStringArray(value.calls, 100);

const isFunctionDefAnalysis = (value: unknown): value is FunctionDefAnalysis =>
  isRecord(value) &&
  typeof value.name === "string" &&
  value.name.length <= 120 &&
  isStringArray(value.parameters, 20) &&
  isStringArray(value.calls, 100);

const isTraceValue = (value: unknown, depth = 0): value is TraceValue => {
  if (value === null || typeof value === "boolean" || isFiniteNumber(value)) return true;
  if (typeof value === "string") return value.length <= 1000;
  return depth < 3 &&
    Array.isArray(value) &&
    value.length <= 50 &&
    value.every((item) => isTraceValue(item, depth + 1));
};

const isCallSiteAnalysis = (value: unknown): value is CallSiteAnalysis =>
  isRecord(value) &&
  Number.isInteger(value.id) &&
  (value.id as number) >= 0 &&
  typeof value.name === "string" &&
  value.name.length <= 120 &&
  (value.scope === null || (typeof value.scope === "string" && value.scope.length <= 120)) &&
  isStringArray(value.assignedNames, 20) &&
  Array.isArray(value.argumentNames) &&
  value.argumentNames.length <= 20 &&
  value.argumentNames.every((names) => isStringArray(names, 20)) &&
  Array.isArray(value.argumentCalls) &&
  value.argumentCalls.length <= 20 &&
  value.argumentCalls.every(
    (id) => id === null || (Number.isInteger(id) && (id as number) >= 0),
  );

const isExecutedCallAnalysis = (value: unknown): value is ExecutedCallAnalysis =>
  isRecord(value) &&
  Number.isInteger(value.id) &&
  (value.id as number) >= 0 &&
  Number.isInteger(value.site) &&
  (value.site as number) >= 0 &&
  (value.name === null || (typeof value.name === "string" && value.name.length <= 120)) &&
  (value.module === null || (typeof value.module === "string" && value.module.length <= 120)) &&
  Array.isArray(value.arguments) &&
  value.arguments.length <= 20 &&
  value.arguments.every(isTraceValue) &&
  Array.isArray(value.argumentSources) &&
  value.argumentSources.length <= 20 &&
  value.argumentSources.every(
    (id) => id === null || (Number.isInteger(id) && (id as number) >= 0),
  ) &&
  (value.resultSource === null ||
    (Number.isInteger(value.resultSource) && (value.resultSource as number) >= 0));

const isTurtleCommand = (value: unknown): value is TurtleCommand => {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "bg") {
    return typeof value.color === "string" && value.color.length <= 100;
  }
  if (value.type === "line") {
    return (
      isFiniteNumber(value.x1) &&
      isFiniteNumber(value.y1) &&
      isFiniteNumber(value.x2) &&
      isFiniteNumber(value.y2) &&
      typeof value.color === "string" &&
      value.color.length <= 100 &&
      isFiniteNumber(value.width) &&
      value.width > 0
    );
  }
  if (value.type === "dot") {
    return (
      isFiniteNumber(value.x) &&
      isFiniteNumber(value.y) &&
      isFiniteNumber(value.size) &&
      value.size >= 0 &&
      typeof value.color === "string" &&
      value.color.length <= 100
    );
  }
  if (value.type === "text") {
    return (
      isFiniteNumber(value.x) &&
      isFiniteNumber(value.y) &&
      typeof value.text === "string" &&
      value.text.length <= 120 &&
      typeof value.color === "string" &&
      value.color.length <= 100
    );
  }
  return false;
};

const isRunResultMessage = (value: unknown): value is RunResultMessage => {
  if (!isRecord(value) || value.type !== "result" || !Number.isInteger(value.id)) return false;
  if (
    !Array.isArray(value.commands) ||
    value.commands.length > 2501 ||
    !value.commands.every(isTurtleCommand) ||
    typeof value.output !== "string" ||
    value.output.length > 12000 ||
    !(value.error === null || (typeof value.error === "string" && value.error.length <= 20000)) ||
    !isRecord(value.globals) ||
    !isStringArray(value.functions) ||
    !isStringArray(value.modules) ||
    !isStringArray(value.syntax) ||
    !isRecord(value.analysis) ||
    !isStringArray(value.analysis.calls, 500) ||
    !Array.isArray(value.analysis.callSites) ||
    value.analysis.callSites.length > 500 ||
    !value.analysis.callSites.every(isCallSiteAnalysis) ||
    !Array.isArray(value.analysis.executedCalls) ||
    value.analysis.executedCalls.length > 2500 ||
    !value.analysis.executedCalls.every(isExecutedCallAnalysis) ||
    !Array.isArray(value.analysis.forLoops) ||
    value.analysis.forLoops.length > 100 ||
    !value.analysis.forLoops.every(isForLoopAnalysis) ||
    !Array.isArray(value.analysis.functionDefs) ||
    value.analysis.functionDefs.length > 100 ||
    !value.analysis.functionDefs.every(isFunctionDefAnalysis) ||
    !isRecord(value.state)
  ) {
    return false;
  }
  return (
    isFiniteNumber(value.state.x) &&
    isFiniteNumber(value.state.y) &&
    isFiniteNumber(value.state.heading) &&
    typeof value.state.color === "string" &&
    value.state.color.length <= 100 &&
    isFiniteNumber(value.state.width) &&
    value.state.width > 0
  );
};

const lessonGroup = (lesson: Lesson) => {
  if (typeof lesson.number !== "string") return null;
  return lesson.number.match(/^(\d+)[a-f]$/)?.[1] ?? null;
};

const isStructuredLesson = (lesson: Lesson) => lessonGroup(lesson) !== null;

const reachableLessonIndex = (completedIds: string[]) => {
  const completed = new Set(completedIds);
  const firstIncomplete = LESSONS.findIndex((lesson) => !completed.has(lesson.id));
  return firstIncomplete === -1 ? LESSONS.length - 1 : firstIncomplete;
};

const STORAGE_KEY = "turtle-trail-progress-v1";

const getGridStep = (scale: number) => {
  const roughStep = 62 / scale;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const multiplier = normalized < 1.5 ? 1 : normalized < 3.5 ? 2 : normalized < 7.5 ? 5 : 10;
  return multiplier * magnitude;
};

const formatCoordinate = (value: number) =>
  Math.abs(value) < 0.0001 ? "0" : Number(value.toFixed(4)).toString();

const drawCoordinatePlane = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  originX: number,
  originY: number,
  scale: number,
) => {
  const majorStep = getGridStep(scale);
  const minorStep = majorStep / 5;
  const minX = -originX / scale;
  const maxX = (width - originX) / scale;
  const minY = (originY - height) / scale;
  const maxY = originY / scale;

  const drawGrid = (step: number, color: string, lineWidth: number) => {
    context.beginPath();
    for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
      const canvasX = originX + x * scale;
      context.moveTo(canvasX, 0);
      context.lineTo(canvasX, height);
    }
    for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
      const canvasY = originY - y * scale;
      context.moveTo(0, canvasY);
      context.lineTo(width, canvasY);
    }
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.stroke();
  };

  context.save();
  drawGrid(minorStep, "rgba(0, 158, 73, 0.07)", 1);
  drawGrid(majorStep, "rgba(0, 158, 73, 0.17)", 1);

  context.beginPath();
  context.moveTo(0, originY);
  context.lineTo(width, originY);
  context.moveTo(originX, 0);
  context.lineTo(originX, height);
  context.strokeStyle = "rgba(24, 91, 53, 0.48)";
  context.lineWidth = 1.4;
  context.stroke();

  context.fillStyle = "#527060";
  context.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  const xLabelsAbove = originY > height - 28;
  context.textBaseline = xLabelsAbove ? "bottom" : "top";
  for (let x = Math.ceil(minX / majorStep) * majorStep; x <= maxX; x += majorStep) {
    if (Math.abs(x) < 0.0001) continue;
    const canvasX = originX + x * scale;
    context.fillText(formatCoordinate(x), canvasX, originY + (xLabelsAbove ? -14 : 14));
  }

  const yLabelsLeft = originX > width - 42;
  context.textAlign = yLabelsLeft ? "right" : "left";
  context.textBaseline = "middle";
  for (let y = Math.ceil(minY / majorStep) * majorStep; y <= maxY; y += majorStep) {
    if (Math.abs(y) < 0.0001) continue;
    const canvasY = originY - y * scale;
    context.fillText(formatCoordinate(y), originX + (yLabelsLeft ? -16 : 16), canvasY);
  }

  context.textAlign = "left";
  context.textBaseline = "bottom";
  context.fillText("0", originX + 6, originY - 5);
  context.font = "800 11px ui-rounded, system-ui";
  context.fillStyle = "#28613f";
  context.fillText("x", width - 15, originY - 7);
  context.fillText("y", originX + 8, 15);

  const scaleLabel = `${formatCoordinate(minorStep)} units / small square`;
  context.font = "700 10px ui-rounded, system-ui";
  const labelWidth = context.measureText(scaleLabel).width + 16;
  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.fillRect(width - labelWidth - 9, 8, labelWidth, 24);
  context.strokeStyle = "rgba(0, 158, 73, 0.24)";
  context.lineWidth = 1;
  context.strokeRect(width - labelWidth - 9, 8, labelWidth, 24);
  context.fillStyle = "#37634a";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(scaleLabel, width - labelWidth / 2 - 9, 20);

  context.strokeStyle = "rgba(0, 158, 73, 0.3)";
  context.lineWidth = 1;
  context.strokeRect(0.5, 0.5, width - 1, height - 1);
  context.restore();
};

function TurtleCanvas({
  commands,
  animationKey,
  turtleState,
  animationDuration,
  onStepChange,
}: {
  commands: TurtleCommand[];
  animationKey: number;
  turtleState: RunResult["state"] | null;
  animationDuration?: number;
  onStepChange?: (step: number | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lineCount = commands.filter((command) => command.type === "line").length;
  const dotCount = commands.filter((command) => command.type === "dot").length;
  const colors = new Set(
    commands
      .filter((command): command is TurtleLine | TurtleDot | TurtleText => command.type !== "bg")
      .map((command) => command.color),
  );
  const drawingSummary =
    lineCount || dotCount
      ? `Turtle drawing with ${lineCount} line segments, ${dotCount} dots, and ${colors.size} colors.`
      : "Blank Turtle canvas, ready for a drawing.";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let animationFrame = 0;
    let resizeFrame = 0;
    let startedAt = performance.now();
    let reportedStep: number | null = null;
    const drawable = commands.filter((command) => command.type !== "bg");
    const duration = animationDuration ?? Math.min(1500, Math.max(450, drawable.length * 38));
    onStepChange?.(null);

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(bounds.width * pixelRatio));
      const height = Math.max(1, Math.floor(bounds.height * pixelRatio));
      if (canvas.width === width && canvas.height === height) return false;
      canvas.width = width;
      canvas.height = height;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      return true;
    };

    const draw = (timestamp: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const background = [...commands]
        .reverse()
        .find((command): command is TurtleBackground => command.type === "bg")?.color ?? "#ffffff";

      context.clearRect(0, 0, width, height);
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      const turtleMovedWithoutDrawing =
        turtleState !== null && (!isNear(turtleState.x, 0) || !isNear(turtleState.y, 0));
      const points = drawable.flatMap((command) => {
        if (command.type === "line") return [[command.x1, command.y1], [command.x2, command.y2]];
        return [[command.x, command.y]];
      });
      if (turtleState) points.push([turtleState.x, turtleState.y]);
      const xs = points.map((point) => point[0]);
      const ys = points.map((point) => point[1]);
      const minX = Math.min(0, ...xs);
      const maxX = Math.max(0, ...xs);
      const minY = Math.min(0, ...ys);
      const maxY = Math.max(0, ...ys);
      const spanX = Math.max(120, maxX - minX);
      const spanY = Math.max(120, maxY - minY);
      const scale = Math.min(1.25, (width - 70) / spanX, (height - 70) / spanY);
      const originX = width / 2 - ((minX + maxX) / 2) * scale;
      const originY = height / 2 + ((minY + maxY) / 2) * scale;
      const mapX = (x: number) => originX + x * scale;
      const mapY = (y: number) => originY - y * scale;

      drawCoordinatePlane(context, width, height, originX, originY, scale);

      if (drawable.length === 0 && !turtleMovedWithoutDrawing) {
        context.beginPath();
        context.roundRect(width / 2 - 132, height / 2 - 62, 264, 104, 18);
        context.fillStyle = "rgba(255, 255, 255, 0.94)";
        context.fill();
        context.strokeStyle = "rgba(0, 158, 73, 0.2)";
        context.lineWidth = 1;
        context.stroke();
        context.font = "34px system-ui";
        context.textAlign = "center";
        context.fillText("🐢", width / 2, height / 2 - 17);
        context.font = "600 15px ui-rounded, system-ui";
        context.fillStyle = "#64716a";
        context.fillText("Run your code to make a trail", width / 2, height / 2 + 23);
        return;
      }

      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const visibleCount = progress * drawable.length;
      const nextStep = drawable.length > 0
        ? Math.min(drawable.length - 1, Math.floor(visibleCount))
        : null;
      if (nextStep !== reportedStep) {
        reportedStep = nextStep;
        onStepChange?.(nextStep);
      }
      let turtleX = 0;
      let turtleY = 0;

      drawable.forEach((command, index) => {
        if (index > visibleCount) return;
        const partial = Math.min(1, Math.max(0, visibleCount - index));
        if (command.type === "line") {
          const endX = command.x1 + (command.x2 - command.x1) * partial;
          const endY = command.y1 + (command.y2 - command.y1) * partial;
          context.beginPath();
          context.moveTo(mapX(command.x1), mapY(command.y1));
          context.lineTo(mapX(endX), mapY(endY));
          context.strokeStyle = command.color;
          context.lineWidth = Math.max(2, command.width * scale);
          context.lineCap = "round";
          context.lineJoin = "round";
          context.stroke();
          turtleX = endX;
          turtleY = endY;
        } else if (command.type === "dot" && partial > 0) {
          context.beginPath();
          context.arc(mapX(command.x), mapY(command.y), (command.size * scale) / 2, 0, Math.PI * 2);
          context.fillStyle = command.color;
          context.fill();
          turtleX = command.x;
          turtleY = command.y;
        } else if (command.type === "text" && partial > 0) {
          context.font = "600 15px ui-rounded, system-ui";
          context.fillStyle = command.color;
          context.fillText(command.text, mapX(command.x), mapY(command.y));
          turtleX = command.x;
          turtleY = command.y;
        }
      });

      if (progress >= 1 && turtleState) {
        turtleX = turtleState.x;
        turtleY = turtleState.y;
      }
      context.font = "24px system-ui";
      context.textAlign = "center";
      context.fillText("🐢", mapX(turtleX), mapY(turtleY) + 7);
      if (progress < 1) animationFrame = requestAnimationFrame(draw);
    };

    resize();
    animationFrame = requestAnimationFrame(draw);
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!resize()) return;
        cancelAnimationFrame(animationFrame);
        startedAt = performance.now() - duration;
        animationFrame = requestAnimationFrame(draw);
      });
    });
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(animationFrame);
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
    };
  }, [animationDuration, commands, animationKey, onStepChange, turtleState]);

  return (
    <canvas
      ref={canvasRef}
      className="turtle-canvas"
      role="img"
      aria-label={drawingSummary}
    />
  );
}

export function TurtleCourse() {
  const { user, sessionStatus } = useAccount();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [variants, setVariants] = useState<Record<string, number>>({});
  const [revealed, setRevealed] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<"loading" | "ready" | "error">("loading");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [feedback, setFeedback] = useState<CheckResult | null>(null);
  const [visibleHints, setVisibleHints] = useState(0);
  const [animationKey, setAnimationKey] = useState(0);
  const [activeIteration, setActiveIteration] = useState<number | null>(null);
  const [savePromptRequest, setSavePromptRequest] = useState(0);
  const [victoryBurst, setVictoryBurst] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const workerGenerationRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef(0);
  const runningRef = useRef(false);
  const pendingRef = useRef<PendingRun | null>(null);
  const lessonListRef = useRef<HTMLElement>(null);
  const currentLessonRef = useRef<HTMLButtonElement>(null);

  const lesson = LESSONS[currentIndex];
  const variantIndex = Math.min(variants[lesson.id] ?? 0, (lesson.variants?.length ?? 1) - 1);
  const variant = lesson.variants?.[variantIndex];
  const starter = variant ? "" : lesson.starter;
  const code = drafts[lesson.id] ?? starter;
  const mission = variant?.mission ?? lesson.mission;
  const completedSet = useMemo(() => new Set(completed), [completed]);
  const revealedSet = useMemo(() => new Set(revealed), [revealed]);
  const unlocked = reachableLessonIndex(completed);
  const structuredLesson = isStructuredLesson(lesson);
  const currentGroup = lessonGroup(lesson);
  const masteryIds = currentGroup ? MASTERY_IDS[currentGroup] : undefined;
  const currentAnswer = answers[lesson.id] ?? null;
  const awaitingFreshVariant = Boolean(
    variant &&
    variantIndex === 0 &&
    revealedSet.has(lesson.id) &&
    !completedSet.has(lesson.id),
  );
  const quizReady = !lesson.question || currentAnswer !== null;
  const conceptMasteryComplete = Boolean(
    masteryIds && masteryIds.every((id) => completedSet.has(id)),
  );
  const isMasteryProof = Boolean(masteryIds?.includes(lesson.id));
  const firstLessonComplete = completedSet.has(LESSONS[0].id);
  const signInRequired = firstLessonComplete && sessionStatus !== "loading" && !user;
  const progress = Math.round((completed.length / LESSONS.length) * 100);
  const savedProgress = useMemo<CourseProgress>(() => {
    const syncedDrafts = { ...drafts };
    revealed.forEach((id) => {
      syncedDrafts[`${ANSWER_STATE_PREFIX}${id}`] = variants[id] === 1 ? "fresh" : "revealed";
    });
    return { completed, unlocked, current: currentIndex, drafts: syncedDrafts };
  }, [completed, currentIndex, drafts, revealed, unlocked, variants]);
  const mergeRemoteProgress = useCallback((remote: CourseProgress) => {
    const lessonIds = new Set(LESSONS.map((item) => item.id));
    const remoteCompleted = remote.completed.filter((id) => lessonIds.has(id));
    const remoteUnlocked = reachableLessonIndex(remoteCompleted);
    const remoteCurrent = Math.max(0, Math.min(remote.current, remoteUnlocked));
    const remoteDrafts: Record<string, string> = {};
    const remoteRevealed: string[] = [];
    const remoteFreshVariants: string[] = [];
    Object.entries(remote.drafts).forEach(([id, draft]) => {
      if (lessonIds.has(id)) {
        remoteDrafts[id] = draft.slice(0, 20000);
        return;
      }
      if (!id.startsWith(ANSWER_STATE_PREFIX)) return;
      const lessonId = id.slice(ANSWER_STATE_PREFIX.length);
      if (!lessonIds.has(lessonId) || (draft !== "revealed" && draft !== "fresh")) return;
      remoteRevealed.push(lessonId);
      if (draft === "fresh") remoteFreshVariants.push(lessonId);
    });
    setCompleted((previous) => {
      const merged = new Set([...remoteCompleted, ...previous]);
      return LESSONS.map((item) => item.id).filter((id) => merged.has(id));
    });
    setCurrentIndex((previous) => Math.max(previous, remoteCurrent));
    setDrafts((previous) => ({ ...remoteDrafts, ...previous }));
    setRevealed((previous) => [...new Set([...remoteRevealed, ...previous])]);
    setVariants((previous) => {
      const merged = { ...previous };
      remoteFreshVariants.forEach((id) => { merged[id] = 1; });
      return merged;
    });
  }, []);
  const syncStatus = useCourseProgressSync({
    course: "turtle-basics",
    hydrated,
    progress: savedProgress,
    mergeRemoteProgress,
  });

  const bootWorker = useCallback(() => {
    const generation = workerGenerationRef.current + 1;
    workerGenerationRef.current = generation;
    runIdRef.current += 1;
    runningRef.current = false;
    pendingRef.current = null;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    workerRef.current?.terminate();
    setRuntimeStatus("loading");
    const worker = new Worker("/python-worker.mjs", { type: "module" });
    workerRef.current = worker;

    const isCurrentWorker = () =>
      workerGenerationRef.current === generation && workerRef.current === worker;

    const handleWorkerFailure = () => {
      if (!isCurrentWorker()) return;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      runningRef.current = false;
      pendingRef.current = null;
      setRuntimeStatus("error");
      setRunning(false);
      setFeedback({ passed: false, message: "Python could not start. Refresh the page and try once more." });
    };

    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (!isCurrentWorker() || !isRecord(event.data)) return;
      const message = event.data;
      if (message.type === "status") {
        if (message.status === "loading" || message.status === "ready") {
          setRuntimeStatus(message.status);
        }
        return;
      }
      if (message.type === "fatal") {
        if (typeof message.error === "string") handleWorkerFailure();
        return;
      }
      if (message.type === "result") {
        if (!isRunResultMessage(message)) return;
        if (message.id !== runIdRef.current) return;
        const pending = pendingRef.current;
        if (!pending) return;
        pendingRef.current = null;
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        runningRef.current = false;
        setRunning(false);
        setResult(message);
        setAnimationKey((key) => key + 1);

        const activeLesson = LESSONS[pending.lessonIndex];
        const activeVariant = activeLesson.variants?.[pending.variantIndex];
        let verdict = message.error
          ? { passed: false, message: "Python found something to fix. Read the message under the output." }
          : activeLesson.check(message, pending.code, activeVariant);
        if (
          !message.error &&
          activeLesson.question &&
          pending.answer !== activeLesson.question.correct
        ) {
          verdict = { passed: false, message: activeLesson.question.incorrect };
        }
        setFeedback(verdict);

        if (verdict.passed) {
          if (pending.lessonIndex === 0) {
            setSavePromptRequest((request) => request + 1);
          }
          if (pending.lessonIndex === LESSONS.length - 1) {
            setVictoryBurst((burst) => burst + 1);
          }
          setCompleted((previous) =>
            previous.includes(activeLesson.id) ? previous : [...previous, activeLesson.id],
          );
        }
      }
    };

    worker.onerror = handleWorkerFailure;
    worker.onmessageerror = handleWorkerFailure;
  }, []);

  useEffect(() => {
    const restoreProgress = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const progressData: unknown = JSON.parse(saved);
          if (!isRecord(progressData)) throw new Error("Invalid saved progress");
          const lessonIds = new Set(LESSONS.map((item) => item.id));
          const savedCompleted = Array.isArray(progressData.completed)
            ? new Set(progressData.completed.filter(
                (id): id is string => typeof id === "string" && lessonIds.has(id),
              ))
            : new Set<string>();
          const restoredCompleted = LESSONS.map((item) => item.id).filter((id) => savedCompleted.has(id));
          const restoredUnlocked = reachableLessonIndex(restoredCompleted);
          const restoredCurrent =
            typeof progressData.current === "number" && Number.isInteger(progressData.current)
              ? Math.max(0, Math.min(progressData.current, restoredUnlocked))
              : 0;
          const restoredDrafts: Record<string, string> = {};
          if (isRecord(progressData.drafts)) {
            Object.entries(progressData.drafts).forEach(([id, draft]) => {
              if (lessonIds.has(id) && typeof draft === "string") {
                restoredDrafts[id] = draft.slice(0, 20000);
              }
            });
          }
          const restoredVariants: Record<string, number> = {};
          if (isRecord(progressData.variants)) {
            Object.entries(progressData.variants).forEach(([id, value]) => {
              if (lessonIds.has(id) && value === 1) restoredVariants[id] = 1;
            });
          }
          const restoredRevealed = Array.isArray(progressData.revealed)
            ? [...new Set(progressData.revealed.filter(
                (id): id is string => typeof id === "string" && lessonIds.has(id),
              ))]
            : [];
          setCompleted(restoredCompleted);
          setCurrentIndex(restoredCurrent);
          setDrafts(restoredDrafts);
          setVariants(restoredVariants);
          setRevealed(restoredRevealed);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
      setHydrated(true);
    }, 0);
    const startPython = window.setTimeout(bootWorker, 0);
    return () => {
      window.clearTimeout(restoreProgress);
      window.clearTimeout(startPython);
      workerRef.current?.terminate();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [bootWorker]);

  useEffect(() => {
    if (!hydrated) return;
    const progressData: SavedProgress = {
      completed,
      unlocked,
      current: currentIndex,
      drafts,
      variants,
      revealed,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progressData));
    } catch {
      // Learning still works when storage is unavailable; only persistence is skipped.
    }
  }, [completed, currentIndex, drafts, hydrated, revealed, unlocked, variants]);

  useEffect(() => {
    if (!hydrated || sessionStatus === "loading" || user || currentIndex === 0) return;
    const returnToFirstLesson = window.setTimeout(() => {
      setCurrentIndex(0);
      setResult(null);
      setFeedback(null);
    }, 0);
    return () => window.clearTimeout(returnToFirstLesson);
  }, [currentIndex, hydrated, sessionStatus, user]);

  useEffect(() => {
    const list = lessonListRef.current;
    const current = currentLessonRef.current;
    if (!list || !current) return;
    const overflowsHorizontally = list.scrollWidth > list.clientWidth;
    const overflowsVertically = list.scrollHeight > list.clientHeight;
    if (!overflowsHorizontally && !overflowsVertically) return;
    current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [currentIndex, hydrated]);

  const chooseLesson = (index: number) => {
    if (running || index > unlocked || (index > 0 && !user)) return;
    runIdRef.current += 1;
    pendingRef.current = null;
    runningRef.current = false;
    setCurrentIndex(index);
    setResult(null);
    setFeedback(null);
    setVisibleHints(0);
    setActiveIteration(null);
  };

  const updateCode = (nextCode: string) => {
    if (lesson.readOnly) return;
    setDrafts((previous) => ({ ...previous, [lesson.id]: nextCode }));
    if (feedback) setFeedback(null);
  };

  const resetLesson = () => {
    setDrafts((previous) => ({ ...previous, [lesson.id]: starter }));
    setResult(null);
    setFeedback(null);
    setVisibleHints(0);
    setActiveIteration(null);
  };

  const runCode = useCallback(() => {
    if (!workerRef.current || runtimeStatus !== "ready" || runningRef.current || !quizReady) return;
    if (currentIndex > 0 && !user) {
      setSavePromptRequest((request) => request + 1);
      return;
    }
    if (awaitingFreshVariant) {
      setFeedback({ passed: false, message: "Start the fresh variant before this challenge can count." });
      return;
    }
    if (code.length > 20000) {
      setFeedback({ passed: false, message: "That program is a little too long. Keep it under 20,000 characters." });
      return;
    }
    const nextId = runIdRef.current + 1;
    runIdRef.current = nextId;
    runningRef.current = true;
    pendingRef.current = { lessonIndex: currentIndex, code, variantIndex, answer: currentAnswer };
    setRunning(true);
    setFeedback(null);
    setResult(null);
    setActiveIteration(null);
    workerRef.current.postMessage({ type: "run", id: nextId, code });
    timeoutRef.current = setTimeout(() => {
      runningRef.current = false;
      pendingRef.current = null;
      setRunning(false);
      setFeedback({ passed: false, message: structuredLesson ? "That ran too long. Check the loop or stopping condition." : "That ran for too long. Check whether a while loop can ever stop." });
      bootWorker();
    }, 5000);
  }, [
    awaitingFreshVariant,
    bootWorker,
    code,
    currentIndex,
    currentAnswer,
    quizReady,
    runtimeStatus,
    structuredLesson,
    user,
    variantIndex,
  ]);

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      runCode();
      return;
    }
    if (event.key === "Escape") {
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Tab" && !event.shiftKey && !lesson.readOnly) {
      event.preventDefault();
      const target = event.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const next = `${code.slice(0, start)}    ${code.slice(end)}`;
      updateCode(next);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 4;
      });
    }
  };

  const revealHint = () => setVisibleHints((count) => Math.min(lesson.hints.length, count + 1));
  const revealAnswer = () => {
    if (!variant || revealedSet.has(lesson.id) || completedSet.has(lesson.id)) return;
    setRevealed((previous) => previous.includes(lesson.id) ? previous : [...previous, lesson.id]);
    setFeedback(null);
  };
  const startFreshVariant = () => {
    if (!lesson.variants || lesson.variants.length < 2) return;
    setVariants((previous) => ({ ...previous, [lesson.id]: 1 }));
    setDrafts((previous) => ({ ...previous, [lesson.id]: "" }));
    setResult(null);
    setFeedback(null);
    setVisibleHints(0);
    setActiveIteration(null);
  };
  const handleAnimationStep = useCallback((step: number | null) => {
    setActiveIteration(step);
  }, []);
  const goNext = () => currentIndex < LESSONS.length - 1 && chooseLesson(currentIndex + 1);
  const completeCourse = LESSONS.every((item) => completedSet.has(item.id));

  return (
    <main className="course-shell">
      <header className="course-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><Turtle /></span>
          <div>
            <p className="brand-name">Turtle Trail</p>
            <p className="brand-subtitle">Learn real Python by drawing</p>
          </div>
        </div>

        <div className="header-progress" aria-label={`${completed.length} of ${LESSONS.length} learning steps complete`}>
          <div className="progress-copy"><span>{completed.length} of {LESSONS.length} steps</span><span>{progress}%</span></div>
          <Progress value={progress} className="course-progress" />
        </div>

        <div className="header-actions">
          {completeCourse && user ? (
            <Link className="course-link clock-quest-link" href="/clock">
              <Clock3 /> Clock Quest
            </Link>
          ) : (
            <span className="course-link clock-quest-link locked" aria-label="Clock Quest unlocks after every Turtle Trail lesson and mastery challenge">
              <LockKeyhole /> Clock Quest
            </span>
          )}
          <div className={`runtime-pill ${runtimeStatus}`} role="status" aria-live="polite">
            <span className="status-dot" />
            {runtimeStatus === "ready" ? "Python ready" : runtimeStatus === "loading" ? "Warming up Python…" : "Python needs a refresh"}
          </div>
          <AccountControl
            returnTo="/"
            syncStatus={syncStatus}
            celebrateFirstLesson={signInRequired}
            openRequest={savePromptRequest}
          />
        </div>
      </header>

      <div className="course-layout">
        <aside className="lesson-rail" aria-label="Python lessons">
          <div className="rail-heading"><span>Your trail</span><span>{progress}%</span></div>
          <nav ref={lessonListRef} className="lesson-list">
            {LESSONS.map((item, index) => {
              const isCurrent = index === currentIndex;
              const isComplete = completedSet.has(item.id);
              const isSignInLocked = index > 0 && !user;
              const isLocked = index > unlocked || isSignInLocked;
              const isSubtopic = isStructuredLesson(item);
              return (
                <button
                  ref={isCurrent ? currentLessonRef : undefined}
                  key={item.id}
                  type="button"
                  className={`lesson-link ${isSubtopic ? "loop-subtopic" : ""} ${isCurrent ? "current" : ""} ${isComplete ? "complete" : ""} ${index === 1 && isSignInLocked ? "sign-in-gate" : ""}`}
                  onClick={() => chooseLesson(index)}
                  disabled={isLocked || running}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <span className="lesson-state" aria-hidden="true">
                    {isComplete ? <Check /> : isLocked ? <LockKeyhole /> : isSubtopic ? <Repeat2 /> : <Circle />}
                  </span>
                  <span>
                    <span className="lesson-number">Lesson {item.number}</span>
                    <span className="lesson-title">{item.title}</span>
                    {index === 1 && isSignInLocked && <span className="lesson-lock-reason">Sign in to unlock</span>}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="lesson-workspace">
          <div className={`lesson-intro ${structuredLesson ? "loops-intro" : ""}`}>
            <div className="lesson-kicker">Lesson {lesson.number} · {lesson.phase ?? lesson.concept}</div>
            <div className={structuredLesson ? "loops-title-row" : undefined}>
              <div>
                <h1>{lesson.title}</h1>
                <p>{lesson.explanation}</p>
              </div>
              {isMasteryProof && (
                <div className="mastery-proof-badge"><ShieldCheck /><span>Mastery<br />proof</span></div>
              )}
            </div>
            <div className="mission-card"><span className="mission-label">Your mission</span><strong>{mission}</strong></div>
            {variantIndex > 0 && (
              <div className="fresh-variant-note" role="status"><Repeat2 /> Fresh variant active—solve this one without the revealed answer.</div>
            )}
            {structuredLesson && masteryIds && (
              <div className={`mastery-meter loop-mastery-meter ${conceptMasteryComplete ? "complete" : ""}`}>
                <ShieldCheck aria-hidden="true" />
                <span><strong>{conceptMasteryComplete ? `Lesson ${currentGroup} mastery proven` : "Mastery needs two proofs"}</strong><small>Lesson {currentGroup}d independent + {currentGroup}e transfer</small></span>
              </div>
            )}
          </div>

          {lesson.question && (
            <section className="loop-question-card" aria-labelledby={`lesson-question-${lesson.id}`}>
              <div><span className="question-step">{lesson.question.eyebrow}</span><strong id={`lesson-question-${lesson.id}`}>{lesson.question.prompt}</strong></div>
              <div className="loop-choice-grid" role="radiogroup" aria-labelledby={`lesson-question-${lesson.id}`}>
                {lesson.question.choices.map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={currentAnswer === value} className={`loop-choice ${currentAnswer === value ? "selected" : ""}`} onClick={() => { setAnswers((previous) => ({ ...previous, [lesson.id]: value })); setFeedback(null); }}>
                    <span>{currentAnswer === value ? <Check /> : <Circle />}</span>{label}
                  </button>
                ))}
              </div>
              <span className="prediction-lock">Your choice is recorded before Python runs.</span>
            </section>
          )}

          <div className={`practice-grid ${structuredLesson ? "loops-practice-grid" : ""}`}>
            <section className="code-panel" aria-label="Python code editor">
              <div className="panel-bar code-bar">
                <div className="panel-title"><span className="traffic-lights" aria-hidden="true"><i /><i /><i /></span>lesson_{String(lesson.number).padStart(2, "0")}.py</div>
                <Button type="button" variant="ghost" size="sm" className="reset-button" onClick={resetLesson} disabled={running || lesson.readOnly}><RotateCcw /> Reset</Button>
              </div>
              <PythonEditor
                value={code}
                onChange={updateCode}
                onKeyDown={handleEditorKeyDown}
                disabled={running}
                readOnly={lesson.readOnly}
                ariaLabel={`Code editor for lesson ${lesson.number}${lesson.readOnly ? ", read only" : ""}`}
                ariaDescribedBy="editor-keyboard-help"
                className={lesson.readOnly ? "loops-readonly-editor" : ""}
              />
              <div className="editor-actions">
                <span className="shortcut"><kbd>Ctrl/⌘</kbd><kbd>Enter</kbd> run · <kbd>Tab</kbd> indent</span>
                <span id="editor-keyboard-help" className="sr-only">
                  Press Tab to indent, Escape to leave the code editor, and Control or Command plus Enter to run. Discovery and understanding examples are read only.
                </span>
                <Button type="button" size="lg" className={`run-button ${structuredLesson ? "loops-run-button" : ""}`} onClick={runCode} disabled={runtimeStatus !== "ready" || running || !quizReady || awaitingFreshVariant}>
                  <Play fill="currentColor" />
                  {running ? "Running…" : !quizReady ? "Choose first" : awaitingFreshVariant ? "Fresh challenge required" : structuredLesson ? "Run Python" : "Run my code"}
                </Button>
              </div>
            </section>

            <section className={`output-panel ${structuredLesson ? "loops-output-panel" : ""}`} aria-label={lesson.output === "print" ? "Printed Python output" : "Turtle output"}>
              <div className="panel-bar">
                <div className="panel-title">{lesson.output === "print" ? <Terminal /> : <Turtle />} {lesson.output === "print" ? "Printed output" : "Turtle canvas"}</div>
                <span className="canvas-status">{running ? "Python is running…" : lesson.output === "print" ? "stdout" : "x / y coordinates"}</span>
              </div>

              {lesson.id === "loop-understand" && (
                <div className="iteration-trace" aria-label="Loop iteration values" aria-live="polite">
                  <span className="trace-label">Loop variable</span>
                  {[0, 1, 2, 3].map((step) => (
                    <span key={step} className={`iteration-chip ${activeIteration === step ? "active" : ""}`}>step = {step}</span>
                  ))}
                  <strong>{activeIteration === null ? "Run to watch each step" : `Running forward(50) with step = ${activeIteration}`}</strong>
                </div>
              )}

              {lesson.output === "print" ? (
                <div className="loop-console-stage">
                  {result?.output ? (
                    <pre aria-label="Program printed output">{result.output}</pre>
                  ) : (
                    <div className="console-placeholder"><Terminal /><strong>Nothing printed yet</strong><span>Run your code to fill this console.</span></div>
                  )}
                </div>
              ) : (
                <div className={`canvas-wrap turtle-canvas-wrap ${feedback ? "has-feedback" : ""}`}>
                  <TurtleCanvas
                    commands={result?.commands ?? []}
                    animationKey={animationKey}
                    turtleState={result?.state ?? null}
                    animationDuration={lesson.id === "loop-understand" ? 3000 : undefined}
                    onStepChange={lesson.id === "loop-understand" ? handleAnimationStep : undefined}
                  />
                </div>
              )}
              {feedback && (
                <div className={`feedback-card ${structuredLesson ? "loops-feedback" : "turtle-feedback"} ${feedback.passed ? "passed" : "try-again"}`} role="status">
                  <span className="feedback-icon">{feedback.passed ? <Check /> : <Lightbulb />}</span>
                  <div><strong>{feedback.passed ? structuredLesson ? "Step cleared!" : "Trail cleared!" : structuredLesson ? "Keep experimenting" : "Nearly there"}</strong><p>{feedback.passed ? lesson.success : feedback.message}</p></div>
                </div>
              )}
              {(result?.error || (lesson.output !== "print" && result?.output)) && (
                <div
                  className={`terminal-output ${result.error ? "has-error" : ""}`}
                  role={result.error ? "alert" : "status"}
                  aria-live={result.error ? "assertive" : "polite"}
                >
                  <div className="terminal-label"><Terminal /> {result.error ? "Python message" : "Printed output"}</div>
                  <pre>{result.error ?? result.output}</pre>
                </div>
              )}
            </section>
          </div>

          <div className={`lesson-footer ${structuredLesson ? "loops-footer" : ""}`}>
            <div className="hint-area">
              {visibleHints > 0 && (
                <div className="hints" aria-live="polite">
                  {lesson.hints.slice(0, visibleHints).map((hint, index) => <p key={hint}><span>Hint {index + 1}</span>{hint}</p>)}
                </div>
              )}
              {visibleHints < lesson.hints.length && !feedback?.passed && !awaitingFreshVariant && (
                <Button type="button" variant="outline" onClick={revealHint} className="hint-button"><Lightbulb /> Give me {visibleHints === 0 ? "a hint" : "another hint"}</Button>
              )}
              {variant && visibleHints === lesson.hints.length && !revealedSet.has(lesson.id) && !feedback?.passed && (
                <Button type="button" variant="outline" onClick={revealAnswer} className="reveal-answer-button"><Eye /> Show answer and give me a fresh challenge</Button>
              )}
              {awaitingFreshVariant && variant && (
                <div className="revealed-answer" role="status">
                  <div><Eye /><span><strong>Here is the answer you asked to see</strong><small>This version cannot count toward mastery now.</small></span></div>
                  <pre><code>{variant.answer}</code></pre>
                  <Button type="button" onClick={startFreshVariant} className="fresh-variant-button"><Repeat2 /> Start a fresh variant</Button>
                </div>
              )}
            </div>

            {feedback?.passed && currentIndex < LESSONS.length - 1 && (
              currentIndex === 0 && !user ? (
                <Button
                  type="button"
                  size="lg"
                  onClick={() => setSavePromptRequest((request) => request + 1)}
                  className="next-button next-button-locked"
                >
                  <LockKeyhole /> Sign in to unlock lesson 2
                </Button>
              ) : (
                <Button type="button" size="lg" onClick={goNext} className="next-button">Next lesson <ChevronRight /></Button>
              )
            )}
          </div>

          {feedback?.passed && currentIndex === LESSONS.length - 1 && (
            <CourseVictory
              burstKey={victoryBurst}
              eyebrow="Trail complete!"
              title="You’re a Python Trailblazer!"
              message="You kept trying, solved every challenge, and built a colorful program with real Python. That is something to be very proud of."
              achievement={`12 lessons · ${LESSONS.length} learning steps conquered`}
              emoji="🐢🏆"
              action={{ href: "/clock", label: "Build my live clock" }}
            />
          )}

          {completeCourse && currentIndex !== LESSONS.length - 1 && (
            <p className="course-complete-note">You completed Turtle Trail. Every lesson is open for experimenting, and Clock Quest is unlocked!</p>
          )}
        </section>
      </div>
    </main>
  );
}
