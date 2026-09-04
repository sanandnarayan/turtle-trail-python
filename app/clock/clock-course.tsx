"use client";

import {
  ArrowLeft,
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
  Sparkles,
  Terminal,
  Timer,
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
} from "../account";
import { PythonEditor } from "../python-editor";

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

type RunResult = {
  commands: TurtleCommand[];
  output: string;
  error: string | null;
  globals: Record<string, unknown>;
  functions: string[];
  modules: string[];
  syntax: string[];
  analysis: {
    calls: string[];
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

type CheckResult = { passed: boolean; message: string };

type ClockQuestion = {
  eyebrow: string;
  prompt: string;
  choices: Array<[value: string, label: string]>;
  correct: string;
  incorrect: string;
};

type ClockVariant = {
  key: string;
  mission: string;
  answer: string;
};

type ClockLesson = {
  id: string;
  number: string;
  title: string;
  concept: string;
  explanation: string;
  mission: string;
  starter: string;
  phase: string;
  readOnly?: boolean;
  output?: "clock" | "print";
  question?: ClockQuestion;
  hints: string[];
  success: string;
  points: number;
  live?: boolean;
  variants?: ClockVariant[];
  check: (result: RunResult, code: string, variant?: ClockVariant) => CheckResult;
};

const FACE_COLOR = "#25324a";
const SECOND_COLOR = "#ff5d73";
const MINUTE_COLOR = "#2f7ee6";
const HOUR_COLOR = "#7c3aed";

const lineCommands = (result: RunResult) =>
  result.commands.filter((command): command is TurtleLine => command.type === "line");

const textCommands = (result: RunResult) =>
  result.commands.filter((command): command is TurtleText => command.type === "text");

const lineLength = (line: TurtleLine) =>
  Math.hypot(line.x2 - line.x1, line.y2 - line.y1);

const isNear = (first: number, second: number, tolerance = 3) =>
  Math.abs(first - second) <= tolerance;

const normalizedColor = (color: string) => color.toLowerCase();

const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;

const lineHeading = (line: TurtleLine) =>
  normalizeAngle((Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180) / Math.PI);

const angleDistance = (first: number, second: number) => {
  const difference = Math.abs(normalizeAngle(first) - normalizeAngle(second));
  return Math.min(difference, 360 - difference);
};

const callMatches = (actual: string, expected: string) =>
  actual === expected || actual.endsWith(`.${expected}`);

const callCount = (result: RunResult, name: string) =>
  result.analysis.calls.filter((call) => callMatches(call, name)).length;

const hasRangeLoop = (
  result: RunResult,
  arguments_: Array<string | number>,
  requiredCalls: string[],
) => result.analysis.forLoops.some((loop) =>
  callMatches(loop.iterator ?? "", "range") &&
  loop.arguments.join("|") === arguments_.join("|") &&
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

const printedLines = (output: string) => {
  const lines = output.replaceAll("\r", "").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

const clockVariantKey = (variant?: ClockVariant) => variant?.key ?? null;

const hasCircularOutline = (
  result: RunResult,
  expectedRadius: number,
  color?: string,
) => {
  const lines = lineCommands(result).filter((line) =>
    color ? normalizedColor(line.color) === normalizedColor(color) : true,
  );
  if (lines.length < 50) return false;
  const points = lines.flatMap((line) => [
    [line.x1, line.y1],
    [line.x2, line.y2],
  ]);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return isNear(Math.max(...xs) - Math.min(...xs), expectedRadius * 2, 12) &&
    isNear(Math.max(...ys) - Math.min(...ys), expectedRadius * 2, 12);
};

const hasClockFace = (result: RunResult) => {
  const face = lineCommands(result).filter(
    (line) => normalizedColor(line.color) === FACE_COLOR,
  );
  if (face.length < 50) return false;
  const points = face.flatMap((line) => [
    [line.x1, line.y1],
    [line.x2, line.y2],
  ]);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return Math.max(...xs) - Math.min(...xs) >= 285 && Math.max(...ys) - Math.min(...ys) >= 285;
};

const hasHourNumbers = (result: RunResult) => {
  const labels = new Set(textCommands(result).map((command) => command.text.trim()));
  return Array.from({ length: 12 }, (_, index) => String(index + 1)).every((label) => labels.has(label));
};

const hasHourNumbersAround = (result: RunResult, radius: number) => {
  if (!hasHourNumbers(result)) return false;
  const labels = textCommands(result).filter((command) => {
    const number = Number(command.text.trim());
    return Number.isInteger(number) && number >= 1 && number <= 12;
  });
  if (labels.length !== 12) return false;
  return labels.every((label) =>
    isNear(Math.hypot(label.x, label.y + 5), radius * 0.8, 12),
  );
};

const hasHand = (
  result: RunResult,
  color: string,
  expectedLength: number,
  tolerance = 7,
) =>
  lineCommands(result).some(
    (line) =>
      normalizedColor(line.color) === color &&
      isNear(line.x1, 0, 2) &&
      isNear(line.y1, 0, 2) &&
      isNear(lineLength(line), expectedLength, tolerance),
  );

const hasHandAtValue = (
  result: RunResult,
  color: string,
  expectedLength: number,
  value: number,
  degreesPerUnit: number,
) => lineCommands(result).some((line) =>
  normalizedColor(line.color) === normalizedColor(color) &&
  isNear(line.x1, 0, 2) &&
  isNear(line.y1, 0, 2) &&
  isNear(lineLength(line), expectedLength, 7) &&
  angleDistance(lineHeading(line), 90 - value * degreesPerUnit) <= 2,
);

const CLOCK_PHASES = [
  { suffix: "a", id: "discover", phase: "Notice", pointWeight: 1 },
  { suffix: "b", id: "understand", phase: "Understand", pointWeight: 2 },
  { suffix: "c", id: "guided", phase: "Practice", pointWeight: 2 },
  { suffix: "d", id: "independent", phase: "Prove it", pointWeight: 4 },
  { suffix: "e", id: "transfer", phase: "Transfer", pointWeight: 4 },
  { suffix: "f", id: "boss", phase: "Boss", pointWeight: 7 },
] as const;

type ClockLessonInput = Omit<ClockLesson, "id" | "number" | "phase" | "points">;

const clockUnit = (
  number: number,
  prefix: string,
  totalPoints: number,
  lessons: ClockLessonInput[],
): ClockLesson[] => CLOCK_PHASES.map((phase, index) => ({
  ...lessons[index],
  id: `${prefix}-${phase.id}`,
  number: `${number}${phase.suffix}`,
  phase: phase.phase,
  points: (totalPoints * phase.pointWeight) / 20,
}));

const FACE_STARTER = `import turtle

radius = 150
turtle.bgcolor("#ffffff")
turtle.pencolor("${FACE_COLOR}")
turtle.pensize(5)
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()

# Make this circle use the full radius
turtle.circle(80)`;

const FACE_CODE = `import turtle

radius = 150
turtle.bgcolor("#ffffff")
turtle.pencolor("${FACE_COLOR}")
turtle.pensize(5)
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)`;

const NUMBERS_STARTER = `${FACE_CODE}

import math

# This loop only places half the clock numbers
for hour_number in range(1, 7):
    angle = math.radians(90 - hour_number * 30)
    x = math.cos(angle) * radius * 0.80
    y = math.sin(angle) * radius * 0.80
    turtle.penup()
    turtle.goto(x, y - 5)
    turtle.pencolor("${FACE_COLOR}")
    turtle.write(hour_number)`;

const NUMBERS_CODE = `${FACE_CODE}

import math

for hour_number in range(1, 13):
    angle = math.radians(90 - hour_number * 30)
    x = math.cos(angle) * radius * 0.80
    y = math.sin(angle) * radius * 0.80
    turtle.penup()
    turtle.goto(x, y - 5)
    turtle.pencolor("${FACE_COLOR}")
    turtle.write(hour_number)`;

const SECOND_STARTER = `${NUMBERS_CODE}

second = 10
second_angle = second * 6
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second_angle)
turtle.pencolor("${SECOND_COLOR}")
turtle.pensize(3)
turtle.pendown()

# Stretch this hand almost to the clock edge
turtle.forward(60)`;

const LIVE_SECOND_STARTER = `${NUMBERS_CODE}

from datetime import datetime

now = datetime.now()
# Replace 10 with the current second
second = 10
second_angle = second * 6
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second_angle)
turtle.pencolor("${SECOND_COLOR}")
turtle.pensize(3)
turtle.pendown()
turtle.forward(radius * 0.82)`;

const LIVE_SECOND_CODE = `${NUMBERS_CODE}

from datetime import datetime

now = datetime.now()
second = now.second
second_angle = second * 6
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second_angle)
turtle.pencolor("${SECOND_COLOR}")
turtle.pensize(3)
turtle.pendown()
turtle.forward(radius * 0.82)`;

const MINUTE_STARTER = `${LIVE_SECOND_CODE}

minute = 15
minute_angle = minute * 6
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - minute_angle)
turtle.pencolor("${MINUTE_COLOR}")
turtle.pensize(5)
turtle.pendown()

# Give the minute hand its proper length
turtle.forward(50)`;

const LIVE_MINUTE_STARTER = `${NUMBERS_CODE}

from datetime import datetime

now = datetime.now()
second = now.second
minute = 15  # Replace 15 with the current minute

turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second * 6)
turtle.pencolor("${SECOND_COLOR}")
turtle.pensize(3)
turtle.pendown()
turtle.forward(radius * 0.82)

turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - minute * 6)
turtle.pencolor("${MINUTE_COLOR}")
turtle.pensize(5)
turtle.pendown()
turtle.forward(radius * 0.66)`;

const FUNCTION_STARTER = `${NUMBERS_CODE}

from datetime import datetime

now = datetime.now()
second = now.second
minute = now.minute

def draw_hand(angle, length, color, width):
    turtle.penup()
    turtle.goto(0, 0)
    turtle.setheading(90 - angle)
    turtle.pencolor(color)
    turtle.pensize(width)
    turtle.pendown()
    # Use the length parameter here
    turtle.forward(30)

draw_hand(second * 6, radius * 0.82, "${SECOND_COLOR}", 3)
draw_hand(minute * 6, radius * 0.66, "${MINUTE_COLOR}", 5)`;

const FUNCTION_CODE = `${NUMBERS_CODE}

from datetime import datetime

now = datetime.now()
second = now.second
minute = now.minute

def draw_hand(angle, length, color, width):
    turtle.penup()
    turtle.goto(0, 0)
    turtle.setheading(90 - angle)
    turtle.pencolor(color)
    turtle.pensize(width)
    turtle.pendown()
    turtle.forward(length)

draw_hand(second * 6, radius * 0.82, "${SECOND_COLOR}", 3)
draw_hand(minute * 6, radius * 0.66, "${MINUTE_COLOR}", 5)`;

const HOUR_STARTER = `${FUNCTION_CODE}

hour = 3

# Replace 30 with a length based on radius
draw_hand(hour * 30, 30, "${HOUR_COLOR}", 7)
turtle.penup()
turtle.goto(0, 0)
turtle.dot(12, "${FACE_COLOR}")`;

const LIVE_HOUR_STARTER = `${NUMBERS_CODE}

from datetime import datetime

now = datetime.now()
second = now.second
minute = now.minute
hour = 3  # Replace 3 with the current 12-hour value

def draw_hand(angle, length, color, width):
    turtle.penup()
    turtle.goto(0, 0)
    turtle.setheading(90 - angle)
    turtle.pencolor(color)
    turtle.pensize(width)
    turtle.pendown()
    turtle.forward(length)

draw_hand(second * 6, radius * 0.82, "${SECOND_COLOR}", 3)
draw_hand(minute * 6, radius * 0.66, "${MINUTE_COLOR}", 5)
draw_hand(hour * 30, radius * 0.48, "${HOUR_COLOR}", 7)
turtle.penup()
turtle.goto(0, 0)
turtle.dot(12, "${FACE_COLOR}")
turtle.hideturtle()`;

const LIVE_CLOCK_CODE = LIVE_HOUR_STARTER.replace(
  "hour = 3  # Replace 3 with the current 12-hour value",
  "hour = now.hour % 12",
);

const CLOCK_LESSONS: ClockLesson[] = [
  ...clockUnit(1, "face", 80, [
    {
      title: "Discover radius",
      concept: "A circle’s radius controls its size",
      explanation:
        "The turtle begins one radius below the center. circle(radius) then draws a circle whose diameter is twice that radius.",
      mission: "What diameter will a radius of 60 make? Choose before you run it.",
      starter: `import turtle

radius = 60
turtle.penup()
turtle.goto(0, -radius)
turtle.pendown()
turtle.circle(radius)`,
      readOnly: true,
      question: {
        eyebrow: "Notice the relationship",
        prompt: "What is the circle’s diameter?",
        choices: [["60", "60"], ["120", "120"], ["360", "360"]],
        correct: "120",
        incorrect: "A diameter crosses two radii, so 60 × 2 = 120.",
      },
      hints: ["The radius reaches from the center to one edge.", "A diameter is two radii."],
      success: "You connected radius to the full width of a circle.",
      check: (result) => hasCircularOutline(result, 60) && callCount(result, "circle") === 1
        ? { passed: true, message: "The 60-step radius produced a 120-step diameter." }
        : { passed: false, message: "Keep the shown circle example unchanged." },
    },
    {
      title: "Calculate from a radius",
      concept: "Expressions can derive one measurement from another",
      explanation:
        "Python evaluates radius * 2 before storing the result in diameter. Changing radius would automatically change the calculated diameter.",
      mission: "Predict the value printed for diameter.",
      starter: `radius = 75
diameter = radius * 2
print(diameter)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Predict first",
        prompt: "What value will Python print?",
        choices: [["75", "75"], ["150", "150"], ["225", "225"]],
        correct: "150",
        incorrect: "diameter is radius multiplied by 2: 75 × 2 = 150.",
      },
      hints: ["Substitute 75 for radius in the expression.", "Multiply the radius by 2."],
      success: "You traced a variable through a geometry expression.",
      check: (result) => result.syntax.includes("Mult") && result.output === "150\n"
        ? { passed: true, message: "Python calculated the diameter from the radius." }
        : { passed: false, message: "Keep the shown calculation unchanged." },
    },
    {
      title: "Shape the clock face",
      concept: "A variable can control Turtle geometry",
      explanation:
        "Your turtle is waiting at the bottom of the dial. The radius variable already stores 150, but circle still uses a tiny fixed number.",
      mission: "Replace 80 with radius so the turtle draws a full-sized clock face.",
      starter: FACE_STARTER,
      hints: [
        "Variables can be used anywhere a number can be used.",
        "The final line should be turtle.circle(radius).",
      ],
      success: "A perfect 300-step clock face is ready for its numbers.",
      check: (result, code) =>
        hasClockFace(result) && /turtle\.circle\(\s*radius\s*\)/.test(code)
          ? { passed: true, message: "The dial is full size!" }
          : { passed: false, message: "Use radius inside turtle.circle( )." },
    },
    {
      title: "Draw a circle from scratch",
      concept: "Independent challenge · mastery proof 1 of 2",
      explanation:
        "Start blank. Create the radius variable, move to the bottom of the circle, and use that variable in one circle instruction.",
      mission: "Set radius = 100 and draw a circle centered around the origin using turtle.circle(radius).",
      starter: "",
      hints: [
        "Import turtle, lift the pen, and go to (0, -radius).",
        "Put the pen down and call turtle.circle(radius) once.",
      ],
      success: "Independent proof complete: your variable controlled a circle from scratch.",
      variants: [
        {
          key: "face-circle-primary",
          mission: "Set radius = 100 and draw a circle centered around the origin using turtle.circle(radius).",
          answer: `import turtle

radius = 100
turtle.penup()
turtle.goto(0, -radius)
turtle.pendown()
turtle.circle(radius)`,
        },
        {
          key: "face-circle-fresh",
          mission: "Fresh challenge: set radius = 120 and draw a centered circle using turtle.circle(radius).",
          answer: `import turtle

radius = 120
turtle.penup()
turtle.goto(0, -radius)
turtle.pendown()
turtle.circle(radius)`,
        },
      ],
      check: (result, code, variant) => {
        const radius = clockVariantKey(variant) === "face-circle-fresh" ? 120 : 100;
        return result.globals.radius === radius &&
          callCount(result, "circle") === 1 &&
          /turtle\.circle\(\s*radius\s*\)/.test(code) &&
          hasCircularOutline(result, radius)
          ? { passed: true, message: "Your radius variable controlled the complete circle." }
          : { passed: false, message: "Use the requested radius variable in one centered circle( ) call." };
      },
    },
    {
      title: "Transfer radius to diameter",
      concept: "Transfer challenge · mastery proof 2 of 2",
      explanation:
        "Use the same radius idea without Turtle. Start blank, calculate a derived value, and print the result of the expression.",
      mission: "Set radius = 75, calculate diameter = radius * 2, and print diameter with one print().",
      starter: "",
      output: "print",
      hints: ["Store the radius first, then create a second variable.", "Multiply radius by 2 before printing diameter."],
      success: "Mastery proven: you transferred radius into a Python calculation.",
      variants: [
        {
          key: "face-diameter-primary",
          mission: "Set radius = 75, calculate diameter = radius * 2, and print diameter with one print().",
          answer: `radius = 75
diameter = radius * 2
print(diameter)`,
        },
        {
          key: "face-diameter-fresh",
          mission: "Fresh challenge: set radius = 90, calculate diameter from radius, and print it once.",
          answer: `radius = 90
diameter = radius * 2
print(diameter)`,
        },
      ],
      check: (result, code, variant) => {
        const fresh = clockVariantKey(variant) === "face-diameter-fresh";
        const radius = fresh ? 90 : 75;
        const diameter = radius * 2;
        return result.globals.radius === radius &&
          result.syntax.includes("Mult") &&
          /diameter\s*=\s*radius\s*\*\s*2/.test(code) &&
          callCount(result, "print") === 1 &&
          result.output.trim() === String(diameter)
          ? { passed: true, message: "Your calculation transferred radius into diameter." }
          : { passed: false, message: "Calculate diameter from radius, then print that value once." };
      },
    },
    {
      title: "Build a polished dial",
      concept: "Combine positioning, variables, color, and line width",
      explanation:
        "Create a complete dial from an empty editor. Its size, color, and placement must all come from your Python program.",
      mission: "Draw a centered clock face with radius = 140, color #25324a, pensize 5, and turtle.circle(radius).",
      starter: "",
      hints: [
        "Set the radius, color, and pensize before drawing.",
        "Move without drawing to (0, -radius), set heading 0, then draw circle(radius).",
      ],
      success: "Boss cleared: your blank editor became a polished clock dial.",
      variants: [
        {
          key: "face-boss-primary",
          mission: "Draw a centered clock face with radius = 140, color #25324a, pensize 5, and turtle.circle(radius).",
          answer: `import turtle

radius = 140
turtle.pencolor("${FACE_COLOR}")
turtle.pensize(5)
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)`,
        },
        {
          key: "face-boss-fresh",
          mission: "Fresh boss: draw a centered clock face with radius = 125, color #25324a, pensize 5, and circle(radius).",
          answer: `import turtle

radius = 125
turtle.pencolor("${FACE_COLOR}")
turtle.pensize(5)
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)`,
        },
      ],
      check: (result, code, variant) => {
        const radius = clockVariantKey(variant) === "face-boss-fresh" ? 125 : 140;
        return result.globals.radius === radius &&
          callCount(result, "circle") === 1 &&
          /turtle\.circle\(\s*radius\s*\)/.test(code) &&
          hasCircularOutline(result, radius, FACE_COLOR)
          ? { passed: true, message: "Your complete dial has the requested size and style." }
          : { passed: false, message: "Build the centered face with the requested radius, color, and circle call." };
      },
    },
  ]),
  ...clockUnit(2, "numbers", 100, [
    {
      title: "Discover the hour sequence",
      concept: "range can generate clock labels",
      explanation:
        "A clock uses the numbers 1 through 12. range starts at its first argument and stops just before its second argument.",
      mission: "Which numbers will this loop print? Choose before you run it.",
      starter: `for hour_number in range(1, 4):
    print(hour_number)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Read the range",
        prompt: "Which values does range(1, 4) produce?",
        choices: [["1-2-3", "1, 2, 3"], ["1-2-3-4", "1, 2, 3, 4"], ["0-1-2-3", "0, 1, 2, 3"]],
        correct: "1-2-3",
        incorrect: "range starts at 1 and stops before 4, producing 1, 2, and 3.",
      },
      hints: ["The first range number is included.", "The second range number is not included."],
      success: "You traced the sequence Python can use for clock labels.",
      check: (result) => hasRangeLoop(result, [1, 4], ["print"]) && result.output === "1\n2\n3\n"
        ? { passed: true, message: "The range produced three consecutive hours." }
        : { passed: false, message: "Keep the shown range example unchanged." },
    },
    {
      title: "Turn hours into angles",
      concept: "Every hour is separated by 30 degrees",
      explanation:
        "Starting at the top means 90°. Subtracting hour_number * 30 converts a clock number into Turtle’s angle system.",
      mission: "Predict the angle calculated for hour 3.",
      starter: `hour_number = 3
angle = 90 - hour_number * 30
print(angle)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Predict first",
        prompt: "What angle is calculated for hour 3?",
        choices: [["0", "0°"], ["30", "30°"], ["90", "90°"]],
        correct: "0",
        incorrect: "90 - 3 × 30 equals 0 degrees.",
      },
      hints: ["Multiply 3 by 30 first.", "Subtract the result from 90."],
      success: "You converted an hour number into a Turtle angle.",
      check: (result) => result.syntax.includes("Mult") && result.syntax.includes("Sub") && result.output === "0\n"
        ? { passed: true, message: "Hour 3 maps to Turtle heading 0°." }
        : { passed: false, message: "Keep the shown angle calculation unchanged." },
    },
    {
      title: "Place all twelve hours",
      concept: "Loops turn angles into positions",
      explanation:
        "Each number is 30° around the circle from the one before it. The loop calculates an x and y position, but currently stops after six.",
      mission: "Change the range so the loop writes every number from 1 through 12.",
      starter: NUMBERS_STARTER,
      hints: [
        "Python range stops just before its second number.",
        "Use range(1, 13) to produce 1 through 12.",
      ],
      success: "Twelve hour markers clicked into place around the dial.",
      check: (result) =>
        hasClockFace(result) && hasHourNumbersAround(result, 150) && hasRangeLoop(result, [1, 13], ["write"])
          ? { passed: true, message: "All twelve hours are in position!" }
          : { passed: false, message: "Let the loop reach all the way through hour 12." },
    },
    {
      title: "Position twelve labels",
      concept: "Independent challenge · mastery proof 1 of 2",
      explanation:
        "Start blank. Write the loop and coordinate math yourself so each number lands at a different position around the dial.",
      mission: "Set radius = 120 and use a for loop with math to write hour numbers 1 through 12 around the origin.",
      starter: "",
      hints: [
        "Loop over range(1, 13) and convert 90 - hour_number * 30 to radians.",
        "Use cos and sin times radius * 0.80, then goto(x, y - 5) and write hour_number.",
      ],
      success: "Independent proof complete: your loop positioned all twelve hour labels.",
      variants: [
        {
          key: "numbers-position-primary",
          mission: "Set radius = 120 and use a for loop with math to write hour numbers 1 through 12 around the origin.",
          answer: `import turtle
import math

radius = 120
for hour_number in range(1, 13):
    angle = math.radians(90 - hour_number * 30)
    x = math.cos(angle) * radius * 0.80
    y = math.sin(angle) * radius * 0.80
    turtle.penup()
    turtle.goto(x, y - 5)
    turtle.write(hour_number)`,
        },
        {
          key: "numbers-position-fresh",
          mission: "Fresh challenge: set radius = 100 and position hour numbers 1 through 12 around the origin with one loop.",
          answer: `import turtle
import math

radius = 100
for hour_number in range(1, 13):
    angle = math.radians(90 - hour_number * 30)
    x = math.cos(angle) * radius * 0.80
    y = math.sin(angle) * radius * 0.80
    turtle.penup()
    turtle.goto(x, y - 5)
    turtle.write(hour_number)`,
        },
      ],
      check: (result, _code, variant) => {
        const radius = clockVariantKey(variant) === "numbers-position-fresh" ? 100 : 120;
        return result.globals.radius === radius &&
          result.modules.includes("math") &&
          hasRangeLoop(result, [1, 13], ["math.radians", "math.cos", "math.sin", "goto", "write"]) &&
          callCount(result, "write") === 1 &&
          hasHourNumbersAround(result, radius)
          ? { passed: true, message: "Your coordinate loop placed every hour around the dial." }
          : { passed: false, message: "Use one range loop and the angle formulas to position all twelve labels." };
      },
    },
    {
      title: "Transfer hours into angles",
      concept: "Transfer challenge · mastery proof 2 of 2",
      explanation:
        "Use the clock-angle formula without Turtle. One loop variable should calculate and print several positions.",
      mission: "For hours 1 through 3, print 90 - hour * 30 with one loop and one print().",
      starter: "",
      output: "print",
      hints: ["Use range(1, 4).", "Print 90 - hour * 30 inside the loop."],
      success: "Mastery proven: you transferred clock positioning into numeric output.",
      variants: [
        {
          key: "numbers-angles-primary",
          mission: "For hours 1 through 3, print 90 - hour * 30 with one loop and one print().",
          answer: `for hour in range(1, 4):
    print(90 - hour * 30)`,
        },
        {
          key: "numbers-angles-fresh",
          mission: "Fresh challenge: for hours 4 through 6, print 90 - hour * 30 with one loop and one print().",
          answer: `for hour in range(4, 7):
    print(90 - hour * 30)`,
        },
      ],
      check: (result, _code, variant) => {
        const fresh = clockVariantKey(variant) === "numbers-angles-fresh";
        const range = fresh ? [4, 7] : [1, 4];
        const expected = fresh ? ["-30", "-60", "-90"] : ["60", "30", "0"];
        return hasRangeLoop(result, range, ["print"]) &&
          callCount(result, "print") === 1 &&
          printedLines(result.output).join("|") === expected.join("|")
          ? { passed: true, message: "Your loop transferred each hour into the correct angle." }
          : { passed: false, message: "Use one print inside the requested range loop and calculate from its variable." };
      },
    },
    {
      title: "Build a numbered dial",
      concept: "Combine a circle, coordinate math, and a labeling loop",
      explanation:
        "Create the clock’s complete numbered foundation from an empty editor. The face and all twelve positions must agree on one radius.",
      mission: "Build a radius-140 face in #25324a and place all twelve numbers at radius * 0.80 with one for loop.",
      starter: "",
      hints: [
        "Draw the centered circle first, then import math for label positions.",
        "Loop from 1 through 12 and use radians, cos, and sin before writing each number.",
      ],
      success: "Boss cleared: your loop and geometry built a complete numbered dial.",
      variants: [
        {
          key: "numbers-boss-primary",
          mission: "Build a radius-140 face in #25324a and place all twelve numbers at radius * 0.80 with one for loop.",
          answer: `import turtle
import math

radius = 140
turtle.pencolor("${FACE_COLOR}")
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)

for hour_number in range(1, 13):
    angle = math.radians(90 - hour_number * 30)
    x = math.cos(angle) * radius * 0.80
    y = math.sin(angle) * radius * 0.80
    turtle.penup()
    turtle.goto(x, y - 5)
    turtle.write(hour_number)`,
        },
        {
          key: "numbers-boss-fresh",
          mission: "Fresh boss: build a radius-120 face in #25324a and place all twelve numbers around it with one loop.",
          answer: `import turtle
import math

radius = 120
turtle.pencolor("${FACE_COLOR}")
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)

for hour_number in range(1, 13):
    angle = math.radians(90 - hour_number * 30)
    x = math.cos(angle) * radius * 0.80
    y = math.sin(angle) * radius * 0.80
    turtle.penup()
    turtle.goto(x, y - 5)
    turtle.write(hour_number)`,
        },
      ],
      check: (result, _code, variant) => {
        const radius = clockVariantKey(variant) === "numbers-boss-fresh" ? 120 : 140;
        return result.globals.radius === radius &&
          result.modules.includes("math") &&
          callCount(result, "circle") === 1 &&
          hasRangeLoop(result, [1, 13], ["write"]) &&
          hasCircularOutline(result, radius, FACE_COLOR) &&
          hasHourNumbersAround(result, radius)
          ? { passed: true, message: "Your face and all twelve labels form one complete dial." }
          : { passed: false, message: "Build the requested face and position all twelve numbers with one loop." };
      },
    },
  ]),
  ...clockUnit(3, "second", 100, [
    {
      title: "Discover the six-degree step",
      concept: "Sixty seconds share 360 degrees",
      explanation:
        "The second hand makes one 360° trip through 60 positions. Dividing 360 by 60 gives the angle between neighboring seconds.",
      mission: "How many degrees does the second hand turn for each second? Choose before running.",
      starter: `positions = 60
full_turn = 360
degrees_per_second = full_turn / positions
print(degrees_per_second)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Find the pattern",
        prompt: "How many degrees separate two neighboring seconds?",
        choices: [["6", "6°"], ["12", "12°"], ["60", "60°"]],
        correct: "6",
        incorrect: "One full turn is 360°. Dividing by 60 seconds gives 6° each.",
      },
      hints: ["There are 60 equal positions.", "Calculate 360 / 60."],
      success: "You found the × 6 rule for seconds.",
      check: (result) => result.output === "6.0\n" && result.syntax.includes("Div")
        ? { passed: true, message: "Each second advances the hand by six degrees." }
        : { passed: false, message: "Keep the shown division unchanged." },
    },
    {
      title: "Predict a second-hand angle",
      concept: "A value becomes an angle with × 6",
      explanation:
        "Turtle’s 90° heading points to 12. Subtracting second * 6 rotates clockwise to the requested second.",
      mission: "Where will second 15 point? Predict before running.",
      starter: `second = 15
second_angle = second * 6
turtle_heading = 90 - second_angle
print(turtle_heading)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Predict the direction",
        prompt: "A heading of 0° points to which clock number?",
        choices: [["3", "3"], ["6", "6"], ["12", "12"]],
        correct: "3",
        incorrect: "At 15 seconds, the hand has turned 90° clockwise from 12 and points to 3.",
      },
      hints: ["15 × 6 = 90.", "90 - 90 gives Turtle heading 0°, which points right."],
      success: "You predicted the second hand’s direction.",
      check: (result) => result.syntax.includes("Mult") && result.output === "0\n"
        ? { passed: true, message: "Second 15 points directly toward 3." }
        : { passed: false, message: "Keep the shown second-angle calculation unchanged." },
    },
    {
      title: "Add the second hand",
      concept: "Scale a hand from the clock radius",
      explanation:
        "A second becomes an angle by multiplying it by 6. The coral hand points correctly, but it is too short to read clearly.",
      mission: "Change its length to radius * 0.82 so it nearly reaches the edge.",
      starter: SECOND_STARTER,
      hints: [
        "Keep a little breathing room inside the clock face.",
        "Replace 60 with radius * 0.82.",
      ],
      success: "Your first clock hand now reaches across the dial.",
      check: (result) =>
        hasHourNumbers(result) && hasHandAtValue(result, SECOND_COLOR, 123, 10, 6)
          ? { passed: true, message: "That second hand is easy to spot!" }
          : { passed: false, message: "Make the coral line radius * 0.82 long." },
    },
    {
      title: "Draw a fixed second hand",
      concept: "Independent challenge · mastery proof 1 of 2",
      explanation:
        "Start blank and connect the complete chain yourself: second → angle → heading → colored line.",
      mission: "Set radius = 120 and second = 20. Draw one #ff5d73 hand from the origin with length radius * 0.82 at 90 - second * 6.",
      starter: "",
      hints: [
        "Import turtle, calculate second_angle = second * 6, and return to (0, 0).",
        "Set heading to 90 - second_angle, choose #ff5d73, then forward radius * 0.82.",
      ],
      success: "Independent proof complete: your second value controls a correctly scaled hand.",
      variants: [
        {
          key: "second-hand-primary",
          mission: "Set radius = 120 and second = 20. Draw one #ff5d73 hand from the origin with length radius * 0.82 at 90 - second * 6.",
          answer: `import turtle

radius = 120
second = 20
second_angle = second * 6
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second_angle)
turtle.pencolor("${SECOND_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.82)`,
        },
        {
          key: "second-hand-fresh",
          mission: "Fresh challenge: set radius = 100 and second = 35. Draw one #ff5d73 hand with length radius * 0.82 at the calculated angle.",
          answer: `import turtle

radius = 100
second = 35
second_angle = second * 6
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second_angle)
turtle.pencolor("${SECOND_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.82)`,
        },
      ],
      check: (result, code, variant) => {
        const fresh = clockVariantKey(variant) === "second-hand-fresh";
        const radius = fresh ? 100 : 120;
        const second = fresh ? 35 : 20;
        return result.globals.radius === radius &&
          result.globals.second === second &&
          /second_angle\s*=\s*second\s*\*\s*6/.test(code) &&
          callCount(result, "forward") === 1 &&
          hasHandAtValue(result, SECOND_COLOR, radius * 0.82, second, 6)
          ? { passed: true, message: "Your formula placed the fixed second hand correctly." }
          : { passed: false, message: "Calculate from second and draw one correctly colored, scaled hand." };
      },
    },
    {
      title: "Transfer seconds into a sequence",
      concept: "Transfer challenge · mastery proof 2 of 2",
      explanation:
        "Apply the × 6 relationship without drawing. The loop must calculate from each value instead of printing copied answers.",
      mission: "Loop through seconds 0, 10, and 20 with range(0, 21, 10). Print second * 6 using one print().",
      starter: "",
      output: "print",
      hints: ["range can take start, stop, and step values.", "Put print(second * 6) inside the loop."],
      success: "Mastery proven: you transferred the second-angle rule into a loop.",
      variants: [
        {
          key: "second-sequence-primary",
          mission: "Loop through seconds 0, 10, and 20 with range(0, 21, 10). Print second * 6 using one print().",
          answer: `for second in range(0, 21, 10):
    print(second * 6)`,
        },
        {
          key: "second-sequence-fresh",
          mission: "Fresh challenge: loop through seconds 5, 15, and 25 with range(5, 26, 10). Print second * 6 using one print().",
          answer: `for second in range(5, 26, 10):
    print(second * 6)`,
        },
      ],
      check: (result, _code, variant) => {
        const fresh = clockVariantKey(variant) === "second-sequence-fresh";
        const range = fresh ? [5, 26, 10] : [0, 21, 10];
        const expected = fresh ? ["30", "90", "150"] : ["0", "60", "120"];
        return hasRangeLoop(result, range, ["print"]) &&
          callCount(result, "print") === 1 &&
          printedLines(result.output).join("|") === expected.join("|")
          ? { passed: true, message: "Your loop calculated every second angle." }
          : { passed: false, message: "Use the requested range and one print calculated from its loop variable." };
      },
    },
    {
      title: "Build a second-hand clock",
      concept: "Combine a dial and second-hand geometry",
      explanation:
        "Build from blank: one centered face and one formula-driven hand. Both should use the same radius.",
      mission: "Build a radius-130 #25324a face and a #ff5d73 hand for second 40 with length radius * 0.82.",
      starter: "",
      hints: [
        "Draw the face from (0, -radius) with circle(radius).",
        "Return to (0, 0), set heading 90 - second * 6, then draw the coral hand.",
      ],
      success: "Boss cleared: your clock face and second hand share one geometry system.",
      variants: [
        {
          key: "second-boss-primary",
          mission: "Build a radius-130 #25324a face and a #ff5d73 hand for second 40 with length radius * 0.82.",
          answer: `import turtle

radius = 130
turtle.pencolor("${FACE_COLOR}")
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)

second = 40
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second * 6)
turtle.pencolor("${SECOND_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.82)`,
        },
        {
          key: "second-boss-fresh",
          mission: "Fresh boss: build a radius-110 #25324a face and a #ff5d73 hand for second 50 with length radius * 0.82.",
          answer: `import turtle

radius = 110
turtle.pencolor("${FACE_COLOR}")
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)

second = 50
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second * 6)
turtle.pencolor("${SECOND_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.82)`,
        },
      ],
      check: (result, _code, variant) => {
        const fresh = clockVariantKey(variant) === "second-boss-fresh";
        const radius = fresh ? 110 : 130;
        const second = fresh ? 50 : 40;
        return result.globals.radius === radius &&
          result.globals.second === second &&
          callCount(result, "circle") === 1 &&
          callCount(result, "forward") === 1 &&
          hasCircularOutline(result, radius, FACE_COLOR) &&
          hasHandAtValue(result, SECOND_COLOR, radius * 0.82, second, 6)
          ? { passed: true, message: "Your dial and second hand are correctly connected." }
          : { passed: false, message: "Draw one centered face and one correctly scaled coral hand." };
      },
    },
  ]),
  ...clockUnit(4, "live-second", 120, [
    {
      title: "Discover datetime.now()",
      concept: "Python can read the current moment",
      explanation:
        "datetime.now() creates a value for right now. Its .second field always contains the current second within the minute.",
      mission: "Which values can now.second contain? Choose before running.",
      starter: `from datetime import datetime

now = datetime.now()
second = now.second
print(second)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Know the range",
        prompt: "What is the complete range of possible now.second values?",
        choices: [["0-59", "0 through 59"], ["1-60", "1 through 60"], ["0-99", "0 through 99"]],
        correct: "0-59",
        incorrect: "Seconds begin at 0 and end at 59 before the next minute starts.",
      },
      hints: ["Think about the instant a new minute begins.", "The last second comes just before 60."],
      success: "You identified the range of the live second value.",
      check: (result, code) => callCount(result, "datetime.now") === 1 &&
        /second\s*=\s*now\.second/.test(code) &&
        Number(result.output.trim()) === result.globals.second
        ? { passed: true, message: "Python read the current second from datetime." }
        : { passed: false, message: "Keep the shown datetime program unchanged." },
    },
    {
      title: "Understand what changes",
      concept: "The program reads a new moment each run",
      explanation:
        "Calling datetime.now() again can produce a different value. The variable names stay the same, but the current time inside them updates.",
      mission: "Which value may change if you wait and run this program again?",
      starter: `from datetime import datetime

now = datetime.now()
second = now.second
print("Live second:", second)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Predict a rerun",
        prompt: "What may be different on the next run?",
        choices: [["value", "The number stored in second"], ["name", "The variable name second"], ["field", "The field name .second"]],
        correct: "value",
        incorrect: "The code and names stay fixed. datetime supplies a new value for the current moment.",
      },
      hints: ["The source code does not rewrite itself.", "Time continues while the variable name remains second."],
      success: "You understand that rerunning refreshes the time value.",
      check: (result, code) => callCount(result, "datetime.now") === 1 &&
        /second\s*=\s*now\.second/.test(code) &&
        result.output.startsWith("Live second: ")
        ? { passed: true, message: "Each run reads the current value into the same variable." }
        : { passed: false, message: "Keep the shown datetime program unchanged." },
    },
    {
      title: "Make every second tick",
      concept: "Connect the hand to real time",
      explanation:
        "datetime.now() gives Python the current moment. Once this challenge passes, the browser reruns your Python every second and the hand keeps ticking.",
      mission: "Replace 10 with now.second, then watch your clock come alive.",
      starter: LIVE_SECOND_STARTER,
      hints: [
        "The current moment is already stored in now.",
        "Use second = now.second.",
      ],
      success: "Tick! Python is redrawing the second hand every second.",
      live: true,
      check: (result, code) =>
        typeof result.globals.second === "number" &&
        hasHandAtValue(result, SECOND_COLOR, 123, Number(result.globals.second), 6) &&
        /second\s*=\s*now\.second/.test(code)
          ? { passed: true, message: "Your live second hand is ticking!" }
          : { passed: false, message: "Store now.second in the second variable." },
    },
    {
      title: "Build a live second hand",
      concept: "Independent challenge · mastery proof 1 of 2",
      explanation:
        "Start blank. Read the current moment, extract its second, and turn that changing value into one hand.",
      mission: "Set radius = 120, read now.second, and draw one #ff5d73 hand from the origin at 90 - second * 6 with length radius * 0.82.",
      starter: "",
      live: true,
      hints: [
        "Import datetime, store datetime.now() in now, then store now.second in second.",
        "Set the heading from second * 6 before drawing the scaled coral line.",
      ],
      success: "Independent proof complete: your hand reads and displays the live second.",
      variants: [
        {
          key: "live-second-hand-primary",
          mission: "Set radius = 120, read now.second, and draw one #ff5d73 hand from the origin at 90 - second * 6 with length radius * 0.82.",
          answer: `import turtle
from datetime import datetime

radius = 120
now = datetime.now()
second = now.second
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second * 6)
turtle.pencolor("${SECOND_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.82)`,
        },
        {
          key: "live-second-hand-fresh",
          mission: "Fresh challenge: set radius = 100, read datetime.now().second, and draw one #ff5d73 hand with length radius * 0.75.",
          answer: `import turtle
from datetime import datetime

radius = 100
now = datetime.now()
second = now.second
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second * 6)
turtle.pencolor("${SECOND_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.75)`,
        },
      ],
      check: (result, code, variant) => {
        const fresh = clockVariantKey(variant) === "live-second-hand-fresh";
        const radius = fresh ? 100 : 120;
        const scale = fresh ? 0.75 : 0.82;
        const second = Number(result.globals.second);
        return result.globals.radius === radius &&
          callCount(result, "datetime.now") === 1 &&
          /second\s*=\s*now\.second/.test(code) &&
          callCount(result, "forward") === 1 &&
          hasHandAtValue(result, SECOND_COLOR, radius * scale, second, 6)
          ? { passed: true, message: "Your live value drives the second hand." }
          : { passed: false, message: "Read now.second and use it to draw one correctly scaled coral hand." };
      },
    },
    {
      title: "Transfer live time to text",
      concept: "Transfer challenge · mastery proof 2 of 2",
      explanation:
        "Use datetime without Turtle. The printed answer must come from the current moment, not from a fixed number.",
      mission: "Read datetime.now(), store now.second in second, and print the current second with one print().",
      starter: "",
      output: "print",
      hints: ["Import datetime from the datetime module.", "Create now, assign second = now.second, then print(second)."],
      success: "Mastery proven: you transferred a live datetime field into text output.",
      variants: [
        {
          key: "live-second-print-primary",
          mission: "Read datetime.now(), store now.second in second, and print the current second with one print().",
          answer: `from datetime import datetime

now = datetime.now()
second = now.second
print(second)`,
        },
        {
          key: "live-second-print-fresh",
          mission: "Fresh challenge: read now.second and print the number of seconds until the next minute using 60 - second and one print().",
          answer: `from datetime import datetime

now = datetime.now()
second = now.second
print(60 - second)`,
        },
      ],
      check: (result, code, variant) => {
        const fresh = clockVariantKey(variant) === "live-second-print-fresh";
        const second = Number(result.globals.second);
        const expected = fresh ? 60 - second : second;
        return callCount(result, "datetime.now") === 1 &&
          /second\s*=\s*now\.second/.test(code) &&
          callCount(result, "print") === 1 &&
          Number(result.output.trim()) === expected
          ? { passed: true, message: "Your printed value came from the live clock." }
          : { passed: false, message: "Read now.second and calculate the requested output with one print." };
      },
    },
    {
      title: "Build a ticking dial",
      concept: "Combine a face and live second hand",
      explanation:
        "Create a complete live visual from blank. One radius should size both the circular face and its changing hand.",
      mission: "Build a radius-130 #25324a face and a live #ff5d73 second hand with length radius * 0.82.",
      starter: "",
      live: true,
      hints: [
        "Draw the centered face, then read second = datetime.now().second.",
        "Return to the origin and draw at heading 90 - second * 6 with the coral color.",
      ],
      success: "Boss cleared: your clock face ticks with real time.",
      variants: [
        {
          key: "live-second-boss-primary",
          mission: "Build a radius-130 #25324a face and a live #ff5d73 second hand with length radius * 0.82.",
          answer: `import turtle
from datetime import datetime

radius = 130
turtle.pencolor("${FACE_COLOR}")
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)

now = datetime.now()
second = now.second
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second * 6)
turtle.pencolor("${SECOND_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.82)`,
        },
        {
          key: "live-second-boss-fresh",
          mission: "Fresh boss: build a radius-110 #25324a face and a live #ff5d73 second hand with length radius * 0.75.",
          answer: `import turtle
from datetime import datetime

radius = 110
turtle.pencolor("${FACE_COLOR}")
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)

now = datetime.now()
second = now.second
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second * 6)
turtle.pencolor("${SECOND_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.75)`,
        },
      ],
      check: (result, code, variant) => {
        const fresh = clockVariantKey(variant) === "live-second-boss-fresh";
        const radius = fresh ? 110 : 130;
        const scale = fresh ? 0.75 : 0.82;
        const second = Number(result.globals.second);
        return result.globals.radius === radius &&
          /second\s*=\s*now\.second/.test(code) &&
          hasCircularOutline(result, radius, FACE_COLOR) &&
          hasHandAtValue(result, SECOND_COLOR, radius * scale, second, 6)
          ? { passed: true, message: "Your complete dial follows the current second." }
          : { passed: false, message: "Build the requested face and drive its coral hand from now.second." };
      },
    },
  ]),
  ...clockUnit(5, "minute", 100, [
    {
      title: "Discover the shared angle rule",
      concept: "Minutes and seconds use the same 60 positions",
      explanation:
        "A clock has 60 minute marks and 60 second marks. Because both travel through the same positions, both values use × 6 to become degrees.",
      mission: "Which angle formula should the minute hand use?",
      starter: `minute = 20
minute_angle = minute * 6
print(minute_angle)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Connect the concepts",
        prompt: "Why can minutes and seconds both use value * 6?",
        choices: [["positions", "Both have 60 positions"], ["length", "Both hands have the same length"], ["color", "Both hands have the same color"]],
        correct: "positions",
        incorrect: "Their styles differ, but both divide 360° into 60 positions.",
      },
      hints: ["Compare the number of possible seconds and minutes.", "360 / 60 = 6."],
      success: "You connected minute and second geometry.",
      check: (result) => result.syntax.includes("Mult") && result.output === "120\n"
        ? { passed: true, message: "Minute 20 maps to 120 degrees." }
        : { passed: false, message: "Keep the shown minute-angle calculation unchanged." },
    },
    {
      title: "Understand hand proportions",
      concept: "Length helps each hand communicate its job",
      explanation:
        "The second hand reaches near the edge at radius * 0.82. The minute hand is shorter and sturdier at radius * 0.66.",
      mission: "For radius 150, predict which hand is longer.",
      starter: `radius = 150
second_length = radius * 0.82
minute_length = radius * 0.66
print(second_length, minute_length)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Compare the scales",
        prompt: "Which hand is longer?",
        choices: [["second", "The second hand"], ["minute", "The minute hand"], ["equal", "They are equal"]],
        correct: "second",
        incorrect: "0.82 of the radius is greater than 0.66, so the second hand is longer.",
      },
      hints: ["Both lengths use the same radius.", "Compare 0.82 and 0.66."],
      success: "You predicted the visual hierarchy of the two hands.",
      check: (result) => {
        const [secondLength, minuteLength] = result.output.trim().split(/\s+/).map(Number);
        return isNear(secondLength, 123) && isNear(minuteLength, 99)
        ? { passed: true, message: "The 123-unit second hand is longer than the 99-unit minute hand." }
        : { passed: false, message: "Keep the shown length calculations unchanged." };
      },
    },
    {
      title: "Add the minute hand",
      concept: "Scale a second kind of hand",
      explanation:
        "Minutes also divide the dial into 60 positions, so they use the same × 6 angle. A minute hand should be sturdy and a little shorter than the second hand.",
      mission: "Change its length from 50 to radius * 0.66.",
      starter: MINUTE_STARTER,
      hints: [
        "The blue hand is the minute hand.",
        "Its final line should use turtle.forward(radius * 0.66).",
      ],
      success: "The bold blue minute hand has joined the clock.",
      live: true,
      check: (result) =>
        hasHand(result, SECOND_COLOR, 123) && hasHandAtValue(result, MINUTE_COLOR, 99, 15, 6)
          ? { passed: true, message: "Two hands, two different jobs!" }
          : { passed: false, message: "Make the blue line radius * 0.66 long." },
    },
    {
      title: "Draw a fixed minute hand",
      concept: "Independent challenge · mastery proof 1 of 2",
      explanation:
        "Start blank and translate one minute value into a correctly angled, scaled blue hand.",
      mission: "Set radius = 120 and minute = 25. Draw one #2f7ee6 hand from the origin at 90 - minute * 6 with length radius * 0.66.",
      starter: "",
      hints: [
        "Calculate minute_angle = minute * 6 and move the turtle to (0, 0).",
        "Set heading to 90 - minute_angle, choose #2f7ee6, and move radius * 0.66.",
      ],
      success: "Independent proof complete: your minute value controls its own hand.",
      variants: [
        {
          key: "minute-hand-primary",
          mission: "Set radius = 120 and minute = 25. Draw one #2f7ee6 hand from the origin at 90 - minute * 6 with length radius * 0.66.",
          answer: `import turtle

radius = 120
minute = 25
minute_angle = minute * 6
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - minute_angle)
turtle.pencolor("${MINUTE_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.66)`,
        },
        {
          key: "minute-hand-fresh",
          mission: "Fresh challenge: set radius = 100 and minute = 40. Draw one #2f7ee6 hand with length radius * 0.70 at the calculated angle.",
          answer: `import turtle

radius = 100
minute = 40
minute_angle = minute * 6
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - minute_angle)
turtle.pencolor("${MINUTE_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.70)`,
        },
      ],
      check: (result, code, variant) => {
        const fresh = clockVariantKey(variant) === "minute-hand-fresh";
        const radius = fresh ? 100 : 120;
        const minute = fresh ? 40 : 25;
        const scale = fresh ? 0.70 : 0.66;
        return result.globals.radius === radius &&
          result.globals.minute === minute &&
          /minute_angle\s*=\s*minute\s*\*\s*6/.test(code) &&
          callCount(result, "forward") === 1 &&
          hasHandAtValue(result, MINUTE_COLOR, radius * scale, minute, 6)
          ? { passed: true, message: "Your formula placed the fixed minute hand correctly." }
          : { passed: false, message: "Calculate from minute and draw one correctly scaled blue hand." };
      },
    },
    {
      title: "Transfer minute angles",
      concept: "Transfer challenge · mastery proof 2 of 2",
      explanation:
        "Apply minute * 6 in a text-only problem. A real loop must calculate all outputs from its variable.",
      mission: "Loop through minutes 0, 15, 30, and 45 with range(0, 46, 15). Print minute * 6 with one print().",
      starter: "",
      output: "print",
      hints: ["Use range(0, 46, 15).", "Put one print(minute * 6) inside the loop."],
      success: "Mastery proven: you transferred minute geometry into calculated output.",
      variants: [
        {
          key: "minute-angles-primary",
          mission: "Loop through minutes 0, 15, 30, and 45 with range(0, 46, 15). Print minute * 6 with one print().",
          answer: `for minute in range(0, 46, 15):
    print(minute * 6)`,
        },
        {
          key: "minute-angles-fresh",
          mission: "Fresh challenge: loop through minutes 5, 20, 35, and 50 with range(5, 51, 15). Print minute * 6 with one print().",
          answer: `for minute in range(5, 51, 15):
    print(minute * 6)`,
        },
      ],
      check: (result, _code, variant) => {
        const fresh = clockVariantKey(variant) === "minute-angles-fresh";
        const range = fresh ? [5, 51, 15] : [0, 46, 15];
        const expected = fresh ? ["30", "120", "210", "300"] : ["0", "90", "180", "270"];
        return hasRangeLoop(result, range, ["print"]) &&
          callCount(result, "print") === 1 &&
          printedLines(result.output).join("|") === expected.join("|")
          ? { passed: true, message: "Your loop calculated each minute angle." }
          : { passed: false, message: "Use the requested range and one calculated print inside it." };
      },
    },
    {
      title: "Build a two-hand clock",
      concept: "Combine two values with different visual roles",
      explanation:
        "Draw a fixed second and minute on one face. They share × 6, but their values, colors, and lengths must remain distinct.",
      mission: "Build a radius-120 #25324a face. Draw second 10 in #ff5d73 at radius * 0.82 and minute 35 in #2f7ee6 at radius * 0.66.",
      starter: "",
      hints: [
        "Draw the centered circle, then return to (0, 0) before each hand.",
        "Use 90 - value * 6 for both headings, with the specified color and scale for each.",
      ],
      success: "Boss cleared: two related formulas now produce two distinct hands.",
      variants: [
        {
          key: "minute-boss-primary",
          mission: "Build a radius-120 #25324a face. Draw second 10 in #ff5d73 at radius * 0.82 and minute 35 in #2f7ee6 at radius * 0.66.",
          answer: `import turtle

radius = 120
turtle.pencolor("${FACE_COLOR}")
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)

second = 10
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second * 6)
turtle.pencolor("${SECOND_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.82)

minute = 35
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - minute * 6)
turtle.pencolor("${MINUTE_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.66)`,
        },
        {
          key: "minute-boss-fresh",
          mission: "Fresh boss: build a radius-100 face. Draw second 50 at radius * 0.80 and minute 20 at radius * 0.65 using the same colors.",
          answer: `import turtle

radius = 100
turtle.pencolor("${FACE_COLOR}")
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)

second = 50
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second * 6)
turtle.pencolor("${SECOND_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.80)

minute = 20
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - minute * 6)
turtle.pencolor("${MINUTE_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.65)`,
        },
      ],
      check: (result, _code, variant) => {
        const fresh = clockVariantKey(variant) === "minute-boss-fresh";
        const radius = fresh ? 100 : 120;
        const second = fresh ? 50 : 10;
        const minute = fresh ? 20 : 35;
        const secondScale = fresh ? 0.80 : 0.82;
        const minuteScale = fresh ? 0.65 : 0.66;
        return result.globals.radius === radius &&
          callCount(result, "circle") === 1 &&
          callCount(result, "forward") === 2 &&
          hasCircularOutline(result, radius, FACE_COLOR) &&
          hasHandAtValue(result, SECOND_COLOR, radius * secondScale, second, 6) &&
          hasHandAtValue(result, MINUTE_COLOR, radius * minuteScale, minute, 6)
          ? { passed: true, message: "Both hands share the geometry while keeping their own roles." }
          : { passed: false, message: "Build one face and both correctly colored, angled, scaled hands." };
      },
    },
  ]),
  ...clockUnit(6, "live-minute", 120, [
    {
      title: "Discover now.minute",
      concept: "One moment contains several useful fields",
      explanation:
        "The same datetime value has .second, .minute, and .hour fields. Reading .minute gives a number from 0 through 59.",
      mission: "Which field reads the current minute?",
      starter: `from datetime import datetime

now = datetime.now()
minute = now.minute
print(minute)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Choose the field",
        prompt: "Which expression supplies the current minute?",
        choices: [["minute", "now.minute"], ["second", "now.second"], ["hour", "now.hour"]],
        correct: "minute",
        incorrect: "The minute field is accessed with now.minute.",
      },
      hints: ["The object is named now.", "The field after the dot matches the value you need."],
      success: "You selected the datetime field for minutes.",
      check: (result, code) => /minute\s*=\s*now\.minute/.test(code) &&
        Number(result.output.trim()) === result.globals.minute
        ? { passed: true, message: "Python read the current minute." }
        : { passed: false, message: "Keep the shown now.minute program unchanged." },
    },
    {
      title: "Understand its schedule",
      concept: "Different time fields change at different rates",
      explanation:
        "The program may redraw every second, but .minute keeps its value until the next minute boundary. Then it increases once.",
      mission: "Which hand usually moves first if this program reruns one second later?",
      starter: `from datetime import datetime

now = datetime.now()
second = now.second
minute = now.minute
print(second, minute)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Predict the update",
        prompt: "One second later, which value usually changes?",
        choices: [["second", "second"], ["minute", "minute"], ["both", "both every time"]],
        correct: "second",
        incorrect: "Seconds usually change on every rerun; minutes change only at the minute boundary.",
      },
      hints: ["A minute contains 60 seconds.", "The minute value waits for its boundary."],
      success: "You understand that time fields update on different schedules.",
      check: (result, code) => /second\s*=\s*now\.second/.test(code) &&
        /minute\s*=\s*now\.minute/.test(code) &&
        printedLines(result.output).length === 1
        ? { passed: true, message: "The two fields came from one current moment." }
        : { passed: false, message: "Keep the shown datetime program unchanged." },
    },
    {
      title: "Follow the current minute",
      concept: "Connect a second hand to live data",
      explanation:
        "The program redraws every second, but now.minute only changes at the next minute boundary. That means the blue hand moves exactly when a real minute changes.",
      mission: "Replace 15 with now.minute to connect the blue hand to real time.",
      starter: LIVE_MINUTE_STARTER,
      hints: [
        "This is just like reading now.second.",
        "Use minute = now.minute.",
      ],
      success: "Your minute hand now advances with the real clock.",
      live: true,
      check: (result, code) =>
        typeof result.globals.minute === "number" &&
        hasHandAtValue(result, MINUTE_COLOR, 99, Number(result.globals.minute), 6) &&
        /minute\s*=\s*now\.minute/.test(code)
          ? { passed: true, message: "The minute hand is synced!" }
          : { passed: false, message: "Store now.minute in the minute variable." },
    },
    {
      title: "Build a live minute hand",
      concept: "Independent challenge · mastery proof 1 of 2",
      explanation:
        "Start blank. Read the live minute and make it control one blue hand without relying on copied starter code.",
      mission: "Set radius = 120, read now.minute, and draw one #2f7ee6 hand from the origin at 90 - minute * 6 with length radius * 0.66.",
      starter: "",
      live: true,
      hints: [
        "Import datetime, create now, and assign minute = now.minute.",
        "Use the minute in the heading and draw the specified scaled blue line.",
      ],
      success: "Independent proof complete: your blue hand follows the current minute.",
      variants: [
        {
          key: "live-minute-hand-primary",
          mission: "Set radius = 120, read now.minute, and draw one #2f7ee6 hand from the origin at 90 - minute * 6 with length radius * 0.66.",
          answer: `import turtle
from datetime import datetime

radius = 120
now = datetime.now()
minute = now.minute
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - minute * 6)
turtle.pencolor("${MINUTE_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.66)`,
        },
        {
          key: "live-minute-hand-fresh",
          mission: "Fresh challenge: set radius = 100, read now.minute, and draw one #2f7ee6 hand with length radius * 0.70.",
          answer: `import turtle
from datetime import datetime

radius = 100
now = datetime.now()
minute = now.minute
turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - minute * 6)
turtle.pencolor("${MINUTE_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.70)`,
        },
      ],
      check: (result, code, variant) => {
        const fresh = clockVariantKey(variant) === "live-minute-hand-fresh";
        const radius = fresh ? 100 : 120;
        const scale = fresh ? 0.70 : 0.66;
        const minute = Number(result.globals.minute);
        return result.globals.radius === radius &&
          callCount(result, "datetime.now") === 1 &&
          /minute\s*=\s*now\.minute/.test(code) &&
          callCount(result, "forward") === 1 &&
          hasHandAtValue(result, MINUTE_COLOR, radius * scale, minute, 6)
          ? { passed: true, message: "Your live minute drives its own hand." }
          : { passed: false, message: "Read now.minute and use it to draw one correctly scaled blue hand." };
      },
    },
    {
      title: "Transfer a live time pair",
      concept: "Transfer challenge · mastery proof 2 of 2",
      explanation:
        "Read multiple fields from one datetime and report them without Turtle. The values must come from now.",
      mission: "Read now.hour and now.minute into hour and minute, then print both with one print().",
      starter: "",
      output: "print",
      hints: ["Create one now = datetime.now().", "Assign both fields, then use print(hour, minute)."],
      success: "Mastery proven: you transferred live time fields into a text result.",
      variants: [
        {
          key: "live-minute-print-primary",
          mission: "Read now.hour and now.minute into hour and minute, then print both with one print().",
          answer: `from datetime import datetime

now = datetime.now()
hour = now.hour
minute = now.minute
print(hour, minute)`,
        },
        {
          key: "live-minute-print-fresh",
          mission: "Fresh challenge: read now.minute and now.second into minute and second, then print both with one print().",
          answer: `from datetime import datetime

now = datetime.now()
minute = now.minute
second = now.second
print(minute, second)`,
        },
      ],
      check: (result, code, variant) => {
        const fresh = clockVariantKey(variant) === "live-minute-print-fresh";
        const expected = fresh
          ? `${result.globals.minute} ${result.globals.second}`
          : `${result.globals.hour} ${result.globals.minute}`;
        const fieldsUsed = fresh
          ? /minute\s*=\s*now\.minute/.test(code) && /second\s*=\s*now\.second/.test(code)
          : /hour\s*=\s*now\.hour/.test(code) && /minute\s*=\s*now\.minute/.test(code);
        return callCount(result, "datetime.now") === 1 &&
          fieldsUsed &&
          callCount(result, "print") === 1 &&
          result.output.trim() === expected
          ? { passed: true, message: "Both printed fields came from the same live moment." }
          : { passed: false, message: "Read the requested fields from now and report them with one print." };
      },
    },
    {
      title: "Build a live two-hand dial",
      concept: "Combine two live fields on one face",
      explanation:
        "Create a face whose second and minute hands both read the same current moment and update at their own rates.",
      mission: "Build a radius-120 #25324a face. Read now.second and now.minute; draw the coral hand at radius * 0.82 and blue hand at radius * 0.66.",
      starter: "",
      live: true,
      hints: [
        "Draw the face, create one now, and extract both fields.",
        "Return to the origin before each hand and use 90 - value * 6 with its specified style.",
      ],
      success: "Boss cleared: two hands now follow one live moment.",
      variants: [
        {
          key: "live-minute-boss-primary",
          mission: "Build a radius-120 #25324a face. Read now.second and now.minute; draw the coral hand at radius * 0.82 and blue hand at radius * 0.66.",
          answer: `import turtle
from datetime import datetime

radius = 120
turtle.pencolor("${FACE_COLOR}")
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)

now = datetime.now()
second = now.second
minute = now.minute

turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second * 6)
turtle.pencolor("${SECOND_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.82)

turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - minute * 6)
turtle.pencolor("${MINUTE_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.66)`,
        },
        {
          key: "live-minute-boss-fresh",
          mission: "Fresh boss: build a radius-100 face with live coral and blue hands at radius * 0.80 and radius * 0.65.",
          answer: `import turtle
from datetime import datetime

radius = 100
turtle.pencolor("${FACE_COLOR}")
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)

now = datetime.now()
second = now.second
minute = now.minute

turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - second * 6)
turtle.pencolor("${SECOND_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.80)

turtle.penup()
turtle.goto(0, 0)
turtle.setheading(90 - minute * 6)
turtle.pencolor("${MINUTE_COLOR}")
turtle.pendown()
turtle.forward(radius * 0.65)`,
        },
      ],
      check: (result, code, variant) => {
        const fresh = clockVariantKey(variant) === "live-minute-boss-fresh";
        const radius = fresh ? 100 : 120;
        const secondScale = fresh ? 0.80 : 0.82;
        const minuteScale = fresh ? 0.65 : 0.66;
        return /second\s*=\s*now\.second/.test(code) &&
          /minute\s*=\s*now\.minute/.test(code) &&
          hasCircularOutline(result, radius, FACE_COLOR) &&
          hasHandAtValue(result, SECOND_COLOR, radius * secondScale, Number(result.globals.second), 6) &&
          hasHandAtValue(result, MINUTE_COLOR, radius * minuteScale, Number(result.globals.minute), 6)
          ? { passed: true, message: "Your face displays both live time fields." }
          : { passed: false, message: "Build the face and drive both styled hands from the current moment." };
      },
    },
  ]),
  ...clockUnit(7, "hand-function", 120, [
    {
      title: "Discover reusable instructions",
      concept: "A function can run the same instructions many times",
      explanation:
        "The indented function body is written once. Each function call runs that body again with a new input.",
      mission: "How many lines will this program print? Choose before running.",
      starter: `def announce_hand(name):
    print("Drawing", name)

announce_hand("second")
announce_hand("minute")`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Trace the calls",
        prompt: "How many times does the one print() instruction execute?",
        choices: [["2", "2 times"], ["1", "1 time"], ["0", "0 times"]],
        correct: "2",
        incorrect: "There are two calls to announce_hand, so its body executes twice.",
      },
      hints: ["Find the calls below the function.", "Each call runs the indented body once."],
      success: "You connected two calls to two executions of one function body.",
      check: (result) => hasFunctionDefinition(result, "announce_hand", ["name"], ["print"]) &&
        callCount(result, "print") === 1 &&
        result.output === "Drawing second\nDrawing minute\n"
        ? { passed: true, message: "One reusable body handled both calls." }
        : { passed: false, message: "Keep the shown function example unchanged." },
    },
    {
      title: "Understand parameter flow",
      concept: "Parameters receive arguments from each call",
      explanation:
        "The names radius and scale are parameters. A call supplies their values, and return sends the calculated result back.",
      mission: "Predict the returned hand length before running.",
      starter: `def hand_length(radius, scale):
    return radius * scale

minute_length = hand_length(100, 0.66)
print(minute_length)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Follow the arguments",
        prompt: "What does hand_length(100, 0.66) return?",
        choices: [["66", "66"], ["100", "100"], ["166", "166"]],
        correct: "66",
        incorrect: "Inside the function, radius * scale becomes 100 * 0.66 = 66.",
      },
      hints: ["radius receives 100.", "scale receives 0.66, then the function multiplies them."],
      success: "You traced arguments through parameters to a returned result.",
      check: (result) => hasFunctionDefinition(result, "hand_length", ["radius", "scale"], []) &&
        result.output === "66.0\n"
        ? { passed: true, message: "The parameter values produced a 66-unit hand." }
        : { passed: false, message: "Keep the shown parameter example unchanged." },
    },
    {
      title: "Build a hand-drawing function",
      concept: "Functions remove repeated Turtle instructions",
      explanation:
        "Both hands repeat the same seven turtle moves. draw_hand bundles those moves together and receives the angle, length, color, and width as parameters.",
      mission: "Inside draw_hand, replace 30 with the length parameter.",
      starter: FUNCTION_STARTER,
      hints: [
        "A parameter behaves like a variable inside its function.",
        "Use turtle.forward(length).",
      ],
      success: "One reusable function now draws hands of every style.",
      live: true,
      check: (result, code) =>
        hasFunctionDefinition(result, "draw_hand", ["angle", "length", "color", "width"], ["forward"]) &&
        /turtle\.forward\(\s*length\s*\)/.test(code) &&
        hasHand(result, SECOND_COLOR, 123) &&
        hasHand(result, MINUTE_COLOR, 99)
          ? { passed: true, message: "Your draw_hand function works twice!" }
          : { passed: false, message: "Use length in the function's forward command." },
    },
    {
      title: "Write draw_hand yourself",
      concept: "Independent challenge · mastery proof 1 of 2",
      explanation:
        "Start blank. Define the four-parameter function and prove that different calls create different hands.",
      mission: "Define draw_hand(angle, length, color, width) with one forward(length). Call it for a 60° coral hand of length 90 and a 180° blue hand of length 70.",
      starter: "",
      hints: [
        "Inside the function: lift, goto(0, 0), setheading(90 - angle), style, lower, and forward(length).",
        "After the definition, call draw_hand(60, 90, '#ff5d73', 3) and draw_hand(180, 70, '#2f7ee6', 5).",
      ],
      success: "Independent proof complete: one parameterized function drew two distinct hands.",
      variants: [
        {
          key: "hand-function-primary",
          mission: "Define draw_hand(angle, length, color, width) with one forward(length). Call it for a 60° coral hand of length 90 and a 180° blue hand of length 70.",
          answer: `import turtle

def draw_hand(angle, length, color, width):
    turtle.penup()
    turtle.goto(0, 0)
    turtle.setheading(90 - angle)
    turtle.pencolor(color)
    turtle.pensize(width)
    turtle.pendown()
    turtle.forward(length)

draw_hand(60, 90, "${SECOND_COLOR}", 3)
draw_hand(180, 70, "${MINUTE_COLOR}", 5)`,
        },
        {
          key: "hand-function-fresh",
          mission: "Fresh challenge: define the same four-parameter draw_hand with one forward. Call it for a 120° coral hand of length 80 and a 240° blue hand of length 60.",
          answer: `import turtle

def draw_hand(angle, length, color, width):
    turtle.penup()
    turtle.goto(0, 0)
    turtle.setheading(90 - angle)
    turtle.pencolor(color)
    turtle.pensize(width)
    turtle.pendown()
    turtle.forward(length)

draw_hand(120, 80, "${SECOND_COLOR}", 3)
draw_hand(240, 60, "${MINUTE_COLOR}", 5)`,
        },
      ],
      check: (result, code, variant) => {
        const fresh = clockVariantKey(variant) === "hand-function-fresh";
        const secondAngle = fresh ? 120 : 60;
        const secondLength = fresh ? 80 : 90;
        const minuteAngle = fresh ? 240 : 180;
        const minuteLength = fresh ? 60 : 70;
        return hasFunctionDefinition(result, "draw_hand", ["angle", "length", "color", "width"], ["goto", "setheading", "pencolor", "forward"]) &&
          /forward\(\s*length\s*\)/.test(code) &&
          callCount(result, "forward") === 1 &&
          callCount(result, "draw_hand") === 2 &&
          hasHandAtValue(result, SECOND_COLOR, secondLength, secondAngle, 1) &&
          hasHandAtValue(result, MINUTE_COLOR, minuteLength, minuteAngle, 1)
          ? { passed: true, message: "Your reusable function drew both requested hands." }
          : { passed: false, message: "Define the four parameters once, use one forward(length), and make both calls." };
      },
    },
    {
      title: "Transfer parameters to text",
      concept: "Transfer challenge · mastery proof 2 of 2",
      explanation:
        "Prove the reusable-function idea outside Turtle. One print instruction in a parameterized function must handle two different calls.",
      mission: "Define describe_hand(name, length) with one print(name, length). Call it for second 100 and minute 80.",
      starter: "",
      output: "print",
      hints: ["The two parameters are name and length.", "Indent one print(name, length), then make both calls below the function."],
      success: "Mastery proven: you transferred parameters and reuse into a new output problem.",
      variants: [
        {
          key: "hand-function-transfer-primary",
          mission: "Define describe_hand(name, length) with one print(name, length). Call it for second 100 and minute 80.",
          answer: `def describe_hand(name, length):
    print(name, length)

describe_hand("second", 100)
describe_hand("minute", 80)`,
        },
        {
          key: "hand-function-transfer-fresh",
          mission: "Fresh challenge: define report_color(name, color) with one print(name, color). Call it for hour purple and second coral.",
          answer: `def report_color(name, color):
    print(name, color)

report_color("hour", "purple")
report_color("second", "coral")`,
        },
      ],
      check: (result, _code, variant) => {
        const fresh = clockVariantKey(variant) === "hand-function-transfer-fresh";
        const name = fresh ? "report_color" : "describe_hand";
        const parameters = fresh ? ["name", "color"] : ["name", "length"];
        const expected = fresh ? "hour purple\nsecond coral\n" : "second 100\nminute 80\n";
        return hasFunctionDefinition(result, name, parameters, ["print"]) &&
          callCount(result, "print") === 1 &&
          callCount(result, name) === 2 &&
          result.output === expected
          ? { passed: true, message: "One parameterized body handled both text calls." }
          : { passed: false, message: "Define the requested two-parameter function with one print, then call it twice." };
      },
    },
    {
      title: "Draw three hands with one function",
      concept: "A reusable abstraction replaces copied Turtle commands",
      explanation:
        "Create three clock hands from blank. The drawing sequence belongs inside one function and each hand should be only a call.",
      mission: "Define draw_hand(angle, length, color, width) with one forward(length). Call it for second 10, minute 20, and hour 3 using lengths 100, 80, and 55 and the clock colors.",
      starter: "",
      hints: [
        "Put every Turtle movement and style instruction inside draw_hand.",
        "Call with second * 6, minute * 6, and hour * 30; only the function body should contain forward.",
      ],
      success: "Boss cleared: one function now owns all three drawing sequences.",
      variants: [
        {
          key: "hand-function-boss-primary",
          mission: "Define draw_hand(angle, length, color, width) with one forward(length). Call it for second 10, minute 20, and hour 3 using lengths 100, 80, and 55 and the clock colors.",
          answer: `import turtle

def draw_hand(angle, length, color, width):
    turtle.penup()
    turtle.goto(0, 0)
    turtle.setheading(90 - angle)
    turtle.pencolor(color)
    turtle.pensize(width)
    turtle.pendown()
    turtle.forward(length)

second = 10
minute = 20
hour = 3
draw_hand(second * 6, 100, "${SECOND_COLOR}", 3)
draw_hand(minute * 6, 80, "${MINUTE_COLOR}", 5)
draw_hand(hour * 30, 55, "${HOUR_COLOR}", 7)`,
        },
        {
          key: "hand-function-boss-fresh",
          mission: "Fresh boss: use one draw_hand function for second 50, minute 40, and hour 8 with lengths 90, 70, and 50 and the clock colors.",
          answer: `import turtle

def draw_hand(angle, length, color, width):
    turtle.penup()
    turtle.goto(0, 0)
    turtle.setheading(90 - angle)
    turtle.pencolor(color)
    turtle.pensize(width)
    turtle.pendown()
    turtle.forward(length)

second = 50
minute = 40
hour = 8
draw_hand(second * 6, 90, "${SECOND_COLOR}", 3)
draw_hand(minute * 6, 70, "${MINUTE_COLOR}", 5)
draw_hand(hour * 30, 50, "${HOUR_COLOR}", 7)`,
        },
      ],
      check: (result, _code, variant) => {
        const fresh = clockVariantKey(variant) === "hand-function-boss-fresh";
        const second = fresh ? 50 : 10;
        const minute = fresh ? 40 : 20;
        const hour = fresh ? 8 : 3;
        return hasFunctionDefinition(result, "draw_hand", ["angle", "length", "color", "width"], ["forward"]) &&
          callCount(result, "forward") === 1 &&
          callCount(result, "draw_hand") === 3 &&
          hasHandAtValue(result, SECOND_COLOR, fresh ? 90 : 100, second, 6) &&
          hasHandAtValue(result, MINUTE_COLOR, fresh ? 70 : 80, minute, 6) &&
          hasHandAtValue(result, HOUR_COLOR, fresh ? 50 : 55, hour, 30)
          ? { passed: true, message: "One draw_hand definition created all three hands." }
          : { passed: false, message: "Use one four-parameter function, one forward instruction, and three correct calls." };
      },
    },
  ]),
  ...clockUnit(8, "hour", 120, [
    {
      title: "Discover the thirty-degree step",
      concept: "Twelve hours divide one full turn",
      explanation:
        "The hour hand uses 12 equal positions instead of 60. Dividing 360° by 12 gives the angle between neighboring hours.",
      mission: "How many degrees separate one hour from the next?",
      starter: `positions = 12
full_turn = 360
degrees_per_hour = full_turn / positions
print(degrees_per_hour)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Find the hour pattern",
        prompt: "How many degrees does the hour hand turn per hour?",
        choices: [["30", "30°"], ["6", "6°"], ["12", "12°"]],
        correct: "30",
        incorrect: "A 360° turn divided by 12 hour positions gives 30° each.",
      },
      hints: ["There are 12 equal hour positions.", "Calculate 360 / 12."],
      success: "You found the × 30 rule for hours.",
      check: (result) => result.syntax.includes("Div") && result.output === "30.0\n"
        ? { passed: true, message: "Every hour advances the hand by thirty degrees." }
        : { passed: false, message: "Keep the shown hour division unchanged." },
    },
    {
      title: "Understand the shortest hand",
      concept: "The hour hand uses a smaller radius scale",
      explanation:
        "A shorter hour hand remains easy to distinguish from the minute hand. This clock uses radius * 0.48 for that compact shape.",
      mission: "Predict the hour-hand length when radius is 150.",
      starter: `radius = 150
hour_length = radius * 0.48
print(hour_length)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Calculate the scale",
        prompt: "What is radius * 0.48 when radius is 150?",
        choices: [["72", "72"], ["48", "48"], ["102", "102"]],
        correct: "72",
        incorrect: "150 × 0.48 = 72.",
      },
      hints: ["Half of 150 is 75.", "0.48 is slightly less than one half."],
      success: "You calculated the compact hour-hand length.",
      check: (result) => result.output === "72.0\n"
        ? { passed: true, message: "The hour hand will be 72 units long." }
        : { passed: false, message: "Keep the shown hour-length calculation unchanged." },
    },
    {
      title: "Call the function for hours",
      concept: "One function can create another kind of hand",
      explanation:
        "Hours have 12 positions, so each hour is 30° apart. The purple hand already uses draw_hand, but it needs the short, powerful proportions of an hour hand.",
      mission: "Replace its length of 30 with radius * 0.48.",
      starter: HOUR_STARTER,
      hints: [
        "Find the final draw_hand call—the purple one.",
        "Its second argument should be radius * 0.48.",
      ],
      success: "Your function created a third hand without copied turtle moves.",
      live: true,
      check: (result, code) =>
        hasFunctionDefinition(result, "draw_hand", ["angle", "length", "color", "width"], ["forward"]) &&
        hasHandAtValue(result, HOUR_COLOR, 72, 3, 30) &&
        /draw_hand\(\s*hour\s*\*\s*30\s*,\s*radius\s*\*\s*0\.48/.test(code)
          ? { passed: true, message: "The hour hand is strong and clear!" }
          : { passed: false, message: "Give the hour draw_hand call a radius * 0.48 length." },
    },
    {
      title: "Create an hour hand through a function",
      concept: "Independent challenge · mastery proof 1 of 2",
      explanation:
        "Start blank. Define the reusable drawing behavior and use an hour value to supply its angle.",
      mission: "Set radius = 120 and hour = 7. Define draw_hand(angle, length, color, width) with one forward(length), then call it for hour * 30, radius * 0.48, and #7c3aed.",
      starter: "",
      hints: [
        "Define all four parameters and set heading to 90 - angle inside the function.",
        "Call draw_hand(hour * 30, radius * 0.48, '#7c3aed', 7).",
      ],
      success: "Independent proof complete: your hour formula flows through a reusable function.",
      variants: [
        {
          key: "hour-hand-primary",
          mission: "Set radius = 120 and hour = 7. Define draw_hand(angle, length, color, width) with one forward(length), then call it for hour * 30, radius * 0.48, and #7c3aed.",
          answer: `import turtle

radius = 120
hour = 7

def draw_hand(angle, length, color, width):
    turtle.penup()
    turtle.goto(0, 0)
    turtle.setheading(90 - angle)
    turtle.pencolor(color)
    turtle.pensize(width)
    turtle.pendown()
    turtle.forward(length)

draw_hand(hour * 30, radius * 0.48, "${HOUR_COLOR}", 7)`,
        },
        {
          key: "hour-hand-fresh",
          mission: "Fresh challenge: set radius = 100 and hour = 11. Define the same draw_hand function and call it for hour * 30 with length radius * 0.50 in #7c3aed.",
          answer: `import turtle

radius = 100
hour = 11

def draw_hand(angle, length, color, width):
    turtle.penup()
    turtle.goto(0, 0)
    turtle.setheading(90 - angle)
    turtle.pencolor(color)
    turtle.pensize(width)
    turtle.pendown()
    turtle.forward(length)

draw_hand(hour * 30, radius * 0.50, "${HOUR_COLOR}", 7)`,
        },
      ],
      check: (result, code, variant) => {
        const fresh = clockVariantKey(variant) === "hour-hand-fresh";
        const radius = fresh ? 100 : 120;
        const hour = fresh ? 11 : 7;
        const scale = fresh ? 0.50 : 0.48;
        return result.globals.radius === radius &&
          result.globals.hour === hour &&
          hasFunctionDefinition(result, "draw_hand", ["angle", "length", "color", "width"], ["forward"]) &&
          /draw_hand\(\s*hour\s*\*\s*30/.test(code) &&
          callCount(result, "forward") === 1 &&
          hasHandAtValue(result, HOUR_COLOR, radius * scale, hour, 30)
          ? { passed: true, message: "Your function turned the hour value into the correct hand." }
          : { passed: false, message: "Use one four-parameter function and call it from hour * 30 with the requested scale." };
      },
    },
    {
      title: "Transfer hour angles",
      concept: "Transfer challenge · mastery proof 2 of 2",
      explanation:
        "Prove the × 30 rule independently of Turtle. One loop must calculate several hour angles.",
      mission: "Loop through hours 1 through 4 and print hour * 30 with one print().",
      starter: "",
      output: "print",
      hints: ["Use range(1, 5).", "Put one print(hour * 30) inside the loop."],
      success: "Mastery proven: you transferred hour geometry into numeric output.",
      variants: [
        {
          key: "hour-angles-primary",
          mission: "Loop through hours 1 through 4 and print hour * 30 with one print().",
          answer: `for hour in range(1, 5):
    print(hour * 30)`,
        },
        {
          key: "hour-angles-fresh",
          mission: "Fresh challenge: loop through hours 5 through 8 and print hour * 30 with one print().",
          answer: `for hour in range(5, 9):
    print(hour * 30)`,
        },
      ],
      check: (result, _code, variant) => {
        const fresh = clockVariantKey(variant) === "hour-angles-fresh";
        const range = fresh ? [5, 9] : [1, 5];
        const expected = fresh ? ["150", "180", "210", "240"] : ["30", "60", "90", "120"];
        return hasRangeLoop(result, range, ["print"]) &&
          callCount(result, "print") === 1 &&
          printedLines(result.output).join("|") === expected.join("|")
          ? { passed: true, message: "Your loop calculated all requested hour angles." }
          : { passed: false, message: "Use the requested range and one print calculated from hour." };
      },
    },
    {
      title: "Build a three-hand clock",
      concept: "Combine all fixed hand formulas through one function",
      explanation:
        "Build a face and all three fixed hands. One draw_hand body should own the only forward instruction used for hands.",
      mission: "Build a radius-120 face and one draw_hand function. Show second 10, minute 25, and hour 8 at scales 0.82, 0.66, and 0.48 in the clock colors.",
      starter: "",
      hints: [
        "Draw circle(radius), then define draw_hand with forward(length).",
        "Make three calls using value * 6, value * 6, and value * 30 with their specified scales and colors.",
      ],
      success: "Boss cleared: one function assembled the face’s complete fixed time display.",
      variants: [
        {
          key: "hour-boss-primary",
          mission: "Build a radius-120 face and one draw_hand function. Show second 10, minute 25, and hour 8 at scales 0.82, 0.66, and 0.48 in the clock colors.",
          answer: `import turtle

radius = 120
turtle.pencolor("${FACE_COLOR}")
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)

