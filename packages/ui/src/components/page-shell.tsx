"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

export function PageShell({
  title,
  titleImg,
  titleImgClassName,
  subtitle,
  right,
  center,
  centerMobile,
  bare,
  children,
  className
}: {
  title: string;
  titleImg?: string;
  /** Override the title image size (tightly-cropped images need less height). */
  titleImgClassName?: string;
  subtitle?: string;
  right?: React.ReactNode;
  center?: boolean;
  centerMobile?: boolean;
  /** Skip the hero title block — screen-filling layouts (terminal) only. */
  bare?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const mobCenter = Boolean(centerMobile) && !center;
  return (
    <div className={cn("mx-auto max-w-7xl px-4", bare ? "pb-2 pt-14 md:pb-3" : "pb-10 pt-16 md:pb-12 md:pt-20", className)}>
      {bare ? null : (
      <div className={cn("flex flex-col gap-4",
        center ? "items-center text-center"
          : mobCenter ? "items-center text-center md:flex-row md:items-end md:justify-between md:text-left"
          : "md:flex-row md:items-end md:justify-between")}>
        <div className={cn(center && "flex flex-col items-center", mobCenter && "flex flex-col items-center md:items-start")}>
          <motion.div
            initial={{ opacity: 0, x: center ? 0 : -12, y: center ? -8 : 0 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            {titleImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={titleImg} alt={title} className={cn("h-12 w-auto max-w-[85vw] object-contain md:h-16 md:max-w-none", titleImgClassName)} />
            ) : (
              <span className="text-chrome-gradient text-neon text-3xl font-semibold tracking-tight md:text-4xl">{title}</span>
            )}
          </motion.div>
          {subtitle ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.08, duration: 0.4 }}
              className={cn("mt-2 max-w-2xl text-sm text-white/60 md:text-base", center && "mx-auto", mobCenter && "mx-auto md:mx-0")}
            >
              {subtitle}
            </motion.p>
          ) : null}
          {center && right ? <div className="mt-4 flex flex-col items-center gap-3">{right}</div> : null}
        </div>
        {!center && right ? <div className={cn("flex items-center gap-2", mobCenter && "justify-center md:justify-end")}>{right}</div> : null}
      </div>
      )}
      <motion.div
        initial={{ opacity: 0, y: bare ? 0 : 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: bare ? 0 : 0.12, duration: 0.45 }}
        className={bare ? "mt-2" : "mt-8"}
      >
        {children}
      </motion.div>
    </div>
  );
}
