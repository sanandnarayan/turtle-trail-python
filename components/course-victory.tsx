"use client";

import type { CSSProperties } from "react";
import Link from "next/link";

type CourseVictoryProps = {
  burstKey: number;
  eyebrow: string;
  title: string;
  message: string;
  achievement: string;
  emoji: string;
  tone?: "trail" | "clock";
  action?: {
    href: string;
    label: string;
  };
};

const CONFETTI_PIECES = Array.from({ length: 48 }, (_, index) => {
  const angle = (index / 48) * Math.PI * 2;
  const distance = 35 + ((index * 17) % 28);
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    delay: (index % 8) * 24,
    spin: 300 + ((index * 83) % 540),
  };
});

export function CourseVictory({
  burstKey,
  eyebrow,
  title,
  message,
  achievement,
  emoji,
  tone = "trail",
  action,
}: CourseVictoryProps) {
  return (
    <>
      {burstKey > 0 && (
        <div key={burstKey} className="confetti-burst" aria-hidden="true">
          {CONFETTI_PIECES.map((piece, index) => (
            <i
              key={index}
              className={`confetti-piece confetti-piece-${index % 6}`}
              style={{
                "--confetti-x": `${piece.x}vw`,
                "--confetti-y": `${piece.y}vh`,
                "--confetti-delay": `${piece.delay}ms`,
                "--confetti-spin": `${piece.spin}deg`,
              } as CSSProperties}
            />
          ))}
        </div>
      )}

      <section className={`course-victory ${tone}`} role="status" aria-live="polite">
        <div className="victory-emoji" aria-hidden="true">{emoji}</div>
        <div className="victory-copy">
          <p className="victory-eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p>{message}</p>
          <strong className="victory-achievement"><span aria-hidden="true">★★★</span> {achievement}</strong>
        </div>
        {action && (
          <Link className="victory-action" href={action.href}>
            {action.label} <span aria-hidden="true">→</span>
          </Link>
        )}
      </section>
    </>
  );
}