def draw_hand(angle, length, color, width):
    turtle.penup()
    turtle.goto(0, 0)
    turtle.setheading(90 - angle)
    turtle.pencolor(color)
    turtle.pensize(width)
    turtle.pendown()
    turtle.forward(length)

second = 10
minute = 25
hour = 8
draw_hand(second * 6, radius * 0.82, "${SECOND_COLOR}", 3)
draw_hand(minute * 6, radius * 0.66, "${MINUTE_COLOR}", 5)
draw_hand(hour * 30, radius * 0.48, "${HOUR_COLOR}", 7)`,
        },
        {
          key: "hour-boss-fresh",
          mission: "Fresh boss: build a radius-100 face with second 50, minute 40, and hour 2 at scales 0.80, 0.65, and 0.50 through one draw_hand function.",
          answer: `import turtle

radius = 100
turtle.pencolor("${FACE_COLOR}")
turtle.penup()
turtle.goto(0, -radius)
turtle.setheading(0)
turtle.pendown()
turtle.circle(radius)

def draw_hand(angle, length, color, width):
    turtle.penup()
    turtle.goto(0, 0)
    turtle.setheading(90 - angle)
    turtle.pencolor(color)
    turtle.pensize(width)
    turtle.pendown()
    turtle.forward(length)

second = 50
minute = 40
hour = 2
draw_hand(second * 6, radius * 0.80, "${SECOND_COLOR}", 3)
draw_hand(minute * 6, radius * 0.65, "${MINUTE_COLOR}", 5)
draw_hand(hour * 30, radius * 0.50, "${HOUR_COLOR}", 7)`,
        },
      ],
      check: (result, _code, variant) => {
        const fresh = clockVariantKey(variant) === "hour-boss-fresh";
        const radius = fresh ? 100 : 120;
        return hasFunctionDefinition(result, "draw_hand", ["angle", "length", "color", "width"], ["forward"]) &&
          callCount(result, "circle") === 1 &&
          callCount(result, "forward") === 1 &&
          callCount(result, "draw_hand") === 3 &&
          hasCircularOutline(result, radius, FACE_COLOR) &&
          hasHandAtValue(result, SECOND_COLOR, radius * (fresh ? 0.80 : 0.82), fresh ? 50 : 10, 6) &&
          hasHandAtValue(result, MINUTE_COLOR, radius * (fresh ? 0.65 : 0.66), fresh ? 40 : 25, 6) &&
          hasHandAtValue(result, HOUR_COLOR, radius * (fresh ? 0.50 : 0.48), fresh ? 2 : 8, 30)
          ? { passed: true, message: "Your function and formulas built all three hands." }
          : { passed: false, message: "Build one face and use one draw_hand definition for all three requested values." };
      },
    },
  ]),
  ...clockUnit(9, "live-clock", 140, [
    {
      title: "Discover twelve-hour conversion",
      concept: "% 12 wraps 24-hour values around the dial",
      explanation:
        "datetime reports hours from 0 through 23. The remainder operator % 12 converts afternoon hours back to the clock’s 12 positions.",
      mission: "What does 14 % 12 produce? Choose before running.",
      starter: `hour_24 = 14
