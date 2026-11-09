'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

const COLORS = ['#39d98a', '#1769f4', '#ffc93c', '#ff6b6b', '#a66cff'];
const PIECES = 160;
const DURATION_MS = 4200;

interface Piece {
  color: string;
  rotation: number;
  size: number;
  spin: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
}

function launchConfetti(canvas: HTMLCanvasElement): () => void {
  const context = canvas.getContext('2d');
  if (!context) return () => undefined;

  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.scale(ratio, ratio);

  // Two "party poppers" fire from the bottom corners toward the middle.
  const pieces: Piece[] = Array.from({ length: PIECES }, (_, index) => {
    const fromLeft = index % 2 === 0;
    const angle = (fromLeft ? -60 : -120) + (Math.random() - 0.5) * 40;
    const speed = 9 + Math.random() * 9;
    const radians = (angle * Math.PI) / 180;
    return {
      color: COLORS[index % COLORS.length] ?? '#39d98a',
      rotation: Math.random() * Math.PI,
      size: 6 + Math.random() * 6,
      spin: (Math.random() - 0.5) * 0.3,
      vx: Math.cos(radians) * speed,
      vy: Math.sin(radians) * speed,
      x: fromLeft ? width * 0.05 : width * 0.95,
      y: height,
    };
  });

  const started = performance.now();
  let frame = 0;

  const draw = (now: number) => {
    const elapsed = now - started;
    context.clearRect(0, 0, width, height);
    context.globalAlpha = Math.max(0, 1 - elapsed / DURATION_MS);
    for (const piece of pieces) {
      piece.vy += 0.25;
      piece.vx *= 0.99;
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.rotation += piece.spin;
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.rotation);
      context.fillStyle = piece.color;
      context.fillRect(
        -piece.size / 2,
        -piece.size / 4,
        piece.size,
        piece.size / 2,
      );
      context.restore();
    }
    if (elapsed < DURATION_MS) frame = requestAnimationFrame(draw);
  };

  frame = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(frame);
}

interface WelcomeCelebrationProps {
  readonly status: 'active' | 'trialing';
}

export function WelcomeCelebration({ status }: WelcomeCelebrationProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const close = () => router.replace('/app', { scroll: false });

  useEffect(() => {
    buttonRef.current?.focus();
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const stop =
      !reduceMotion && canvasRef.current
        ? launchConfetti(canvasRef.current)
        : () => undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') router.replace('/app', { scroll: false });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      stop();
      window.removeEventListener('keydown', onKey);
    };
  }, [router]);

  return (
    <div className="welcome-celebration">
      <canvas aria-hidden="true" className="welcome-confetti" ref={canvasRef} />
      <div
        aria-describedby="welcome-celebration-body"
        aria-labelledby="welcome-celebration-title"
        aria-modal="true"
        className="welcome-card"
        role="dialog"
      >
        <span aria-hidden="true" className="welcome-emoji">
          🎉
        </span>
        <h2 id="welcome-celebration-title">You&apos;re all set!</h2>
        <p id="welcome-celebration-body">
          {status === 'trialing'
            ? 'Your free trial has started and your workspace is unlocked. You will not be charged until the trial ends, and you can cancel any time from Billing.'
            : 'Your subscription is active and your workspace is unlocked.'}
        </p>
        <button
          className="primary-button"
          onClick={close}
          ref={buttonRef}
          type="button"
        >
          Start using CrewFlow360
        </button>
      </div>
    </div>
  );
}
