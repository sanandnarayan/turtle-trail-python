const PYODIDE_ROOT = "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/";
const COMMAND_LIMIT = 2500;
const OUTPUT_LIMIT = 12000;
const SOURCE_LIMIT = 20000;
const ERROR_LIMIT = 16000;

self.postMessage({ type: "status", status: "loading" });

const PYTHON_PRELUDE = String.raw`
import sys
import types
import math
import json
import io
import contextlib
import traceback
import ast

_TURTLE_COMMANDS = []
_TURTLE_STATE = {}
_COMMAND_LIMIT = ${COMMAND_LIMIT}
_OUTPUT_LIMIT = ${OUTPUT_LIMIT}
_ERROR_LIMIT = ${ERROR_LIMIT}
_STYLE_LIMIT = 100

class _LimitedWriter:
    def __init__(self, limit):
        self.limit = limit
        self.parts = []
        self.length = 0
    def write(self, value):
        value = str(value)
        remaining = max(0, self.limit - self.length)
        if remaining:
            kept = value[:remaining]
            self.parts.append(kept)
            self.length += len(kept)
        return len(value)
    def flush(self):
        return None
    def getvalue(self):
        return "".join(self.parts)

def _record(command):
    if len(_TURTLE_COMMANDS) >= _COMMAND_LIMIT:
        raise RuntimeError("Your turtle made too many moves. Try a smaller loop.")
    _TURTLE_COMMANDS.append(command)

def _finite_number(value, label):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{label} must be a finite number")
    return number

def _safe_style(value):
    text = str(value)
    if len(text) > _STYLE_LIMIT:
        raise ValueError("Turtle colors must be short color names or codes")
    return text

def _reset_turtle():
    _TURTLE_COMMANDS.clear()
    _TURTLE_STATE.clear()
    _TURTLE_STATE.update({
        "x": 0.0,
        "y": 0.0,
        "heading": 0.0,
        "pen": True,
        "color": "#173f5f",
        "fillcolor": "#173f5f",
        "width": 4.0,
        "background": "#f7fbff",
    })
    _record({"type": "bg", "color": "#f7fbff"})

def _move_to(x, y):
    old_x = _TURTLE_STATE["x"]
    old_y = _TURTLE_STATE["y"]
    x = _finite_number(x, "The x coordinate")
    y = _finite_number(y, "The y coordinate")
    if _TURTLE_STATE["pen"]:
        _record({
            "type": "line",
            "x1": old_x,
            "y1": old_y,
            "x2": x,
            "y2": y,
            "color": _TURTLE_STATE["color"],
            "width": _TURTLE_STATE["width"],
        })
    _TURTLE_STATE["x"] = x
    _TURTLE_STATE["y"] = y

def forward(distance):
    distance = _finite_number(distance, "Distance")
    angle = math.radians(_TURTLE_STATE["heading"])
    _move_to(
        _TURTLE_STATE["x"] + math.cos(angle) * distance,
        _TURTLE_STATE["y"] + math.sin(angle) * distance,
    )

def backward(distance):
    forward(-_finite_number(distance, "Distance"))

def left(angle):
    angle = _finite_number(angle, "Turn angle")
    _TURTLE_STATE["heading"] = (_TURTLE_STATE["heading"] + angle) % 360

def right(angle):
    left(-_finite_number(angle, "Turn angle"))

def goto(x, y=None):
    if y is None:
        x, y = x
    _move_to(x, y)

def setpos(x, y=None):
    goto(x, y)

def setposition(x, y=None):
    goto(x, y)

def setx(x):
    _move_to(x, _TURTLE_STATE["y"])

def sety(y):
    _move_to(_TURTLE_STATE["x"], y)

def setheading(angle):
    _TURTLE_STATE["heading"] = _finite_number(angle, "Heading") % 360

def heading():
    return _TURTLE_STATE["heading"]

def position():
    return (_TURTLE_STATE["x"], _TURTLE_STATE["y"])

def pos():
    return position()

def xcor():
    return _TURTLE_STATE["x"]

def ycor():
    return _TURTLE_STATE["y"]

def home():
    goto(0, 0)
    setheading(0)

def penup():
    _TURTLE_STATE["pen"] = False

def pendown():
    _TURTLE_STATE["pen"] = True

def up():
    penup()

def down():
    pendown()

def isdown():
    return _TURTLE_STATE["pen"]

def pencolor(value=None):
    if value is None:
        return _TURTLE_STATE["color"]
    _TURTLE_STATE["color"] = _safe_style(value)

def fillcolor(value=None):
    if value is None:
        return _TURTLE_STATE["fillcolor"]
    _TURTLE_STATE["fillcolor"] = _safe_style(value)

def color(*values):
    if len(values) == 0:
        return (_TURTLE_STATE["color"], _TURTLE_STATE["fillcolor"])
    pencolor(values[0])
    fillcolor(values[-1])

def pensize(value=None):
    if value is None:
        return _TURTLE_STATE["width"]
    value = _finite_number(value, "Pen size")
    if value <= 0 or value > 50:
        raise ValueError("Pen size must be greater than 0 and at most 50")
    _TURTLE_STATE["width"] = value

def width(value=None):
    return pensize(value)

def bgcolor(value=None):
    if value is None:
        return _TURTLE_STATE["background"]
    value = _safe_style(value)
    _TURTLE_STATE["background"] = value
    _record({"type": "bg", "color": value})

def dot(size=8, color_value=None):
    size = _finite_number(size, "Dot size")
    if size < 0 or size > 300:
        raise ValueError("Dot size must be between 0 and 300")
    _record({
        "type": "dot",
        "x": _TURTLE_STATE["x"],
        "y": _TURTLE_STATE["y"],
        "size": size,
        "color": _safe_style(color_value or _TURTLE_STATE["color"]),
    })

def write(text, *args, **kwargs):
    _record({
        "type": "text",
        "x": _TURTLE_STATE["x"],
        "y": _TURTLE_STATE["y"],
        "text": str(text)[:120],
        "color": _TURTLE_STATE["color"],
    })

def circle(radius, extent=360, steps=None):
    radius = _finite_number(radius, "Circle radius")
    extent = 360.0 if extent is None else _finite_number(extent, "Circle extent")
    if steps is None:
        segments = int(max(8, min(120, abs(extent) / 6)))
    else:
        segments = int(steps)
        if segments < 1 or segments > 120:
            raise ValueError("Circle steps must be between 1 and 120")
    if segments <= 0:
        return
    turn = extent / segments * (1 if radius >= 0 else -1)
    distance = 2 * math.pi * abs(radius) * (abs(extent) / 360.0) / segments
    for _ in range(segments):
        left(turn / 2)
        forward(distance)
        left(turn / 2)

def speed(*args, **kwargs):
    return None

def hideturtle():
    return None

def showturtle():
    return None

def clear():
    background = _TURTLE_STATE.get("background", "#f7fbff")
    _TURTLE_COMMANDS.clear()
    _record({"type": "bg", "color": background})

def reset():
    _reset_turtle()

def done():
    return None

def mainloop():
    return None

def exitonclick():
    return None

def setup(*args, **kwargs):
    return None

def title(*args, **kwargs):
    return None

def tracer(*args, **kwargs):
    return None

class _Pen:
    def __getattr__(self, name):
        candidate = getattr(_TURTLE_MODULE, name, None)
        if callable(candidate):
            return candidate
        raise AttributeError(name)

class _Screen:
    def bgcolor(self, value=None):
        return bgcolor(value)
    def setup(self, *args, **kwargs):
        return None
    def title(self, *args, **kwargs):
        return None
    def exitonclick(self):
        return None

_TURTLE_MODULE = types.ModuleType("turtle")
_TURTLE_MODULE.__file__ = "<lesson-turtle>"
for _name in (
    "forward", "backward", "left", "right", "goto", "setpos", "setposition",
    "setx", "sety", "setheading", "heading", "position", "pos", "xcor", "ycor",
    "home", "penup", "pendown", "up", "down", "isdown", "pencolor", "fillcolor",
    "color", "pensize", "width", "bgcolor", "dot", "write", "circle", "speed",
    "hideturtle", "showturtle", "clear", "reset", "done", "mainloop", "exitonclick",
    "setup", "title", "tracer"
):
    setattr(_TURTLE_MODULE, _name, globals()[_name])
_TURTLE_MODULE.Turtle = lambda *args, **kwargs: _Pen()
_TURTLE_MODULE.Pen = lambda *args, **kwargs: _Pen()
_TURTLE_MODULE.Screen = lambda *args, **kwargs: _Screen()
sys.modules["turtle"] = _TURTLE_MODULE

_reset_turtle()
`;