hour_12 = hour_24 % 12
print(hour_12)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Wrap the value",
        prompt: "Which clock position matches hour 14?",
        choices: [["2", "2"], ["12", "12"], ["14", "14"]],
        correct: "2",
        incorrect: "14 divided by 12 leaves a remainder of 2, so 14:00 points to 2.",
      },
      hints: ["Subtract one complete group of 12.", "14 - 12 = 2."],
      success: "You converted a 24-hour value to its dial position.",
      check: (result) => result.syntax.includes("Mod") && result.output === "2\n"
        ? { passed: true, message: "Hour 14 wraps to clock position 2." }
        : { passed: false, message: "Keep the shown modulo calculation unchanged." },
    },
    {
      title: "Understand all three formulas",
      concept: "Each live field has a matching angle rule",
      explanation:
        "Seconds and minutes each use 60 positions, so both multiply by 6. Hours use 12 positions, so they multiply by 30 after % 12.",
      mission: "Which formula belongs to the hour hand?",
      starter: `second = 10
minute = 20
hour_24 = 15

second_angle = second * 6
minute_angle = minute * 6
hour_angle = (hour_24 % 12) * 30
print(second_angle, minute_angle, hour_angle)`,
      readOnly: true,
      output: "print",
      question: {
        eyebrow: "Match value to rule",
        prompt: "Which expression calculates the hour angle?",
        choices: [["hour", "(hour_24 % 12) * 30"], ["minute", "minute * 6"], ["second", "second * 6"]],
        correct: "hour",
        incorrect: "The hour first wraps to 12 positions with % 12, then each position contributes 30°.",
      },
      hints: ["Only hours may arrive as a 24-hour value.", "Hours have 12 positions, not 60."],
      success: "You matched every time field to its angle formula.",
      check: (result) => result.syntax.includes("Mod") && result.output === "60 120 90\n"
        ? { passed: true, message: "All three angle calculations agree." }
        : { passed: false, message: "Keep the shown three formulas unchanged." },
    },
    {
      title: "Launch the complete live clock",
      concept: "Connect the final hand to real time",
      explanation:
        "The final missing piece is the real hour. Converting 24-hour time with % 12 gives the familiar position on an analog clock.",
      mission: "Replace 3 with datetime's current hour converted using now.hour % 12.",
      starter: LIVE_HOUR_STARTER,
      hints: [
        "% 12 turns hour 13 into 1, hour 14 into 2, and so on.",
        "Use hour = now.hour % 12.",
      ],
      success: "Your live Python clock is complete—every hand follows real time!",
      live: true,
      check: (result, code) =>
        typeof result.globals.hour === "number" &&
        /hour\s*=\s*now\.hour\s*%\s*12/.test(code) &&
        hasClockFace(result) &&
        hasHourNumbers(result) &&
        hasHandAtValue(result, SECOND_COLOR, 123, Number(result.globals.second), 6) &&
        hasHandAtValue(result, MINUTE_COLOR, 99, Number(result.globals.minute), 6) &&
        hasHandAtValue(result, HOUR_COLOR, 72, Number(result.globals.hour), 30) &&
        hasFunctionDefinition(result, "draw_hand", ["angle", "length", "color", "width"], ["forward"])
          ? { passed: true, message: "All three hands are live!" }
          : { passed: false, message: "Set hour to now.hour % 12 and keep all three draw_hand calls." },
    },
    {
      title: "Write the live hand system",
      concept: "Independent challenge · mastery proof 1 of 2",
      explanation:
        "Start blank. Read all three time fields and use one reusable function to display them as three distinct hands.",
      mission: "Set radius = 120. Read second, minute, and hour = now.hour % 12. Define draw_hand with one forward(length), then draw all three live hands at scales 0.82, 0.66, and 0.48.",
      starter: "",
      live: true,
      hints: [
        "Create one now and extract all three fields before defining draw_hand.",
        "Use one forward(length) in the function, then call with second * 6, minute * 6, and hour * 30 in the three clock colors.",
      ],
      success: "Independent proof complete: your reusable system displays all three live values.",
      variants: [
        {
          key: "live-clock-hands-primary",
          mission: "Set radius = 120. Read second, minute, and hour = now.hour % 12. Define draw_hand with one forward(length), then draw all three live hands at scales 0.82, 0.66, and 0.48.",
          answer: `import turtle
from datetime import datetime

radius = 120
now = datetime.now()
second = now.second
minute = now.minute
hour = now.hour % 12

def draw_hand(angle, length, color, width):
    turtle.penup()
    turtle.goto(0, 0)
    turtle.setheading(90 - angle)
    turtle.pencolor(color)
    turtle.pensize(width)
    turtle.pendown()
    turtle.forward(length)

draw_hand(second * 6, radius * 0.82, "${SECOND_COLOR}", 3)
draw_hand(minute * 6, radius * 0.66, "${MINUTE_COLOR}", 5)
draw_hand(hour * 30, radius * 0.48, "${HOUR_COLOR}", 7)`,
        },
        {
          key: "live-clock-hands-fresh",
          mission: "Fresh challenge: set radius = 100, read all three live values, and use one draw_hand function with scales 0.80, 0.65, and 0.50.",
          answer: `import turtle
from datetime import datetime

radius = 100
now = datetime.now()
second = now.second
minute = now.minute
hour = now.hour % 12

def draw_hand(angle, length, color, width):
    turtle.penup()
    turtle.goto(0, 0)
    turtle.setheading(90 - angle)
    turtle.pencolor(color)
    turtle.pensize(width)
    turtle.pendown()
    turtle.forward(length)

draw_hand(second * 6, radius * 0.80, "${SECOND_COLOR}", 3)
draw_hand(minute * 6, radius * 0.65, "${MINUTE_COLOR}", 5)
draw_hand(hour * 30, radius * 0.50, "${HOUR_COLOR}", 7)`,
        },
      ],
      check: (result, code, variant) => {
        const fresh = clockVariantKey(variant) === "live-clock-hands-fresh";
        const radius = fresh ? 100 : 120;
        return result.globals.radius === radius &&
          /second\s*=\s*now\.second/.test(code) &&
          /minute\s*=\s*now\.minute/.test(code) &&
          /hour\s*=\s*now\.hour\s*%\s*12/.test(code) &&
          hasFunctionDefinition(result, "draw_hand", ["angle", "length", "color", "width"], ["forward"]) &&
          callCount(result, "forward") === 1 &&
          callCount(result, "draw_hand") === 3 &&
          hasHandAtValue(result, SECOND_COLOR, radius * (fresh ? 0.80 : 0.82), Number(result.globals.second), 6) &&
          hasHandAtValue(result, MINUTE_COLOR, radius * (fresh ? 0.65 : 0.66), Number(result.globals.minute), 6) &&
          hasHandAtValue(result, HOUR_COLOR, radius * (fresh ? 0.50 : 0.48), Number(result.globals.hour), 30)
          ? { passed: true, message: "Your one function displays all three live values." }
          : { passed: false, message: "Read all three live fields and use one draw_hand definition for the three styled hands." };
      },
    },
    {
      title: "Transfer live time to a report",
      concept: "Transfer challenge · mastery proof 2 of 2",
      explanation:
        "Use the complete time-reading logic without Turtle. One print must report values extracted from the same live moment.",
      mission: "Read second, minute, and hour = now.hour % 12, then print hour, minute, second with one print().",
      starter: "",
      output: "print",
      hints: ["Create one now and assign all three fields.", "Use one print(hour, minute, second)."],
      success: "Mastery proven: you transferred the full live time model into text output.",
      variants: [
        {
          key: "live-clock-report-primary",
          mission: "Read second, minute, and hour = now.hour % 12, then print hour, minute, second with one print().",
          answer: `from datetime import datetime

now = datetime.now()
second = now.second
minute = now.minute
hour = now.hour % 12
print(hour, minute, second)`,
        },
        {
          key: "live-clock-report-fresh",
          mission: "Fresh challenge: read all three live values and print their angles—hour * 30, minute * 6, second * 6—with one print().",
          answer: `from datetime import datetime

now = datetime.now()
second = now.second
minute = now.minute
hour = now.hour % 12
print(hour * 30, minute * 6, second * 6)`,
        },
      ],
      check: (result, code, variant) => {
        const fresh = clockVariantKey(variant) === "live-clock-report-fresh";
        const hour = Number(result.globals.hour);
        const minute = Number(result.globals.minute);
        const second = Number(result.globals.second);
        const expected = fresh
          ? `${hour * 30} ${minute * 6} ${second * 6}`
          : `${hour} ${minute} ${second}`;
        return /second\s*=\s*now\.second/.test(code) &&
          /minute\s*=\s*now\.minute/.test(code) &&
          /hour\s*=\s*now\.hour\s*%\s*12/.test(code) &&
          callCount(result, "print") === 1 &&
          result.output.trim() === expected
          ? { passed: true, message: "Your report came from all three live fields." }
          : { passed: false, message: "Read the complete current time and use one print for the requested report." };
      },
    },
    {
      title: "Build the complete live clock",
      concept: "Combine the face, labels, function, and live values",
      explanation:
        "This is the complete Clock Quest. Start blank and assemble every concept into one readable, reusable live clock.",
      mission: "Build a radius-150 #25324a face, place 1-12 with one range loop, read all live fields, and draw three hands through one draw_hand function at scales 0.82, 0.66, and 0.48.",
      starter: "",
      live: true,
      hints: [
        "Build the centered circle and label loop first; use math with 90 - hour_number * 30.",
        "Create one now, define draw_hand with one forward(length), and call it for the live second, minute, and 12-hour values.",
      ],
      success: "Final boss cleared: you independently built a complete live Python clock!",
      variants: [
        {
          key: "live-clock-boss-primary",
          mission: "Build a radius-150 #25324a face, place 1-12 with one range loop, read all live fields, and draw three hands through one draw_hand function at scales 0.82, 0.66, and 0.48.",
          answer: LIVE_CLOCK_CODE,
        },
        {
          key: "live-clock-boss-fresh",
          mission: "Fresh final boss: build the complete live clock at radius 120, with hand scales 0.80, 0.65, and 0.50, while keeping one label loop and one draw_hand function.",
          answer: LIVE_CLOCK_CODE
            .replace("radius = 150", "radius = 120")
            .replace("radius * 0.82", "radius * 0.80")
            .replace("radius * 0.66", "radius * 0.65")
            .replace("radius * 0.48", "radius * 0.50"),
        },
      ],
      check: (result, code, variant) => {
        const fresh = clockVariantKey(variant) === "live-clock-boss-fresh";
        const radius = fresh ? 120 : 150;
        return result.globals.radius === radius &&
          /second\s*=\s*now\.second/.test(code) &&
          /minute\s*=\s*now\.minute/.test(code) &&
          /hour\s*=\s*now\.hour\s*%\s*12/.test(code) &&
          hasRangeLoop(result, [1, 13], ["math.radians", "math.cos", "math.sin", "write"]) &&
          hasFunctionDefinition(result, "draw_hand", ["angle", "length", "color", "width"], ["forward"]) &&
          callCount(result, "circle") === 1 &&
          callCount(result, "forward") === 1 &&
          callCount(result, "draw_hand") === 3 &&
          hasCircularOutline(result, radius, FACE_COLOR) &&
          hasHourNumbersAround(result, radius) &&
          hasHandAtValue(result, SECOND_COLOR, radius * (fresh ? 0.80 : 0.82), Number(result.globals.second), 6) &&
          hasHandAtValue(result, MINUTE_COLOR, radius * (fresh ? 0.65 : 0.66), Number(result.globals.minute), 6) &&
          hasHandAtValue(result, HOUR_COLOR, radius * (fresh ? 0.50 : 0.48), Number(result.globals.hour), 30)
          ? { passed: true, message: "Your complete live clock combines every Clock Quest concept." }
          : { passed: false, message: "Combine the requested face, label loop, live fields, and one reusable hand function." };
      },
    },
  ]),
];

