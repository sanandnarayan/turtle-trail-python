"use client";

import {
  Check,
  ChevronRight,
  Circle,
  Clock3,
  Lightbulb,
  LockKeyhole,
  Play,
  RotateCcw,
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

type RunResult = {
  commands: TurtleCommand[];
  output: string;
  error: string | null;
  globals: Record<string, unknown>;
  functions: string[];
  modules: string[];
  syntax: string[];
  state: {
    x: number;
    y: number;
    heading: number;
    color: string;
    width: number;
  };
};

type CheckResult = { passed: boolean; message: string };

type Lesson = {
  id: string;
  number: number;
  title: string;
  concept: string;
  explanation: string;
  mission: string;
  starter: string;
  hints: string[];
  success: string;
  check: (result: RunResult, code: string) => CheckResult;
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
  expectedLength: number,
  expectedTurn: number,
) => {
  if (
    lines.length !== sides ||
    !isClosed(lines) ||
    !lines.every((line) => isNear(lineLength(line), expectedLength))
  ) {
    return false;
  }

  return lines.every((line, index) => {
    const next = lines[(index + 1) % lines.length];
    const joinsNext =
      isNear(line.x2, next.x1, 4) &&
      isNear(line.y2, next.y1, 4);
    const turn = normalizeAngle(lineHeading(next) - lineHeading(line));
    return joinsNext && angleDistance(turn, expectedTurn) <= 2;
  });
};

const LESSONS: Lesson[] = [
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
      const lines = lineCommands(result);
      return lines.length === 1 && lineLength(lines[0]) >= 95 && result.modules.includes("turtle")
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
      const lines = lineCommands(result);
      return lines.length === 1 && isNear(lineLength(lines[0]), 120)
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
      const rightLengths = lines.length === 2 && lines.every((line) => isNear(lineLength(line), 100));
      return result.globals.distance === 100 && rightLengths
        ? { passed: true, message: "Your variable powered both sides!" }
        : { passed: false, message: "Store 100 in distance and keep using its name twice." };
    },
  },
  {
    id: "for-loop",
    number: 4,
    title: "Repeat with a for loop",
    concept: "Loops repeat an indented block",
    explanation:
      "The two indented commands form one repeatable step. range(2) currently repeats it twice—enough for only half a square.",
    mission: "Change the loop so it repeats four times and completes the square.",
    starter: `import turtle

for side in range(2):
    turtle.forward(90)
    turtle.left(90)`,
    hints: [
      "A square has four equal sides.",
      "Change range(2) to range(4).",
    ],
    success: "A three-line loop drew four sides without repeated code.",
    check: (result) => {
      const lines = lineCommands(result);
      const square = isRegularClosedShape(lines, 4, 90, 90);
      return square && result.syntax.includes("For")
        ? { passed: true, message: "Loop closed—the square is complete." }
        : { passed: false, message: "Make the indented block repeat exactly four times." };
    },
  },
  {
    id: "loop-variable",
    number: 5,
    title: "Let the loop change",
    concept: "The loop variable takes a new value each time",
    explanation:
      "Here size becomes 20, 40, 60, 80, then 100. Use size in forward( ) and each new line will grow.",
    mission: "Replace the fixed 20 with size to turn the tiny square into a spiral.",
    starter: `import turtle

for size in range(20, 101, 20):
    turtle.forward(20)
    turtle.left(90)`,
    hints: [
      "The loop has already calculated the changing number for you.",
      "Use turtle.forward(size).",
    ],
    success: "Your loop variable changed the drawing on every repeat.",
    check: (result) => {
      const lengths = lineCommands(result).map(lineLength);
      const growing = lengths.length === 5 && lengths.every((value, index) => isNear(value, (index + 1) * 20));
      return growing && result.syntax.includes("For")
        ? { passed: true, message: "20, 40, 60, 80, 100—a growing spiral!" }
        : { passed: false, message: "Use the changing variable size inside forward( )." };
    },
  },
  {
    id: "if-else",
    number: 6,
    title: "Choose with if",
    concept: "if and else let code make a decision",
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
    id: "while-loop",
    number: 7,
    title: "Keep going with while",
    concept: "A while loop repeats while a condition stays true",
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
    id: "functions",
    number: 8,
    title: "Teach your own function",
    concept: "A function gives a reusable action a name",
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
    check: (result, code) => {
      const lines = lineCommands(result);
      const calledAtTopLevel = /(?:^|\n)draw_triangle\s*\(\s*\)\s*(?:#.*)?(?=\n|$)/.test(code);
      return (
        result.functions.includes("draw_triangle") &&
        calledAtTopLevel &&
        isRegularClosedShape(lines, 3, 90, 120)
      )
        ? { passed: true, message: "Python remembered your new triangle command." }
        : { passed: false, message: "The function exists, but remember to call draw_triangle()." };
    },
  },
  {
    id: "parameters",
    number: 9,
    title: "Give a function a parameter",
    concept: "Parameters let one function work with different values",
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
    check: (result, code) => {
      const lines = lineCommands(result);
      const usesParameter = /turtle\.forward\(\s*size\s*\)/.test(code);
      const passesArgument = /(?:^|\n)draw_square\s*\(\s*110\s*\)/.test(code);
      const largeSquare = isRegularClosedShape(lines, 4, 110, 90);
      return result.functions.includes("draw_square") && usesParameter && passesArgument && largeSquare
        ? { passed: true, message: "One parameter resized the entire square." }
        : { passed: false, message: "Pass 110 into draw_square on the final line." };
    },
  },
  {
    id: "lists",
    number: 10,
    title: "Collect values in a list",
    concept: "A list keeps several related values together",
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
    id: "random-module",
    number: 11,
    title: "Import a new superpower",
    concept: "Modules add functions Python does not start with",
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
    id: "final-rosette",
    number: 12,
    title: "Finale: build a rosette",
    concept: "Small ideas combine into a complete program",
    explanation:
      "This finale combines a list, a function, a parameter, a loop, and a changing color. Two values are holding the flower back.",
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
      const squares = Array.from({ length: 12 }, (_, index) =>
        lines.slice(index * 4, index * 4 + 4),
      );
      const squareHeadings = squares.map((square) =>
        square.length === 4 ? lineHeading(square[0]) : Number.NaN,
      );
      const turnsByThirty = squareHeadings.every((heading, index) => {
        const next = squareHeadings[(index + 1) % squareHeadings.length];
        return Number.isFinite(heading) && angleDistance(normalizeAngle(next - heading), 30) <= 2;
      });
      const twelveSquares =
        lines.length === 48 &&
        squares.every((square) => isRegularClosedShape(square, 4, 75, 90));
      return twelveSquares && turnsByThirty && colors.size === 4 && result.functions.includes("draw_square")
        ? { passed: true, message: "Trail complete—your rosette has 12 petals!" }
        : { passed: false, message: "You need 12 squares with a 30° turn between them." };
    },
  },
];