const pyodideReady = (async () => {
  const { loadPyodide } = await import(`${PYODIDE_ROOT}pyodide.mjs`);
  const jsglobals = Object.freeze(Object.create(null));
  const pyodide = await loadPyodide({ indexURL: PYODIDE_ROOT, jsglobals });
  const namespace = pyodide.globals.get("dict")();
  pyodide.runPython(PYTHON_PRELUDE, { globals: namespace });
  self.postMessage({ type: "status", status: "ready" });
  return { pyodide, namespace };
})();

pyodideReady.catch((error) => {
  self.postMessage({ type: "fatal", error: String(error) });
});

const errorResult = (id, error) => ({
  type: "result",
  id,
  commands: [],
  output: "",
  error: String(error).slice(0, ERROR_LIMIT),
  globals: {},
  functions: [],
  modules: [],
  syntax: [],
  state: { x: 0, y: 0, heading: 0, color: "#173f5f", width: 4 },
});

let busy = false;

self.onmessage = async (event) => {
  if (event.data?.type !== "run") return;
  const { id, code } = event.data;
  if (!Number.isInteger(id)) return;
  const source = typeof code === "string" ? code : String(code ?? "");
  if (source.length > SOURCE_LIMIT) {
    self.postMessage(errorResult(id, "That program is too long. Keep it under 20,000 characters."));
    return;
  }
  if (busy) {
    self.postMessage(errorResult(id, "Python is already running. Wait for the current drawing to finish."));
    return;
  }

  busy = true;
  try {
    const { pyodide, namespace } = await pyodideReady;
    pyodide.runPython(PYTHON_PRELUDE, { globals: namespace });
    namespace.set("_STUDENT_CODE", source);
    const resultProxy = await pyodide.runPythonAsync(String.raw`
_reset_turtle()
_student_globals = {"__name__": "__main__", "__file__": "lesson.py"}
_stdout = _LimitedWriter(_OUTPUT_LIMIT)
_error = None
_syntax_names = []

try:
    _tree = ast.parse(_STUDENT_CODE, filename="lesson.py")
    _syntax_names = sorted(set(type(_node).__name__ for _node in ast.walk(_tree)))
    with contextlib.redirect_stdout(_stdout), contextlib.redirect_stderr(_stdout):
        exec(compile(_tree, "lesson.py", "exec"), _student_globals)
except BaseException:
    _error = traceback.format_exc()[:_ERROR_LIMIT]

_safe_globals = {}
_function_names = []
_module_names = []

_UNSAFE = object()
def _safe_value(value, depth=0):
    if depth > 2:
        return _UNSAFE
    if value is None or isinstance(value, (str, bool)):
        return value[:1000] if isinstance(value, str) else value
    if isinstance(value, int):
        return value if value.bit_length() <= 4096 else _UNSAFE
    if isinstance(value, float):
        return value if math.isfinite(value) else _UNSAFE
    if isinstance(value, (list, tuple)) and len(value) <= 50:
        converted = [_safe_value(item, depth + 1) for item in value]
        return converted if all(item is not _UNSAFE for item in converted) else _UNSAFE
    if isinstance(value, dict) and len(value) <= 50:
        converted = {}
        for key, item in value.items():
            if not isinstance(key, str) or len(key) > 100:
                return _UNSAFE
            safe_item = _safe_value(item, depth + 1)
            if safe_item is _UNSAFE:
                return _UNSAFE
            converted[key] = safe_item
        return converted
    return _UNSAFE

for _key, _value in _student_globals.items():
    if _key.startswith("__"):
        continue
    if isinstance(_value, types.ModuleType):
        if len(_module_names) < 200:
            _module_names.append(_key[:120])
    elif callable(_value):
        if len(_function_names) < 200:
            _function_names.append(_key[:120])
    elif _key in {"distance", "steps", "colors", "size", "radius", "second", "minute", "hour"}:
        _converted = _safe_value(_value)
        if _converted is not _UNSAFE:
            _safe_globals[_key] = _converted

json.dumps({
    "commands": _TURTLE_COMMANDS,
    "output": _stdout.getvalue(),
    "error": _error,
    "globals": _safe_globals,
    "functions": _function_names,
    "modules": _module_names,
    "syntax": _syntax_names[:200],
    "state": {
        "x": _TURTLE_STATE["x"],
        "y": _TURTLE_STATE["y"],
        "heading": _TURTLE_STATE["heading"],
        "color": _TURTLE_STATE["color"],
        "width": _TURTLE_STATE["width"],
    },
}, allow_nan=False)
    `, { globals: namespace });
    const result = JSON.parse(resultProxy);
    if (typeof resultProxy?.destroy === "function") resultProxy.destroy();
    self.postMessage({ type: "result", id, ...result });
  } catch (error) {
    self.postMessage(errorResult(id, error));
  } finally {
    busy = false;
  }
};
