"use client";

import {
  ArrowLeft,
  Check,
  ChevronRight,
  Circle,
  Clock3,
  Lightbulb,
  LockKeyhole,
  Play,
  RotateCcw,
  Sparkles,
  Terminal,
  Timer,
  Trophy,
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
import { Progress } from "@/components/ui/progress";

import {
  AccountControl,
  type CourseProgress,
  useCourseProgressSync,
} from "../account";

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

type ClockLesson = {
  id: string;
  number: number;
  title: string;
  concept: string;
  explanation: string;
  mission: string;
  starter: string;
  hints: string[];
  success: string;
  points: number;
  live?: boolean;
  check: (result: RunResult, code: string) => CheckResult;
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

const FACE_STARTER = `import turtle

radius = 150
turtle.bgcolor("#fffaf2")
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
turtle.bgcolor("#fffaf2")
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

const CLOCK_LESSONS: ClockLesson[] = [
  {
    id: "clock-face",
    number: 1,
    title: "Shape the clock face",
    concept: "A circle starts with a radius",
    explanation:
      "Your turtle is waiting at the bottom of the dial. The radius variable already stores 150, but the circle command is still using a tiny fixed number.",
    mission: "Replace 80 with radius so the turtle draws a full-sized clock face.",
    starter: FACE_STARTER,
    hints: [
      "Variables can be used anywhere a number can be used.",
      "The final line should be turtle.circle(radius).",
    ],
    success: "A perfect 300-step clock face is ready for its numbers.",
    points: 80,
    check: (result, code) =>
      hasClockFace(result) && /turtle\.circle\(\s*radius\s*\)/.test(code)
        ? { passed: true, message: "The dial is full size!" }
        : { passed: false, message: "Use radius inside turtle.circle( )." },
  },
  {
    id: "hour-numbers",
    number: 2,
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
    points: 100,
    check: (result) =>
      hasClockFace(result) && hasHourNumbers(result) && result.syntax.includes("For")
        ? { passed: true, message: "All twelve hours are in position!" }
        : { passed: false, message: "Let the loop reach all the way through hour 12." },
  },
  {
    id: "second-hand",
    number: 3,
    title: "Add the second hand",
    concept: "Sixty seconds share 360 degrees",
    explanation:
      "A second becomes an angle by multiplying it by 6. The coral hand points correctly, but it is too short to read clearly.",
    mission: "Change its length to radius * 0.82 so it nearly reaches the edge.",
    starter: SECOND_STARTER,
    hints: [
      "Keep a little breathing room inside the clock face.",
      "Replace 60 with radius * 0.82.",
    ],
    success: "Your first clock hand now reaches across the dial.",
    points: 100,
    check: (result) =>
      hasHourNumbers(result) && hasHand(result, SECOND_COLOR, 123)
        ? { passed: true, message: "That second hand is easy to spot!" }
        : { passed: false, message: "Make the coral line radius * 0.82 long." },
  },
  {
    id: "live-seconds",
    number: 4,
    title: "Make every second tick",
    concept: "datetime reads the real clock",
    explanation:
      "datetime.now() gives Python the current moment. Once this challenge passes, the browser reruns your Python every second and the hand keeps ticking.",
    mission: "Replace 10 with now.second, then watch your clock come alive.",
    starter: LIVE_SECOND_STARTER,
    hints: [
      "The current moment is already stored in now.",
      "Use second = now.second.",
    ],
    success: "Tick! Python is redrawing the second hand every second.",
    points: 120,
    live: true,
    check: (result, code) =>
      typeof result.globals.second === "number" &&
      hasHand(result, SECOND_COLOR, 123) &&
      /second\s*=\s*now\.second/.test(code)
        ? { passed: true, message: "Your live second hand is ticking!" }
        : { passed: false, message: "Store now.second in the second variable." },
  },
  {
    id: "minute-hand",
    number: 5,
    title: "Add the minute hand",
    concept: "One formula can guide another hand",
    explanation:
      "Minutes also divide the dial into 60 positions, so they use the same × 6 angle. A minute hand should be sturdy and a little shorter than the second hand.",
    mission: "Change its length from 50 to radius * 0.66.",
    starter: MINUTE_STARTER,
    hints: [
      "The blue hand is the minute hand.",
      "Its final line should use turtle.forward(radius * 0.66).",
    ],
    success: "The bold blue minute hand has joined the clock.",
    points: 100,
    live: true,
    check: (result) =>
      hasHand(result, SECOND_COLOR, 123) && hasHand(result, MINUTE_COLOR, 99)
        ? { passed: true, message: "Two hands, two different jobs!" }
        : { passed: false, message: "Make the blue line radius * 0.66 long." },
  },
  {
    id: "live-minutes",
    number: 6,
    title: "Follow the current minute",
    concept: "A value changes on its own schedule",
    explanation:
      "The program redraws every second, but now.minute only changes at the next minute boundary. That means the blue hand moves exactly when a real minute changes.",
    mission: "Replace 15 with now.minute to connect the blue hand to real time.",
    starter: LIVE_MINUTE_STARTER,
    hints: [
      "This is just like reading now.second.",
      "Use minute = now.minute.",
    ],
    success: "Your minute hand now advances with the real clock.",
    points: 120,
    live: true,
    check: (result, code) =>
      typeof result.globals.minute === "number" &&
      hasHand(result, MINUTE_COLOR, 99) &&
      /minute\s*=\s*now\.minute/.test(code)
        ? { passed: true, message: "The minute hand is synced!" }
        : { passed: false, message: "Store now.minute in the minute variable." },
  },
  {
    id: "draw-hand-function",
    number: 7,
    title: "Build a hand-drawing function",
    concept: "Functions remove repeated instructions",
    explanation:
      "Both hands repeat the same seven turtle moves. draw_hand bundles those moves together and receives the angle, length, color, and width as parameters.",
    mission: "Inside draw_hand, replace 30 with the length parameter.",
    starter: FUNCTION_STARTER,
    hints: [
      "A parameter behaves like a variable inside its function.",
      "Use turtle.forward(length).",
    ],
    success: "One reusable function now draws hands of every style.",
    points: 120,
    live: true,
    check: (result, code) =>
      result.functions.includes("draw_hand") &&
      /turtle\.forward\(\s*length\s*\)/.test(code) &&
      hasHand(result, SECOND_COLOR, 123) &&
      hasHand(result, MINUTE_COLOR, 99)
        ? { passed: true, message: "Your draw_hand function works twice!" }
        : { passed: false, message: "Use length in the function's forward command." },
  },
  {
    id: "hour-hand",
    number: 8,
    title: "Call the function for hours",
    concept: "One function can create many hands",
    explanation:
      "Hours have 12 positions, so each hour is 30° apart. The purple hand already uses draw_hand, but it needs the short, powerful proportions of an hour hand.",
    mission: "Replace its length of 30 with radius * 0.48.",
    starter: HOUR_STARTER,
    hints: [
      "Find the final draw_hand call—the purple one.",
      "Its second argument should be radius * 0.48.",
    ],
    success: "Your function created a third hand without copied turtle moves.",
    points: 120,
    live: true,
    check: (result, code) =>
      result.functions.includes("draw_hand") &&
      hasHand(result, HOUR_COLOR, 72) &&
      /draw_hand\(\s*hour\s*\*\s*30\s*,\s*radius\s*\*\s*0\.48/.test(code)
        ? { passed: true, message: "The hour hand is strong and clear!" }
        : { passed: false, message: "Give the hour draw_hand call a radius * 0.48 length." },
  },
  {
    id: "live-clock",
    number: 9,
    title: "Launch the complete live clock",
    concept: "Hours, minutes, and seconds work together",
    explanation:
      "The final missing piece is the real hour. Converting 24-hour time with % 12 gives the familiar position on an analog clock.",
    mission: "Replace 3 with datetime's current hour converted using now.hour % 12.",
    starter: LIVE_HOUR_STARTER,
    hints: [
      "% 12 turns hour 13 into 1, hour 14 into 2, and so on.",
      "Use hour = now.hour % 12.",
    ],
    success: "Your live Python clock is complete—every hand follows real time!",
    points: 140,
    live: true,
    check: (result, code) =>
      typeof result.globals.hour === "number" &&
      /hour\s*=\s*now\.hour\s*%\s*12/.test(code) &&
      hasClockFace(result) &&
      hasHourNumbers(result) &&
      hasHand(result, SECOND_COLOR, 123) &&
      hasHand(result, MINUTE_COLOR, 99) &&
      hasHand(result, HOUR_COLOR, 72) &&
      result.functions.includes("draw_hand")
        ? { passed: true, message: "All three hands are live!" }
        : { passed: false, message: "Set hour to now.hour % 12 and keep all three draw_hand calls." },
  },
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

type PendingRun = {
  mode: "lesson" | "live";
  lessonIndex: number;
  code: string;
};

const STORAGE_KEY = "turtle-clock-quest-progress-v1";

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
        .find((command): command is TurtleBackground => command.type === "bg")?.color ?? "#fffaf2";
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

export function ClockCourse() {
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
  const [liveTick, setLiveTick] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const workerGenerationRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef(0);
  const runningRef = useRef(false);
  const pendingRef = useRef<PendingRun | null>(null);

  const lesson = CLOCK_LESSONS[currentIndex];
  const code = drafts[lesson.id] ?? lesson.starter;
  const completedSet = useMemo(() => new Set(completed), [completed]);
  const score = useMemo(
    () => CLOCK_LESSONS.reduce(
      (total, item) => total + (completedSet.has(item.id) ? item.points : 0),
      0,
    ),
    [completedSet],
  );
  const progress = Math.round((score / TOTAL_POINTS) * 100);
  const savedProgress = useMemo<CourseProgress>(
    () => ({ completed, unlocked, current: currentIndex, drafts }),
    [completed, currentIndex, drafts, unlocked],
  );
  const mergeRemoteProgress = useCallback((remote: CourseProgress) => {
    const lessonIds = new Set(CLOCK_LESSONS.map((item) => item.id));
    const remoteCompleted = remote.completed.filter((id) => lessonIds.has(id));
    const remoteUnlocked = Math.max(0, Math.min(remote.unlocked, CLOCK_LESSONS.length - 1));
    const remoteCurrent = Math.max(0, Math.min(remote.current, remoteUnlocked));
    const remoteDrafts: Record<string, string> = {};
    Object.entries(remote.drafts).forEach(([id, draft]) => {
      if (lessonIds.has(id)) remoteDrafts[id] = draft.slice(0, 20000);
    });
    setCompleted((previous) => {
      const merged = new Set([...remoteCompleted, ...previous]);
      return CLOCK_LESSONS.map((item) => item.id).filter((id) => merged.has(id));
    });
    setUnlocked((previous) => Math.max(previous, remoteUnlocked));
    setCurrentIndex((previous) => Math.max(previous, remoteCurrent));
    setDrafts((previous) => ({ ...remoteDrafts, ...previous }));
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
      const verdict = message.error
        ? { passed: false, message: "Python found something to fix. Read the message below the clock." }
        : activeLesson.check(message, pending.code);
      setFeedback(verdict);

      if (verdict.passed) {
        setCompleted((previous) =>
          previous.includes(activeLesson.id) ? previous : [...previous, activeLesson.id],
        );
        setUnlocked((previous) =>
          Math.max(previous, Math.min(CLOCK_LESSONS.length - 1, pending.lessonIndex + 1)),
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
          const restoredCompleted = Array.isArray(progressData.completed)
            ? [...new Set(progressData.completed.filter(
                (id): id is string => typeof id === "string" && lessonIds.has(id),
              ))]
            : [];
          const restoredUnlocked =
            typeof progressData.unlocked === "number" && Number.isInteger(progressData.unlocked)
              ? Math.max(0, Math.min(progressData.unlocked, CLOCK_LESSONS.length - 1))
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
      // The course still works when storage is unavailable; only persistence is skipped.
    }
  }, [completed, currentIndex, drafts, hydrated, unlocked]);

  const runProgram = useCallback((mode: "lesson" | "live") => {
    if (!workerRef.current || runtimeStatus !== "ready" || runningRef.current) return;
    if (code.length > 20000) {
      if (mode === "lesson") {
        setFeedback({ passed: false, message: "Keep your clock program under 20,000 characters." });
      }
      return;
    }
    const nextId = runIdRef.current + 1;
    runIdRef.current = nextId;
    runningRef.current = true;
    pendingRef.current = { mode, lessonIndex: currentIndex, code };
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
  }, [bootWorker, code, currentIndex, runtimeStatus]);

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
    setDrafts((previous) => ({ ...previous, [lesson.id]: nextCode }));
    if (feedback) setFeedback(null);
    setLiveTick(0);
  };

  const resetLesson = () => {
    setDrafts((previous) => ({ ...previous, [lesson.id]: lesson.starter }));
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
  const goNext = () => currentIndex < CLOCK_LESSONS.length - 1 && chooseLesson(currentIndex + 1);
  const completeCourse = completedSet.has(CLOCK_LESSONS[CLOCK_LESSONS.length - 1].id);

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

        <div className="header-progress" aria-label={`${score} of ${TOTAL_POINTS} points earned`}>
          <div className="progress-copy"><span>{score} time tokens</span><span>{progress}%</span></div>
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
          <div className="rail-heading"><span>Clock missions</span><span>{score} pts</span></div>
          <nav className="lesson-list">
            {CLOCK_LESSONS.map((item, index) => {
              const isCurrent = index === currentIndex;
              const isComplete = completedSet.has(item.id);
              const isLocked = index > unlocked;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`lesson-link ${isCurrent ? "current" : ""} ${isComplete ? "complete" : ""}`}
                  onClick={() => chooseLesson(index)}
                  disabled={isLocked || running}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <span className="lesson-state" aria-hidden="true">
                    {isComplete ? <Check /> : isLocked ? <LockKeyhole /> : <Circle />}
                  </span>
                  <span>
                    <span className="lesson-number">Mission {item.number} · +{item.points}</span>
                    <span className="lesson-title">{item.title}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="lesson-workspace">
          <div className="lesson-intro clock-intro">
            <div className="lesson-kicker">Mission {lesson.number} · {lesson.concept}</div>
            <div className="clock-title-row">
              <div>
                <h1>{lesson.title}</h1>
                <p>{lesson.explanation}</p>
              </div>
              <div className="points-card" aria-label={`${lesson.points} points available`}>
                <Sparkles aria-hidden="true" />
                <strong>+{lesson.points}</strong>
                <span>time tokens</span>
              </div>
            </div>
            <div className="mission-card"><span className="mission-label">Your mission</span><strong>{lesson.mission}</strong></div>
          </div>

          <div className="practice-grid clock-practice-grid">
            <section className="code-panel" aria-label="Clock Python code editor">
              <div className="panel-bar code-bar">
                <div className="panel-title"><span className="traffic-lights" aria-hidden="true"><i /><i /><i /></span>clock_{String(lesson.number).padStart(2, "0")}.py</div>
                <Button type="button" variant="ghost" size="sm" className="reset-button" onClick={resetLesson} disabled={running}><RotateCcw /> Reset</Button>
              </div>
              <div className="editor-wrap clock-editor-wrap">
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
                  aria-label={`Code editor for clock mission ${lesson.number}`}
                  aria-describedby="clock-editor-keyboard-help"
                />
              </div>
              <div className="editor-actions">
                <span className="shortcut"><kbd>Ctrl/⌘</kbd><kbd>Enter</kbd> run · <kbd>Esc</kbd> leave editor</span>
                <span id="clock-editor-keyboard-help" className="sr-only">
                  Press Tab to indent, Escape to leave the editor, and Control or Command plus Enter to run.
                </span>
                <Button type="button" size="lg" className="run-button clock-run-button" onClick={() => runProgram("lesson")} disabled={runtimeStatus !== "ready" || running}>
                  <Play fill="currentColor" />{running ? "Running…" : "Run clock code"}
                </Button>
              </div>
            </section>

            <section className="output-panel clock-output-panel" aria-label="Live Turtle clock output">
              <div className="panel-bar">
                <div className="panel-title"><Clock3 /> Clock workshop</div>
                {liveActive ? (
                  <span className="live-clock-badge"><span /> Live · tick {liveTick}</span>
                ) : (
                  <span className="canvas-status">Turtle output</span>
                )}
              </div>
              <div className={`canvas-wrap clock-canvas-wrap ${liveActive ? "is-live" : ""}`}>
                <ClockCanvas commands={result?.commands ?? []} animationKey={animationKey} />
                {(second !== null || minute !== null || hour !== null) && (
                  <div className="clock-readout" aria-label="Python clock values">
                    <Timer aria-hidden="true" />
                    <span>{formatClockPart(hour)}:{formatClockPart(minute)}:{formatClockPart(second)}</span>
                  </div>
                )}
                {feedback && (
                  <div className={`feedback-card clock-feedback ${feedback.passed ? "passed" : "try-again"}`} role="status">
                    <span className="feedback-icon">{feedback.passed ? <Check /> : <Lightbulb />}</span>
                    <div>
                      <strong>{feedback.passed ? `Mission cleared · +${lesson.points} tokens!` : "Almost in sync"}</strong>
                      <p>{feedback.passed ? lesson.success : feedback.message}</p>
                    </div>
                  </div>
                )}
              </div>
              {(result?.output || result?.error) && (
                <div className={`terminal-output ${result.error ? "has-error" : ""}`} role={result.error ? "alert" : "status"}>
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

            {feedback?.passed && (
              currentIndex < CLOCK_LESSONS.length - 1 ? (
                <Button type="button" size="lg" onClick={goNext} className="next-button clock-next-button">Next mission <ChevronRight /></Button>
              ) : (
                <div className="finish-badge clock-finish-badge"><Trophy /><div><strong>Master of Time</strong><small>{TOTAL_POINTS} tokens · live clock complete</small></div></div>
              )
            )}
          </div>

          {completeCourse && currentIndex !== CLOCK_LESSONS.length - 1 && (
            <p className="course-complete-note">Clock Quest complete. Every mission is open for more experiments.</p>
          )}
        </section>
      </div>
    </main>
  );
}