type WorkerMessage =
  | { type: "status"; status: "loading" | "ready" }
  | ({ type: "result"; id: number } & RunResult)
  | { type: "fatal"; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length <= 200 &&
  value.every((item) => typeof item === "string" && item.length <= 120);

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

const isRunResultMessage = (
  value: unknown,
): value is Extract<WorkerMessage, { type: "result" }> => {
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

type SavedProgress = CourseProgress;

const STORAGE_KEY = "turtle-trail-progress-v1";

function TurtleCanvas({
  commands,
  animationKey,
  turtleState,
}: {
  commands: TurtleCommand[];
  animationKey: number;
  turtleState: RunResult["state"] | null;
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
    let startedAt = performance.now();
    const drawable = commands.filter((command) => command.type !== "bg");
    const duration = Math.min(1500, Math.max(450, drawable.length * 38));

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(bounds.width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(bounds.height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const draw = (timestamp: number) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const background = [...commands]
        .reverse()
        .find((command): command is TurtleBackground => command.type === "bg")?.color ?? "#f7fbff";

      context.clearRect(0, 0, width, height);
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      context.strokeStyle = "rgba(20, 50, 87, 0.075)";
      context.lineWidth = 1;
      for (let x = 20; x < width; x += 20) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      for (let y = 20; y < height; y += 20) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }

      const turtleMovedWithoutDrawing =
        turtleState !== null && (!isNear(turtleState.x, 0) || !isNear(turtleState.y, 0));
      if (drawable.length === 0 && !turtleMovedWithoutDrawing) {
        context.font = "34px system-ui";
        context.textAlign = "center";
        context.fillText("🐢", width / 2, height / 2 - 8);
        context.font = "600 15px ui-rounded, system-ui";
        context.fillStyle = "#66738b";
        context.fillText("Run your code to make a trail", width / 2, height / 2 + 28);
        return;
      }

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
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const visibleCount = progress * drawable.length;
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
      cancelAnimationFrame(animationFrame);
      resize();
      startedAt = performance.now() - duration;
      animationFrame = requestAnimationFrame(draw);
    });
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [commands, animationKey, turtleState]);

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
  const [unlocked, setUnlocked] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<"loading" | "ready" | "error">("loading");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [feedback, setFeedback] = useState<CheckResult | null>(null);
  const [visibleHints, setVisibleHints] = useState(0);
  const [animationKey, setAnimationKey] = useState(0);
  const [savePromptRequest, setSavePromptRequest] = useState(0);
  const [victoryBurst, setVictoryBurst] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const workerGenerationRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef(0);
  const runningRef = useRef(false);
  const pendingLessonRef = useRef(0);
  const pendingCodeRef = useRef("");

  const lesson = LESSONS[currentIndex];
  const code = drafts[lesson.id] ?? lesson.starter;
  const completedSet = useMemo(() => new Set(completed), [completed]);
  const firstLessonComplete = completedSet.has(LESSONS[0].id);
  const signInRequired = firstLessonComplete && sessionStatus !== "loading" && !user;
  const progress = Math.round((completed.length / LESSONS.length) * 100);
  const savedProgress = useMemo<CourseProgress>(
    () => ({ completed, unlocked, current: currentIndex, drafts }),
    [completed, currentIndex, drafts, unlocked],
  );
  const mergeRemoteProgress = useCallback((remote: CourseProgress) => {
    const lessonIds = new Set(LESSONS.map((item) => item.id));
    const remoteCompleted = remote.completed.filter((id) => lessonIds.has(id));
    const remoteUnlocked = Math.max(0, Math.min(remote.unlocked, LESSONS.length - 1));
    const remoteCurrent = Math.max(0, Math.min(remote.current, remoteUnlocked));
    const remoteDrafts: Record<string, string> = {};
    Object.entries(remote.drafts).forEach(([id, draft]) => {
      if (lessonIds.has(id)) remoteDrafts[id] = draft.slice(0, 20000);
    });
    setCompleted((previous) => {
      const merged = new Set([...remoteCompleted, ...previous]);
      return LESSONS.map((item) => item.id).filter((id) => merged.has(id));
    });
    setUnlocked((previous) => Math.max(previous, remoteUnlocked));
    setCurrentIndex((previous) => Math.max(previous, remoteCurrent));
    setDrafts((previous) => ({ ...remoteDrafts, ...previous }));
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
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        runningRef.current = false;
        setRunning(false);
        setResult(message);
        setAnimationKey((key) => key + 1);

        const activeLesson = LESSONS[pendingLessonRef.current];
        const verdict = message.error
          ? { passed: false, message: "Python found something to fix. Read the message under the drawing." }
          : activeLesson.check(message, pendingCodeRef.current);
        setFeedback(verdict);

        if (verdict.passed) {
          if (pendingLessonRef.current === 0) {
            setSavePromptRequest((request) => request + 1);
          }
          if (pendingLessonRef.current === LESSONS.length - 1) {
            setVictoryBurst((burst) => burst + 1);
          }
          setCompleted((previous) =>
            previous.includes(activeLesson.id) ? previous : [...previous, activeLesson.id],
          );
          setUnlocked((previous) => Math.max(previous, Math.min(LESSONS.length - 1, pendingLessonRef.current + 1)));
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
          const restoredCompleted = Array.isArray(progressData.completed)
            ? [...new Set(progressData.completed.filter(
                (id): id is string => typeof id === "string" && lessonIds.has(id),
              ))]
            : [];
          const restoredUnlocked =
            typeof progressData.unlocked === "number" && Number.isInteger(progressData.unlocked)
              ? Math.max(0, Math.min(progressData.unlocked, LESSONS.length - 1))
              : 0;
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
          setCompleted(restoredCompleted);
          setUnlocked(restoredUnlocked);
          setCurrentIndex(restoredCurrent);
          setDrafts(restoredDrafts);
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
    const progressData: SavedProgress = { completed, unlocked, current: currentIndex, drafts };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progressData));
    } catch {
      // Learning still works when storage is unavailable; only persistence is skipped.
    }
  }, [completed, currentIndex, drafts, hydrated, unlocked]);

  useEffect(() => {
    if (!hydrated || sessionStatus === "loading" || user || currentIndex === 0) return;
    const returnToFirstLesson = window.setTimeout(() => {
      setCurrentIndex(0);
      setResult(null);
      setFeedback(null);
    }, 0);
    return () => window.clearTimeout(returnToFirstLesson);
  }, [currentIndex, hydrated, sessionStatus, user]);

  const chooseLesson = (index: number) => {
    if (running || index > unlocked || (index > 0 && !user)) return;
    setCurrentIndex(index);
    setResult(null);
    setFeedback(null);
    setVisibleHints(0);
  };

  const updateCode = (nextCode: string) => {
    setDrafts((previous) => ({ ...previous, [lesson.id]: nextCode }));
    if (feedback) setFeedback(null);
  };

  const resetLesson = () => {
    setDrafts((previous) => ({ ...previous, [lesson.id]: lesson.starter }));
    setResult(null);
    setFeedback(null);
    setVisibleHints(0);
  };

  const runCode = useCallback(() => {
    if (!workerRef.current || runtimeStatus !== "ready" || runningRef.current) return;
    if (currentIndex > 0 && !user) {
      setSavePromptRequest((request) => request + 1);
      return;
    }
    if (code.length > 20000) {
      setFeedback({ passed: false, message: "That program is a little too long. Keep it under 20,000 characters." });
      return;
    }
    const nextId = runIdRef.current + 1;
    runIdRef.current = nextId;
    runningRef.current = true;
    pendingLessonRef.current = currentIndex;
    pendingCodeRef.current = code;
    setRunning(true);
    setFeedback(null);
    setResult(null);
    workerRef.current.postMessage({ type: "run", id: nextId, code });
    timeoutRef.current = setTimeout(() => {
      runningRef.current = false;
      setRunning(false);
      setFeedback({ passed: false, message: "That ran for too long. Check whether a while loop can ever stop." });
      bootWorker();
    }, 5000);
  }, [bootWorker, code, currentIndex, runtimeStatus, user]);

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
    if (event.key === "Tab" && !event.shiftKey) {
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
  const goNext = () => currentIndex < LESSONS.length - 1 && chooseLesson(currentIndex + 1);
  const completeCourse = completedSet.has(LESSONS[LESSONS.length - 1].id);

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

        <div className="header-progress" aria-label={`${completed.length} of ${LESSONS.length} lessons complete`}>
          <div className="progress-copy"><span>{completed.length} of {LESSONS.length} lessons</span><span>{progress}%</span></div>
          <Progress value={progress} className="course-progress" />
        </div>

        <div className="header-actions">
          {completeCourse && user ? (
            <Link className="course-link clock-quest-link" href="/clock">
              <Clock3 /> Clock Quest
            </Link>
          ) : (
            <span className="course-link clock-quest-link locked" aria-label="Clock Quest unlocks after all 12 Turtle Trail lessons">
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
          <nav className="lesson-list">
            {LESSONS.map((item, index) => {
              const isCurrent = index === currentIndex;
              const isComplete = completedSet.has(item.id);
              const isSignInLocked = index > 0 && !user;
              const isLocked = index > unlocked || isSignInLocked;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`lesson-link ${isCurrent ? "current" : ""} ${isComplete ? "complete" : ""} ${index === 1 && isSignInLocked ? "sign-in-gate" : ""}`}
                  onClick={() => chooseLesson(index)}
                  disabled={isLocked || running}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <span className="lesson-state" aria-hidden="true">
                    {isComplete ? <Check /> : isLocked ? <LockKeyhole /> : <Circle />}
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
          <div className="lesson-intro">
            <div className="lesson-kicker">Lesson {lesson.number} · {lesson.concept}</div>
            <h1>{lesson.title}</h1>
            <p>{lesson.explanation}</p>
            <div className="mission-card"><span className="mission-label">Your mission</span><strong>{lesson.mission}</strong></div>
          </div>

          <div className="practice-grid">
            <section className="code-panel" aria-label="Python code editor">
              <div className="panel-bar code-bar">
                <div className="panel-title"><span className="traffic-lights" aria-hidden="true"><i /><i /><i /></span>lesson_{String(lesson.number).padStart(2, "0")}.py</div>
                <Button type="button" variant="ghost" size="sm" className="reset-button" onClick={resetLesson} disabled={running}><RotateCcw /> Reset</Button>
              </div>
              <div className="editor-wrap">
                <div className="editor-gutter" aria-hidden="true">
                  {code.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}
                </div>
                <textarea
                  value={code}
                  onChange={(event) => updateCode(event.target.value)}
                  onKeyDown={handleEditorKeyDown}
                  disabled={running}
                  maxLength={20000}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  aria-label={`Code editor for lesson ${lesson.number}`}
                  aria-describedby="editor-keyboard-help"
                />
              </div>
              <div className="editor-actions">
                <span className="shortcut"><kbd>Ctrl/⌘</kbd><kbd>Enter</kbd> run · <kbd>Esc</kbd> leave editor</span>
                <span id="editor-keyboard-help" className="sr-only">
                  Press Tab to indent, Shift plus Tab or Escape to leave the code editor, and Control or Command plus Enter to run.
                </span>
                <Button type="button" size="lg" className="run-button" onClick={runCode} disabled={runtimeStatus !== "ready" || running}>
                  <Play fill="currentColor" />{running ? "Running…" : "Run my code"}
                </Button>
              </div>
            </section>

            <section className="output-panel" aria-label="Turtle output">
              <div className="panel-bar"><div className="panel-title"><Turtle /> Turtle canvas</div><span className="canvas-status">{running ? "Drawing…" : "Live output"}</span></div>
              <div className="canvas-wrap">
                <TurtleCanvas
                  commands={result?.commands ?? []}
                  animationKey={animationKey}
                  turtleState={result?.state ?? null}
                />
                {feedback && (
                  <div className={`feedback-card ${feedback.passed ? "passed" : "try-again"}`} role="status">
                    <span className="feedback-icon">{feedback.passed ? <Check /> : <Lightbulb />}</span>
                    <div><strong>{feedback.passed ? "Trail cleared!" : "Nearly there"}</strong><p>{feedback.passed ? lesson.success : feedback.message}</p></div>
                  </div>
                )}
              </div>
              {(result?.output || result?.error) && (
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

          <div className="lesson-footer">
            <div className="hint-area">
              {visibleHints > 0 && (
                <div className="hints" aria-live="polite">
                  {lesson.hints.slice(0, visibleHints).map((hint, index) => <p key={hint}><span>Hint {index + 1}</span>{hint}</p>)}
                </div>
              )}
              {visibleHints < lesson.hints.length && !feedback?.passed && (
                <Button type="button" variant="outline" onClick={revealHint} className="hint-button"><Lightbulb /> Give me {visibleHints === 0 ? "a hint" : "another hint"}</Button>
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
              achievement="12 lessons conquered"
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