const TOTAL_POINTS = CLOCK_LESSONS.reduce((total, lesson) => total + lesson.points, 0);

type WorkerMessage =
  | { type: "status"; status: "loading" | "ready" }
  | ({ type: "result"; id: number } & RunResult)
  | { type: "fatal"; error: string };

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
    !isRecord(value.analysis) ||
    !isStringArray(value.analysis.calls, 500) ||
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

type SavedProgress = CourseProgress & {
  variants: Record<string, number>;
  revealed: string[];
};

type PendingRun = {
  mode: "lesson" | "live";
  lessonIndex: number;
  code: string;
  variantIndex: number;
  answer: string | null;
};

const STORAGE_KEY = "turtle-clock-quest-progress-v1";
const TURTLE_STORAGE_KEY = "turtle-trail-progress-v1";
const CLOCK_ANSWER_STATE_PREFIX = "clock-answer-state-";
const CLOCK_MASTERY_IDS: Record<string, [independent: string, transfer: string]> = {
  "1": ["face-independent", "face-transfer"],
  "2": ["numbers-independent", "numbers-transfer"],
  "3": ["second-independent", "second-transfer"],
  "4": ["live-second-independent", "live-second-transfer"],
  "5": ["minute-independent", "minute-transfer"],
  "6": ["live-minute-independent", "live-minute-transfer"],
  "7": ["hand-function-independent", "hand-function-transfer"],
  "8": ["hour-independent", "hour-transfer"],
  "9": ["live-clock-independent", "live-clock-transfer"],
};

