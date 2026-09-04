import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const relativeLuminance = (hex: string) => {
  const channels = hex.match(/[a-f\d]{2}/gi)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

describe("editor accessibility styles", () => {
  it("keeps line numbers at WCAG AA contrast on white", () => {
    const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");
    const gutterRule = css.match(/\.editor-gutter\s*\{([^}]+)\}/)?.[1];
    const color = gutterRule?.match(/color:\s*#([a-f\d]{6})/i)?.[1];
    expect(color).toBeDefined();

    const contrast = 1.05 / (relativeLuminance(color ?? "ffffff") + 0.05);
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });
});
