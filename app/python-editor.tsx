"use client";

import {
  type KeyboardEventHandler,
  type UIEvent,
  useRef,
} from "react";

const KEYWORDS = new Set([
  "and", "as", "assert", "async", "await", "break", "case", "class",
  "continue", "def", "del", "elif", "else", "except", "finally", "for",
  "from", "global", "if", "import", "in", "is", "lambda", "match",
  "nonlocal", "not", "or", "pass", "raise", "return", "try", "while",
  "with", "yield",
]);

const LITERALS = new Set(["False", "None", "True"]);

const BUILT_INS = new Set([
  "abs", "all", "any", "bool", "dict", "enumerate", "float", "input",
  "int", "isinstance", "len", "list", "max", "min", "open", "print",
  "range", "reversed", "round", "set", "sorted", "str", "sum", "super",
  "tuple", "type", "zip",
]);

type Token = {
  className?: string;
  value: string;
};

const tokenizePython = (code: string) => {
  const tokens: Token[] = [];
  const push = (value: string, className?: string) => {
    if (!value) return;
    const previous = tokens.at(-1);
    if (previous && previous.className === className) {
      previous.value += value;
    } else {
      tokens.push({ value, className });
    }
  };

  let index = 0;
  while (index < code.length) {
    const rest = code.slice(index);

    if (code[index] === "#") {
      const end = code.indexOf("\n", index);
      const tokenEnd = end === -1 ? code.length : end;
      push(code.slice(index, tokenEnd), "syntax-comment");
      index = tokenEnd;
      continue;
    }

    const stringStart = rest.match(/^(?:[rRuUbBfF]{1,2})?("""|'''|"|')/);
    if (stringStart) {
      const quote = stringStart[1];
      let end = index + stringStart[0].length;
      while (end < code.length) {
        if (code.startsWith(quote, end)) {
          end += quote.length;
          break;
        }
        end += code[end] === "\\" ? 2 : 1;
      }
      push(code.slice(index, Math.min(end, code.length)), "syntax-string");
      index = Math.min(end, code.length);
      continue;
    }

    const number = rest.match(/^(?:0[xX][\da-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/);
    if (number) {
      push(number[0], "syntax-number");
      index += number[0].length;
      continue;
    }

    const identifier = rest.match(/^[A-Za-z_]\w*/);
    if (identifier) {
      const value = identifier[0];
      const after = code.slice(index + value.length);
      const className = KEYWORDS.has(value)
        ? "syntax-keyword"
        : LITERALS.has(value)
          ? "syntax-literal"
          : BUILT_INS.has(value)
            ? "syntax-builtin"
            : /^\s*\(/.test(after)
              ? "syntax-function"
              : undefined;
      push(value, className);
      index += value.length;
      continue;
    }

    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      push(whitespace[0]);
      index += whitespace[0].length;
      continue;
    }

    const operator = rest.match(/^[+\-*/%=&|^~<>!:.,()[\]{}@]+/);
    if (operator) {
      push(operator[0], "syntax-operator");
      index += operator[0].length;
      continue;
    }

    push(code[index]);
    index += 1;
  }

  return tokens;
};

export function PythonEditor({
  value,
  onChange,
  onKeyDown,
  disabled,
  readOnly = false,
  ariaLabel,
  ariaDescribedBy,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  disabled: boolean;
  readOnly?: boolean;
  ariaLabel: string;
  ariaDescribedBy: string;
  className?: string;
}) {
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterLinesRef = useRef<HTMLDivElement>(null);
  const tokens = tokenizePython(value);

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
      highlightRef.current.scrollLeft = textarea.scrollLeft;
    }
    if (gutterLinesRef.current) {
      gutterLinesRef.current.style.transform = `translateY(${-textarea.scrollTop}px)`;
    }
  };

  return (
    <div className={`editor-wrap ${className}`}>
      <div className="editor-gutter" aria-hidden="true">
        <div ref={gutterLinesRef} className="editor-gutter-lines">
          {value.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}
        </div>
      </div>
      <div className="editor-input">
        <pre ref={highlightRef} className="editor-highlight" aria-hidden="true">
          <code>
            {tokens.map((token, index) => (
              <span key={index} className={token.className}>{token.value}</span>
            ))}
            {"\n"}
          </code>
        </pre>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onScroll={syncScroll}
          disabled={disabled}
          readOnly={readOnly}
          maxLength={20000}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
        />
      </div>
    </div>
  );
}
