"use client";

import { createElement, useEffect, useRef, useState } from "react";

/**
 * Scroll-entrance wrapper.
 *
 * Framer Motion would cost ~40KB gzipped to do what a shared IntersectionObserver and one CSS
 * transition do here, and it would force a client boundary around content that is otherwise
 * entirely server-rendered. This component is the boundary instead: `children` are passed as a
 * prop, so the markup inside stays on the server and only the observer ships to the browser.
 *
 * Three ways out of the hidden state, because content that never reveals is worse than content
 * that never animates: the observer fires, or the user prefers reduced motion, or scripting is off
 * (handled in CSS by `@media (scripting: none)`).
 */

/** One observer for the whole page rather than one per element. */
let sharedObserver: IntersectionObserver | null = null;
const pending = new WeakMap<Element, () => void>();

function observe(el: Element, onEnter: () => void) {
  if (typeof IntersectionObserver === "undefined") {
    onEnter();
    return () => {};
  }
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const cb = pending.get(entry.target);
          // Reveal is one-way: unobserve immediately so scrolling back up costs nothing.
          sharedObserver?.unobserve(entry.target);
          pending.delete(entry.target);
          cb?.();
        }
      },
      // A fixed hold rather than a percentage. A percentage of a tall viewport is a large dead
      // band at the bottom of the page, and anything sitting in it on a document that cannot
      // scroll further never reveals at all.
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" },
    );
  }
  pending.set(el, onEnter);
  sharedObserver.observe(el);
  return () => {
    sharedObserver?.unobserve(el);
    pending.delete(el);
  };
}

type RevealTag = "div" | "section" | "article" | "li" | "ul" | "dl" | "p";

export function Reveal({
  children,
  as = "div",
  className,
  delay = 0,
  id,
}: {
  children: React.ReactNode;
  as?: RevealTag;
  className?: string;
  /** Stagger, in milliseconds, applied as a transition delay once the group enters. */
  delay?: number;
  id?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Someone who has asked the OS for less motion gets the content, not the transition.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(true);
      return;
    }
    return observe(el, () => setRevealed(true));
  }, []);

  return createElement(
    as,
    {
      ref,
      id,
      className: [className, "reveal", revealed ? "is-revealed" : null].filter(Boolean).join(" "),
      style: delay ? { transitionDelay: `${delay}ms` } : undefined,
    },
    children,
  );
}
