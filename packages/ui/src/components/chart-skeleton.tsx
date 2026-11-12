"use client";
// Candle-shaped chart skeleton — mimics the real TradingView chrome so the
// loading state is a layout replica, not a plain box.
export function ChartSkeleton({ className }: { className?: string }) {
  // Smooth realistic price wave in grey — dip, flat chop, then a rising
  // trend, like real candles. No colors in a skeleton.
  const N = 52;
  const wave = Array.from({ length: N }, (_, i) => {
    const t = i / (N - 1); // 0..1
    // base trend: dips in the middle then climbs — like the screenshot
    const trend = t < 0.45
      ? 0.55 - Math.sin(t / 0.45 * Math.PI) * 0.3          // dip into mid
      : 0.55 + (t - 0.45) * 0.9;                          // climb out
    const chop = Math.sin(i * 1.7) * 0.04 + Math.sin(i * 0.9 + 2) * 0.03;
    return Math.max(0.04, Math.min(0.95, trend + chop));
  });
  const bars = wave.map((level, i) => {
    const prev = wave[Math.max(0, i - 1)];
    const open = prev, close = level;
    const body = Math.max(2, Math.abs(close - open) * 100);
    const top = Math.max(open, close) * 100, bot = Math.min(open, close) * 100;
    const wick = 3 + (i % 4) * 2;
    return { body, top, bot, wick };
  });
  return (
    <div className={className}>
      {/* toolbar replica */}
      <div className="flex items-center gap-1 border-b border-white/[0.06] px-2 py-1.5">
        <div className="flex gap-0.5">
          {[14, 16, 18, 16, 14].map((w, i) => <div key={i} className="h-5 animate-pulse rounded bg-white/[0.07]" style={{ width: w * 2 }} />)}
        </div>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <div className="flex gap-1">{[14, 14, 14].map((w, i) => <div key={i} className="h-5 w-5 animate-pulse rounded bg-white/[0.07]" />)}</div>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <div className="h-5 w-24 animate-pulse rounded bg-white/[0.07]" />
        <div className="ml-auto h-5 w-5 animate-pulse rounded bg-white/[0.07]" />
      </div>
      {/* legend replica */}
      <div className="hidden items-center gap-2.5 px-3 pt-2 sm:flex">
        <div className="h-3 w-36 animate-pulse rounded bg-white/[0.07]" />
        {[24, 24, 24, 24].map((w, i) => <div key={i} className="h-3 animate-pulse rounded bg-white/[0.05]" style={{ width: w + 20 }} />)}
      </div>
      {/* candles replica */}
      <div className="relative flex-1 bg-[#07080d]">
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/[0.04]" />
        <div className="absolute inset-y-0 left-1/3 w-px bg-white/[0.04]" />
        <div className="absolute inset-y-0 left-2/3 w-px bg-white/[0.04]" />
        <div className="absolute inset-0 px-6">
          {bars.map((b, i) => (
            <div key={i} className="absolute flex animate-pulse flex-col items-center"
              style={{ left: `${(i / bars.length) * 100}%`, width: `${100 / bars.length}%`, top: `${100 - b.top - b.wick}%`, animationDelay: `${i * 25}ms` }}>
              <div className="w-px bg-white/[0.08]" style={{ height: b.wick }} />
              <div className="w-[7px] rounded-[1px] bg-white/[0.1]" style={{ height: b.body }} />
              <div className="w-px bg-white/[0.08]" style={{ height: b.wick }} />
            </div>
          ))}
        </div>
        {/* right price strip replica */}
        <div className="absolute inset-y-3 right-1 flex w-14 flex-col justify-between">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-2 w-10 animate-pulse rounded bg-white/[0.06]" />)}
        </div>
      </div>
      {/* bottom bar replica */}
      <div className="flex items-center gap-1 border-t border-white/[0.06] px-2 py-1.5">
        {[14, 14, 14, 14, 16].map((w, i) => <div key={i} className="h-4 animate-pulse rounded bg-white/[0.07]" style={{ width: w + 8 }} />)}
        <div className="ml-auto flex gap-1">{[14, 18, 22, 14].map((w, i) => <div key={i} className="h-4 animate-pulse rounded bg-white/[0.07]" style={{ width: w }} />)}</div>
      </div>
    </div>
  );
}