const clockLessonGroup = (lesson: ClockLesson) =>
  lesson.number.match(/^(\d+)[a-f]$/)?.[1] ?? null;

const reachableClockLessonIndex = (completedIds: string[]) => {
  const completed = new Set(completedIds);
  const firstIncomplete = CLOCK_LESSONS.findIndex((item) => !completed.has(item.id));
  return firstIncomplete === -1 ? CLOCK_LESSONS.length - 1 : firstIncomplete;
};
const TURTLE_COMPLETION_IDS = [
  "loop-independent",
  "loop-transfer",
  "loop-boss",
  "variable-independent",
  "variable-transfer",
  "variable-boss",
  "conditional-independent",
  "conditional-transfer",
  "conditional-boss",
  "while-independent",
  "while-transfer",
  "while-boss",
  "function-independent",
  "function-transfer",
  "function-boss",
  "parameter-independent",
  "parameter-transfer",
  "parameter-boss",
  "list-independent",
  "list-transfer",
  "list-boss",
  "module-independent",
  "module-transfer",
  "module-boss",
  "finale-independent",
  "finale-transfer",
  "finale-boss",
];

function ClockCanvas({
  commands,
  animationKey,
}: {
  commands: TurtleCommand[];
  animationKey: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lines = commands.filter((command) => command.type === "line").length;
  const labels = commands.filter((command) => command.type === "text").length;
  const drawingSummary = lines
    ? `Turtle clock drawing with ${lines} line segments and ${labels} hour labels.`
    : "Blank clock workshop canvas, ready for Python.";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(bounds.width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(bounds.height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      const width = bounds.width;
      const height = bounds.height;
      const background = [...commands]
        .reverse()
        .find((command): command is TurtleBackground => command.type === "bg")?.color ?? "#ffffff";
      const scale = Math.min((width - 58) / 340, (height - 58) / 340);
      const originX = width / 2;
      const originY = height / 2 - (width < 500 ? 18 : 0);
      const mapX = (x: number) => originX + x * scale;
      const mapY = (y: number) => originY - y * scale;

      context.clearRect(0, 0, width, height);
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      if (commands.every((command) => command.type === "bg")) {
        context.fillStyle = "#e7dccb";
        context.font = "52px system-ui";
        context.textAlign = "center";
        context.fillText("🕰️", originX, originY - 12);
        context.fillStyle = "#756b5e";
        context.font = "700 15px ui-rounded, system-ui";
        context.fillText("Run Python to build your clock", originX, originY + 32);
        return;
      }

      commands.forEach((command) => {
        if (command.type === "line") {
          context.beginPath();
          context.moveTo(mapX(command.x1), mapY(command.y1));
          context.lineTo(mapX(command.x2), mapY(command.y2));
          context.strokeStyle = command.color;
          context.lineWidth = Math.max(1.5, command.width * scale * 0.82);
          context.lineCap = "round";
          context.lineJoin = "round";
          if (normalizedColor(command.color) !== FACE_COLOR) {
            context.shadowColor = `${command.color}55`;
            context.shadowBlur = 8;
          }
          context.stroke();
          context.shadowBlur = 0;
        } else if (command.type === "dot") {
          context.beginPath();
          context.arc(mapX(command.x), mapY(command.y), (command.size * scale) / 2, 0, Math.PI * 2);
          context.fillStyle = command.color;
          context.fill();
        } else if (command.type === "text") {
          context.fillStyle = command.color;
          context.font = `800 ${Math.max(14, 18 * scale)}px ui-rounded, system-ui`;
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(command.text, mapX(command.x), mapY(command.y));
        }
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [animationKey, commands]);

  return <canvas ref={canvasRef} className="clock-canvas" role="img" aria-label={drawingSummary} />;
}

const readClockPart = (result: RunResult | null, name: "hour" | "minute" | "second") => {
  const value = result?.globals[name];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
};

const formatClockPart = (value: number | null) =>
  value === null ? "--" : String(value).padStart(2, "0");

const hasCompletedTurtleCourse = (value: unknown) => {
  if (!isRecord(value)) return false;
  const progress = isRecord(value.progress) ? value.progress : value;
  return (
    Array.isArray(progress.completed) &&
    TURTLE_COMPLETION_IDS.every((id) => progress.completed.includes(id))
  );
};

export function ClockCourse() {
  const { user, sessionStatus } = useAccount();
  const [accessStatus, setAccessStatus] = useState<"checking" | "locked" | "unlocked">("checking");
  const userId = user?.id ?? null;

  useEffect(() => {
    let localCourseComplete = false;
    try {
      const localProgress = localStorage.getItem(TURTLE_STORAGE_KEY);
      localCourseComplete = Boolean(
        localProgress && hasCompletedTurtleCourse(JSON.parse(localProgress) as unknown),
      );
    } catch {
      localStorage.removeItem(TURTLE_STORAGE_KEY);
    }

    if (sessionStatus === "loading") {
      const accessTimer = window.setTimeout(() => setAccessStatus("checking"), 0);
      return () => window.clearTimeout(accessTimer);
    }
    if (!userId) {
      const accessTimer = window.setTimeout(() => setAccessStatus("locked"), 0);
      return () => window.clearTimeout(accessTimer);
    }
    if (localCourseComplete) {
      const accessTimer = window.setTimeout(() => setAccessStatus("unlocked"), 0);
      return () => window.clearTimeout(accessTimer);
    }

    const controller = new AbortController();
    const accessTimer = window.setTimeout(() => setAccessStatus("checking"), 0);
    void fetch("/api/progress/turtle-basics", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Progress could not be checked");
        const body: unknown = await response.json();
        setAccessStatus(hasCompletedTurtleCourse(body) ? "unlocked" : "locked");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAccessStatus("locked");
      });
    return () => {
      window.clearTimeout(accessTimer);
      controller.abort();
    };
  }, [sessionStatus, userId]);

  if (accessStatus === "unlocked") return <ClockWorkshop />;

  return (
    <main className="course-shell clock-course clock-access-shell">
      <header className="course-header clock-access-header">
        <div className="brand-lockup">
          <span className="brand-mark clock-brand-mark" aria-hidden="true"><Clock3 /></span>
          <div>
            <p className="brand-name">Clock Quest</p>
            <p className="brand-subtitle">Your next Python adventure</p>
          </div>
        </div>
        <div className="header-actions">
          <Link className="course-link" href="/"><ArrowLeft /> Back to Turtle Trail</Link>
        </div>
      </header>

      <section className="clock-access-card" aria-live="polite">
        <span className={`clock-access-icon ${accessStatus}`} aria-hidden="true">
          {accessStatus === "checking" ? <Timer /> : <LockKeyhole />}
        </span>
        <p className="victory-eyebrow">
          {accessStatus === "checking"
            ? "Checking your trail…"
            : user
              ? "One adventure at a time"
              : "Sign in required"}
        </p>
        <h1>
          {accessStatus === "checking"
            ? "Finding your Python wins"
            : user
              ? "Clock Quest is your next big quest"
              : "Sign in to open Clock Quest"}
        </h1>
        <p>
          {accessStatus === "checking"
            ? "We’re checking whether your clock workshop is ready."
            : user
              ? "Finish every Turtle Trail subtopic and its independent, transfer, and boss challenges. Then you’ll use your Python powers to build a real live clock."
              : "Return to Turtle Trail and sign in with your email. Clock Quest unlocks after you finish every lesson and mastery challenge."}
        </p>
        {accessStatus === "locked" && (
          <Link className="victory-action" href="/">
            {user ? "Keep going on my trail" : "Sign in on Turtle Trail"} <span aria-hidden="true">→</span>
          </Link>
        )}
      </section>
    </main>
  );
}

function ClockWorkshop() {
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
  const [liveTick, setLiveTick] = useState(0);
  const [victoryBurst, setVictoryBurst] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const workerGenerationRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef(0);
  const runningRef = useRef(false);
  const pendingRef = useRef<PendingRun | null>(null);
  const lessonListRef = useRef<HTMLElement>(null);
  const currentLessonRef = useRef<HTMLButtonElement>(null);

  const lesson = CLOCK_LESSONS[currentIndex];
  const variantIndex = Math.min(variants[lesson.id] ?? 0, (lesson.variants?.length ?? 1) - 1);
  const variant = lesson.variants?.[variantIndex];
  const starter = variant ? "" : lesson.starter;
  const code = drafts[lesson.id] ?? starter;
  const mission = variant?.mission ?? lesson.mission;
  const completedSet = useMemo(() => new Set(completed), [completed]);
  const revealedSet = useMemo(() => new Set(revealed), [revealed]);
  const unlocked = reachableClockLessonIndex(completed);
  const currentGroup = clockLessonGroup(lesson);
  const masteryIds = currentGroup ? CLOCK_MASTERY_IDS[currentGroup] : undefined;
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
  const score = useMemo(
    () => CLOCK_LESSONS.reduce(
      (total, item) => total + (completedSet.has(item.id) ? item.points : 0),
      0,
    ),
    [completedSet],
  );
  const progress = Math.round((score / TOTAL_POINTS) * 100);
  const savedProgress = useMemo<CourseProgress>(() => {
    const syncedDrafts = { ...drafts };
    revealed.forEach((id) => {
      syncedDrafts[`${CLOCK_ANSWER_STATE_PREFIX}${id}`] = variants[id] === 1 ? "fresh" : "revealed";
    });
    return { completed, unlocked, current: currentIndex, drafts: syncedDrafts };
  }, [completed, currentIndex, drafts, revealed, unlocked, variants]);
  const mergeRemoteProgress = useCallback((remote: CourseProgress) => {
    const lessonIds = new Set(CLOCK_LESSONS.map((item) => item.id));
    const remoteCompleted = remote.completed.filter((id) => lessonIds.has(id));
    const remoteUnlocked = reachableClockLessonIndex(remoteCompleted);
    const remoteCurrent = Math.max(0, Math.min(remote.current, remoteUnlocked));
    const remoteDrafts: Record<string, string> = {};
    const remoteRevealed: string[] = [];
    const remoteFreshVariants: string[] = [];
    Object.entries(remote.drafts).forEach(([id, draft]) => {
      if (lessonIds.has(id)) {
        remoteDrafts[id] = draft.slice(0, 20000);
        return;
      }
      if (!id.startsWith(CLOCK_ANSWER_STATE_PREFIX)) return;
      const lessonId = id.slice(CLOCK_ANSWER_STATE_PREFIX.length);
      if (!lessonIds.has(lessonId) || (draft !== "revealed" && draft !== "fresh")) return;
      remoteRevealed.push(lessonId);
      if (draft === "fresh") remoteFreshVariants.push(lessonId);
    });
    setCompleted((previous) => {
      const merged = new Set([...remoteCompleted, ...previous]);
      return CLOCK_LESSONS.map((item) => item.id).filter((id) => merged.has(id));
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
    course: "clock-quest",
    hydrated,
    progress: savedProgress,
    mergeRemoteProgress,
  });
  const liveActive = Boolean(feedback?.passed && lesson.live);
  const hour = readClockPart(result, "hour");
  const minute = readClockPart(result, "minute");
  const second = readClockPart(result, "second");

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
      setFeedback({ passed: false, message: "Python could not start. Refresh the page and try again." });
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
      if (message.type !== "result" || !isRunResultMessage(message)) return;
      if (message.id !== runIdRef.current) return;

      const pending = pendingRef.current;
      if (!pending) return;
      pendingRef.current = null;
      runningRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (pending.mode === "lesson") setRunning(false);
      setResult(message);
      setAnimationKey((key) => key + 1);

      if (pending.mode === "live") {
        if (!message.error) setLiveTick((tick) => tick + 1);
        return;
      }

      const activeLesson = CLOCK_LESSONS[pending.lessonIndex];
      const activeVariant = activeLesson.variants?.[pending.variantIndex];
      let verdict = message.error
        ? { passed: false, message: "Python found something to fix. Read the message below the clock." }
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
        if (pending.lessonIndex === CLOCK_LESSONS.length - 1) {
          setVictoryBurst((burst) => burst + 1);
        }
        setCompleted((previous) =>
          previous.includes(activeLesson.id) ? previous : [...previous, activeLesson.id],
        );
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
          const lessonIds = new Set(CLOCK_LESSONS.map((item) => item.id));
          const savedCompleted = Array.isArray(progressData.completed)
            ? new Set(progressData.completed.filter(
                (id): id is string => typeof id === "string" && lessonIds.has(id),
              ))
            : new Set<string>();
          const restoredCompleted = CLOCK_LESSONS
            .map((item) => item.id)
            .filter((id) => savedCompleted.has(id));
          const restoredUnlocked = reachableClockLessonIndex(restoredCompleted);
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
      // The course still works when storage is unavailable; only persistence is skipped.
    }
  }, [completed, currentIndex, drafts, hydrated, revealed, unlocked, variants]);

  useEffect(() => {
    const list = lessonListRef.current;
    const current = currentLessonRef.current;
    if (!list || !current) return;
    let frame = 0;
    const revealCurrentLesson = () => {
      const overflowsHorizontally = list.scrollWidth > list.clientWidth;
      const overflowsVertically = list.scrollHeight > list.clientHeight;
      if (!overflowsHorizontally && !overflowsVertically) return;
      current.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    };
    revealCurrentLesson();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(revealCurrentLesson);
    });
    observer.observe(list);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [currentIndex, hydrated]);

  const runProgram = useCallback((mode: "lesson" | "live") => {
    if (
      !workerRef.current ||
      runtimeStatus !== "ready" ||
      runningRef.current ||
      (mode === "lesson" && !quizReady)
    ) return;
    if (mode === "lesson" && awaitingFreshVariant) {
      setFeedback({ passed: false, message: "Start the fresh variant before this challenge can count." });
      return;
    }
    if (code.length > 20000) {
      if (mode === "lesson") {
        setFeedback({ passed: false, message: "Keep your clock program under 20,000 characters." });
      }
      return;
    }
    const nextId = runIdRef.current + 1;
    runIdRef.current = nextId;
    runningRef.current = true;
    pendingRef.current = {
      mode,
      lessonIndex: currentIndex,
      code,
      variantIndex,
      answer: currentAnswer,
    };
    if (mode === "lesson") {
      setRunning(true);
      setFeedback(null);
      setResult(null);
      setLiveTick(0);
    }
    workerRef.current.postMessage({ type: "run", id: nextId, code });
    if (mode === "lesson") {
      timeoutRef.current = setTimeout(() => {
        runningRef.current = false;
        pendingRef.current = null;
        setRunning(false);
        setFeedback({ passed: false, message: "That ran too long. Check for a loop that never stops." });
        bootWorker();
      }, 5000);
    }
  }, [
    awaitingFreshVariant,
    bootWorker,
    code,
    currentAnswer,
    currentIndex,
    quizReady,
    runtimeStatus,
    variantIndex,
  ]);

  useEffect(() => {
    if (!liveActive) return;
    const interval = window.setInterval(() => runProgram("live"), 1000);
    return () => window.clearInterval(interval);
  }, [liveActive, runProgram]);

  const chooseLesson = (index: number) => {
    if (running || index > unlocked) return;
    runIdRef.current += 1;
    pendingRef.current = null;
    runningRef.current = false;
    setCurrentIndex(index);
    setResult(null);
    setFeedback(null);
    setVisibleHints(0);
    setLiveTick(0);
  };

  const updateCode = (nextCode: string) => {
    if (lesson.readOnly) return;
    setDrafts((previous) => ({ ...previous, [lesson.id]: nextCode }));
    if (feedback) setFeedback(null);
    setLiveTick(0);
  };

  const resetLesson = () => {
    setDrafts((previous) => ({ ...previous, [lesson.id]: starter }));
    setResult(null);
    setFeedback(null);
    setVisibleHints(0);
    setLiveTick(0);
  };

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      runProgram("lesson");
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
    setLiveTick(0);
  };
  const goNext = () => currentIndex < CLOCK_LESSONS.length - 1 && chooseLesson(currentIndex + 1);
  const completeCourse = CLOCK_LESSONS.every((item) => completedSet.has(item.id));

  return (
    <main className="course-shell clock-course">
      <header className="course-header">
        <div className="brand-lockup">
          <span className="brand-mark clock-brand-mark" aria-hidden="true"><Clock3 /></span>
          <div>
            <p className="brand-name">Clock Quest</p>
            <p className="brand-subtitle">Build a live clock with Python Turtle</p>
          </div>
        </div>

        <div className="header-progress" aria-label={`${completed.length} of ${CLOCK_LESSONS.length} learning steps complete and ${score} of ${TOTAL_POINTS} points earned`}>
          <div className="progress-copy"><span>{completed.length}/{CLOCK_LESSONS.length} steps · {score} tokens</span><span>{progress}%</span></div>
          <Progress value={progress} className="course-progress" />
        </div>

        <div className="header-actions">
          <Link className="course-link" href="/"><ArrowLeft /> Turtle basics</Link>
          <div className={`runtime-pill ${runtimeStatus}`} role="status" aria-live="polite">
            <span className="status-dot" />
            {runtimeStatus === "ready" ? "Python ready" : runtimeStatus === "loading" ? "Warming up Python…" : "Python needs a refresh"}
          </div>
          <AccountControl returnTo="/clock" syncStatus={syncStatus} />
        </div>
      </header>

      <div className="course-layout">
        <aside className="lesson-rail clock-rail" aria-label="Clock building lessons">
          <div className="rail-heading"><span>Clock lessons</span><span>{completed.length}/{CLOCK_LESSONS.length}</span></div>
          <nav className="lesson-list" ref={lessonListRef}>
            {CLOCK_LESSONS.map((item, index) => {
              const isCurrent = index === currentIndex;
              const isComplete = completedSet.has(item.id);
              const isLocked = index > unlocked;
              return (
                <button
                  ref={isCurrent ? currentLessonRef : undefined}
                  key={item.id}
                  type="button"
                  className={`lesson-link loop-subtopic ${isCurrent ? "current" : ""} ${isComplete ? "complete" : ""}`}
                  onClick={() => chooseLesson(index)}
                  disabled={isLocked || running}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <span className="lesson-state" aria-hidden="true">
                    {isComplete ? <Check /> : isLocked ? <LockKeyhole /> : <Repeat2 />}
                  </span>
                  <span>
                    <span className="lesson-number">Lesson {item.number} · {item.phase} · +{item.points}</span>
                    <span className="lesson-title">{item.title}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="lesson-workspace">
          <div className="lesson-intro clock-intro loops-intro">
            <div className="lesson-kicker">Lesson {lesson.number} · {lesson.phase}</div>
            <div className="clock-title-row">
              <div>
                <h1>{lesson.title}</h1>
                <p>{lesson.explanation}</p>
              </div>
              {isMasteryProof ? (
                <div className="mastery-proof-badge"><ShieldCheck /><span>Mastery<br />proof</span></div>
              ) : (
                <div className="points-card" aria-label={`${lesson.points} points available`}>
                  <Sparkles aria-hidden="true" />
                  <strong>+{lesson.points}</strong>
                  <span>time tokens</span>
                </div>
              )}
            </div>
            <div className="mission-card"><span className="mission-label">Your mission</span><strong>{mission}</strong></div>
            {variantIndex > 0 && (
              <div className="fresh-variant-note" role="status"><Repeat2 /> Fresh variant active—solve this one without the revealed answer.</div>
            )}
            {masteryIds && (
              <div className={`mastery-meter loop-mastery-meter ${conceptMasteryComplete ? "complete" : ""}`}>
                <ShieldCheck aria-hidden="true" />
                <span><strong>{conceptMasteryComplete ? `Lesson ${currentGroup} mastery proven` : "Mastery needs two proofs"}</strong><small>Lesson {currentGroup}d independent + {currentGroup}e transfer</small></span>
              </div>
            )}
          </div>

          {lesson.question && (
            <section className="loop-question-card" aria-labelledby={`clock-question-${lesson.id}`}>
              <div><span className="question-step">{lesson.question.eyebrow}</span><strong id={`clock-question-${lesson.id}`}>{lesson.question.prompt}</strong></div>
              <div className="loop-choice-grid" role="radiogroup" aria-labelledby={`clock-question-${lesson.id}`}>
                {lesson.question.choices.map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={currentAnswer === value} className={`loop-choice ${currentAnswer === value ? "selected" : ""}`} onClick={() => { setAnswers((previous) => ({ ...previous, [lesson.id]: value })); setFeedback(null); }}>
                    <span>{currentAnswer === value ? <Check /> : <Circle />}</span>{label}
                  </button>
                ))}
              </div>
              <span className="prediction-lock">Your choice is recorded before Python runs.</span>
            </section>
          )}

          <div className="practice-grid clock-practice-grid loops-practice-grid">
            <section className="code-panel" aria-label="Clock Python code editor">
              <div className="panel-bar code-bar">
                <div className="panel-title"><span className="traffic-lights" aria-hidden="true"><i /><i /><i /></span>clock_{String(lesson.number).padStart(2, "0")}.py</div>
                <Button type="button" variant="ghost" size="sm" className="reset-button" onClick={resetLesson} disabled={running || lesson.readOnly}><RotateCcw /> Reset</Button>
              </div>
              <PythonEditor
                value={code}
                onChange={updateCode}
                onKeyDown={handleEditorKeyDown}
                disabled={running}
                readOnly={lesson.readOnly}
                ariaLabel={`Code editor for clock lesson ${lesson.number}${lesson.readOnly ? ", read only" : ""}`}
                ariaDescribedBy="clock-editor-keyboard-help"
                className={`clock-editor-wrap ${lesson.readOnly ? "loops-readonly-editor" : ""}`}
              />
              <div className="editor-actions">
                <span className="shortcut"><kbd>Ctrl/⌘</kbd><kbd>Enter</kbd> run · <kbd>Tab</kbd> indent</span>
                <span id="clock-editor-keyboard-help" className="sr-only">
                  Press Tab to indent, Escape to leave the editor, and Control or Command plus Enter to run. Discovery and understanding examples are read only.
                </span>
                <Button type="button" size="lg" className="run-button clock-run-button loops-run-button" onClick={() => runProgram("lesson")} disabled={runtimeStatus !== "ready" || running || !quizReady || awaitingFreshVariant}>
                  <Play fill="currentColor" />
                  {running ? "Running…" : !quizReady ? "Choose first" : awaitingFreshVariant ? "Fresh challenge required" : "Run Python"}
                </Button>
              </div>
            </section>

            <section className="output-panel clock-output-panel loops-output-panel" aria-label={lesson.output === "print" ? "Printed Python output" : "Live Turtle clock output"}>
              <div className="panel-bar">
                <div className="panel-title">{lesson.output === "print" ? <Terminal /> : <Clock3 />} {lesson.output === "print" ? "Printed output" : "Clock workshop"}</div>
                {lesson.output === "print" ? (
                  <span className="canvas-status">{running ? "Python is running…" : "stdout"}</span>
                ) : liveActive ? (
                  <span className="live-clock-badge"><span /> Live · tick {liveTick}</span>
                ) : (
                  <span className="canvas-status">Turtle output</span>
                )}
              </div>
              {lesson.output === "print" ? (
                <div className="loop-console-stage">
                  {result?.output ? (
                    <pre aria-label="Program printed output">{result.output}</pre>
                  ) : (
                    <div className="console-placeholder"><Terminal /><strong>Nothing printed yet</strong><span>Run your code to fill this console.</span></div>
                  )}
                </div>
              ) : (
                <div className={`canvas-wrap clock-canvas-wrap ${liveActive ? "is-live" : ""} ${feedback ? "has-feedback" : ""}`}>
                  <ClockCanvas commands={result?.commands ?? []} animationKey={animationKey} />
                  {(second !== null || minute !== null || hour !== null) && (
                    <div className="clock-readout" aria-label="Python clock values">
                      <Timer aria-hidden="true" />
                      <span>{formatClockPart(hour)}:{formatClockPart(minute)}:{formatClockPart(second)}</span>
                    </div>
                  )}
                </div>
              )}
              {feedback && (
                <div className={`feedback-card clock-feedback loops-feedback ${feedback.passed ? "passed" : "try-again"}`} role="status">
                  <span className="feedback-icon">{feedback.passed ? <Check /> : <Lightbulb />}</span>
                  <div>
                    <strong>{feedback.passed ? `Step cleared · +${lesson.points} tokens!` : "Keep experimenting"}</strong>
                    <p>{feedback.passed ? lesson.success : feedback.message}</p>
                  </div>
                </div>
              )}
              {(result?.error || (lesson.output !== "print" && result?.output)) && (
                <div className={`terminal-output ${result.error ? "has-error" : ""}`} role={result.error ? "alert" : "status"}>
                  <div className="terminal-label"><Terminal /> {result.error ? "Python message" : "Printed output"}</div>
                  <pre>{result.error ?? result.output}</pre>
                </div>
              )}
            </section>
          </div>

          <div className="lesson-footer loops-footer">
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

            {feedback?.passed && currentIndex < CLOCK_LESSONS.length - 1 && (
              <Button type="button" size="lg" onClick={goNext} className="next-button clock-next-button">Next lesson <ChevronRight /></Button>
            )}
          </div>

          {feedback?.passed && completeCourse && currentIndex === CLOCK_LESSONS.length - 1 && (
            <CourseVictory
              burstKey={victoryBurst}
              eyebrow="Clock Quest complete!"
              title="You’re a Master of Time!"
              message="You turned functions, math, Turtle, and real time into a working clock. You didn’t just finish code—you built something amazing."
              achievement={`9 lessons · ${CLOCK_LESSONS.length} learning steps · ${TOTAL_POINTS} time tokens`}
              emoji="🕰️🏆"
              tone="clock"
            />
          )}

          {completeCourse && currentIndex !== CLOCK_LESSONS.length - 1 && (
            <p className="course-complete-note">Clock Quest complete. Every mission is open for more experiments.</p>
          )}
        </section>
      </div>
    </main>
  );
}
