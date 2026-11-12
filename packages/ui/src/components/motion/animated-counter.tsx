"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useSpring, useTransform } from "framer-motion";

export function AnimatedCounter({
  value,
  suffix = "",
  className
}: {
  value: number;
  suffix?: string;
  className?: string;
}) {
  const spring = useSpring(0, { stiffness: 90, damping: 20 });
  const display = useTransform(spring, (v) => `${Math.round(v).toLocaleString()}${suffix}`);
  const ref = useRef<HTMLSpanElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    spring.set(value);
  }, [spring, value]);

  useEffect(() => {
    if (!ref.current || !mounted) return;
    const unsub = display.on("change", (v) => {
      ref.current!.textContent = v;
    });
    return () => unsub();
  }, [display, mounted]);

  return <motion.span ref={ref} className={className} />;
}
