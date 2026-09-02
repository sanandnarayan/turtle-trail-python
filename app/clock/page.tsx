import type { Metadata } from "next";

import { ClockCourse } from "./clock-course";

export const metadata: Metadata = {
  title: "Clock Quest — Build a Live Python Turtle Clock",
  description: "A playful, step-by-step Python Turtle course for building and animating a real clock.",
};

export default function ClockPage() {
  return <ClockCourse />;
}
