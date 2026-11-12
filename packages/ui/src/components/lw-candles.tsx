"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LogicalRange,
  type Time,
  type UTCTimestamp
} from "lightweight-charts";
import { formatTokenPriceAxis } from "@/lib/asepad";
import { cn } from "@/lib/cn";

// Exact auras.finance terminal chart: TradingView lightweight-charts with the
// dark "#0b0c0f" theme, overlay volume bars and buy/sell arrow markers.
export type LwCandle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
export type LwMarker = { time: number; side: "buy" | "sell"; text?: string };
export type LwLine = { price: number; side: "buy" | "sell" };

// ── indicator math (ported from the AsePad Futures chart) ──────────────────
type Pt = { time: number; value: number };
const emaN = (cs: LwCandle[], p: number): Pt[] => {
  const k = 2 / (p + 1);
  let e = 0;
  return cs.map((c, i) => ({ time: c.time, value: (e = i === 0 ? c.close : c.close * k + e * (1 - k)) }));
};
const smaN = (cs: LwCandle[], p: number): Pt[] => {
  const out: Pt[] = [];
  let acc = 0;
  cs.forEach((c, i) => {
    acc += c.close;
    if (i >= p) acc -= cs[i - p]!.close;
    if (i >= p - 1) out.push({ time: c.time, value: acc / p });
  });
  return out;
};
const bollN = (cs: LwCandle[], p = 20, k = 2) => {
  const up: Pt[] = [], mid: Pt[] = [], lo: Pt[] = [];
  for (let i = p - 1; i < cs.length; i++) {
    const slice = cs.slice(i - p + 1, i + 1).map((c) => c.close);
    const m = slice.reduce((a, b) => a + b, 0) / p;
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / p);
    up.push({ time: cs[i]!.time, value: m + k * sd });
    mid.push({ time: cs[i]!.time, value: m });
    lo.push({ time: cs[i]!.time, value: m - k * sd });
  }
  return { up, mid, lo };
};
const vwapN = (cs: LwCandle[]): Pt[] => {
  let pv = 0, vv = 0;
  return cs.map((c) => {
    const tp = (c.high + c.low + c.close) / 3;
    pv += tp * (c.volume ?? 0); vv += c.volume ?? 0;
    return { time: c.time, value: vv > 0 ? pv / vv : c.close };
  });
};
const rsiN = (cs: LwCandle[], period = 14): Pt[] => {
  if (cs.length < period + 1) return [];
  let g = 0, l = 0;
  const out: Pt[] = [];
  for (let i = 1; i < cs.length; i++) {
    const d = cs[i]!.close - cs[i - 1]!.close;
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= period) { g += up / period; l += dn / period; if (i === period) out.push({ time: cs[i]!.time, value: l === 0 ? 100 : 100 - 100 / (1 + g / l) }); }
    else {
      g = (g * (period - 1) + up) / period; l = (l * (period - 1) + dn) / period;
      out.push({ time: cs[i]!.time, value: l === 0 ? 100 : 100 - 100 / (1 + g / l) });
    }
  }
  return out;
};
const macdN = (cs: LwCandle[], fast = 12, slow = 26, sig = 9) => {
  const ef = emaN(cs, fast), es = emaN(cs, slow);
  const line = ef.map((f, i) => ({ time: f.time, value: f.value - (es[i]?.value ?? f.value) }));
  const signal = emaN(line.map((p) => ({ time: p.time, open: p.value, high: p.value, low: p.value, close: p.value })), sig);
  const hist = line.map((p, i) => ({ time: p.time, value: p.value - (signal[i]?.value ?? p.value) }));
  return { line, signal, hist };
};
const kdjN = (cs: LwCandle[], period = 9, smooth = 3) => {
  const k: Pt[] = [], d: Pt[] = [], j: Pt[] = [];
  let prevK = 50, prevD = 50;
  for (let i = period - 1; i < cs.length; i++) {
    const win = cs.slice(i - period + 1, i + 1);
    const hi = Math.max(...win.map((c) => c.high));
    const lo = Math.min(...win.map((c) => c.low));
    const rsv = hi === lo ? 50 : ((cs[i]!.close - lo) / (hi - lo)) * 100;
    const nextK = (prevK * (smooth - 1) + rsv) / smooth;
    const nextD = (prevD * (smooth - 1) + nextK) / smooth;
    k.push({ time: cs[i]!.time, value: nextK });
    d.push({ time: cs[i]!.time, value: nextD });
    j.push({ time: cs[i]!.time, value: 3 * nextK - 2 * nextD });
    prevK = nextK; prevD = nextD;
  }
  return { k, d, j };
};

// Aster-style indicator toggles — overlays on the main pane, oscillators in
// synced sub-panes under the chart.
type IndKey = "MA" | "EMA" | "BOLL" | "VWAP" | "VOL" | "MACD" | "RSI" | "KDJ";
const IND_PILLS: IndKey[] = ["MA", "EMA", "BOLL", "VWAP", "VOL", "MACD", "RSI", "KDJ"];
const PANE_H = { RSI: 56, MACD: 72, KDJ: 56 } as const;
type PaneKey = "rsi" | "macd" | "kdj";
type PaneRec = {
  chart: IChartApi;
  sync: (r: LogicalRange | null) => void;
  a?: ISeriesApi<"Line">; b?: ISeriesApi<"Line">; c?: ISeriesApi<"Line">; h?: ISeriesApi<"Histogram">;
};

const IND_COLORS = {
  ema9: "#f5c044", ema21: "#7ea2f7", ma: "#c084fc",
  bU: "#f5c044", bM: "#7ea2f7", bL: "#8b8f9a", vw: "#35d69a",
  rsi: "#c084fc", macdL: "#f5c044", macdS: "#7ea2f7",
  k: "#f5c044", d: "#7ea2f7", j: "#f472b6"
};

export function LwCandles({ candles, markers, lines, legend }: { candles: LwCandle[]; markers?: LwMarker[]; lines?: LwLine[]; legend?: React.RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const rsiHostRef = useRef<HTMLDivElement>(null);
  const macdHostRef = useRef<HTMLDivElement>(null);
  const kdjHostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const csRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ovRef = useRef<Record<string, ISeriesApi<"Line"> | null>>({});
  const panesRef = useRef<Partial<Record<PaneKey, PaneRec>>>({});
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const lastCandle = useRef<LwCandle | null>(null);
  const [inds, setInds] = useState<Set<IndKey>>(new Set<IndKey>(["BOLL", "VOL", "MACD"]));
  const cleanRef = useRef<LwCandle[]>([]);

  const lineOpts = (color: string) => ({
    color, lineWidth: 1 as const, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false
  });

  useEffect(() => {
    if (!ref.current) return;
    const narrow = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
    const chart = createChart(ref.current, {
      layout: {
        background: { color: "#0b0c0f" },
        textColor: "#8b8f9a",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: narrow ? 9 : 10
      },
      grid: {
        vertLines: { color: "#14161b" },
        horzLines: { color: "#14161b" }
      },
      rightPriceScale: { borderColor: "#191b21", scaleMargins: { top: 0.08, bottom: 0.26 } },
      // Narrow screens get tighter spacing so the same candles stay visible
      // instead of getting squeezed off the right edge.
      timeScale: { borderColor: "#191b21", timeVisible: true, secondsVisible: false, barSpacing: narrow ? 5 : 8, rightOffset: narrow ? 3 : 8 },
      crosshair: {
        mode: 0,
        vertLine: { color: "#3a3350", labelBackgroundColor: "#1a1530" },
        horzLine: { color: "#3a3350", labelBackgroundColor: "#1a1530" }
      },
      autoSize: true
    });
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: "#35d69a", downColor: "#ff5c72",
      borderUpColor: "#35d69a", borderDownColor: "#ff5c72",
      wickUpColor: "#35d69a", wickDownColor: "#ff5c72",
      // Power-style labels for tiny prices (0.0(7)765) on the axis + crosshair —
      // ASCII form since canvas can't rely on superscript glyphs on mobile fonts.
      priceFormat: { type: "custom", formatter: (p: number) => formatTokenPriceAxis(p), minMove: 1e-9 }
    });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "", priceFormat: { type: "volume" }, color: "#232630" });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    // Overlay line series — created once, toggled by the indicator pills.
    const ov = ovRef.current;
    ov.e9 = chart.addSeries(LineSeries, { ...lineOpts(IND_COLORS.ema9), visible: false });
    ov.e21 = chart.addSeries(LineSeries, { ...lineOpts(IND_COLORS.ema21), visible: false });
    ov.ma = chart.addSeries(LineSeries, { ...lineOpts(IND_COLORS.ma), visible: false });
    ov.bU = chart.addSeries(LineSeries, { ...lineOpts(IND_COLORS.bU), visible: false });
    ov.bM = chart.addSeries(LineSeries, { ...lineOpts(IND_COLORS.bM), visible: false });
    ov.bL = chart.addSeries(LineSeries, { ...lineOpts(IND_COLORS.bL), visible: false });
    ov.vw = chart.addSeries(LineSeries, { ...lineOpts(IND_COLORS.vw), visible: false });
    chartRef.current = chart;
    csRef.current = cs;
    volRef.current = vol;
    markersRef.current = createSeriesMarkers(cs, []);
    // Crosshair → OHLC legend (futures-style DOM mutation — no React renders).
    // legend points at an element containing [data-o],[data-h],[data-l],[data-c],[data-d].
    chart.subscribeCrosshairMove((p) => {
      const leg = legend?.current;
      if (!leg) return;
      const d = (p.seriesData?.get(cs) as { open: number; high: number; low: number; close: number } | undefined) ?? lastCandle.current ?? undefined;
      if (!d) { leg.dataset.active = "0"; return; }
      leg.dataset.active = "1";
      const set = (k: string, v: string) => { const e = leg.querySelector<HTMLElement>(`[data-${k}]`); if (e) e.textContent = v; };
      set("o", formatTokenPriceAxis(d.open)); set("h", formatTokenPriceAxis(d.high));
      set("l", formatTokenPriceAxis(d.low)); set("c", formatTokenPriceAxis(d.close));
      const delta = d.close - d.open, pct = d.open ? (delta / d.open) * 100 : 0;
      set("d", `${delta >= 0 ? "+" : ""}${formatTokenPriceAxis(delta)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`);
      const col = d.close >= d.open ? "#35d69a" : "#ff5c72";
      leg.querySelectorAll<HTMLElement>("[data-o],[data-h],[data-l],[data-c],[data-d]")
        .forEach((e) => { e.style.color = col; });
    });
    return () => {
      for (const rec of Object.values(panesRef.current)) rec?.chart.remove();
      panesRef.current = {};
      chart.remove();
      chartRef.current = null;
      csRef.current = null;
      volRef.current = null;
      ovRef.current = {};
      markersRef.current = null;
      linesRef.current = [];
    };
  }, []);

  // ── sub-pane lifecycle: create on enable, destroy on disable ────────────
  useEffect(() => {
    const main = chartRef.current;
    if (!main) return;
    const want: Record<PaneKey, boolean> = { rsi: inds.has("RSI"), macd: inds.has("MACD"), kdj: inds.has("KDJ") };
    const hosts: Record<PaneKey, HTMLDivElement | null> = { rsi: rsiHostRef.current, macd: macdHostRef.current, kdj: kdjHostRef.current };
    for (const key of ["rsi", "macd", "kdj"] as PaneKey[]) {
      const have = panesRef.current[key];
      if (want[key] && !have && hosts[key]) {
        const pc = createChart(hosts[key]!, {
          layout: { background: { color: "#0b0c0f" }, textColor: "#8b8f9a", fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, attributionLogo: false },
          grid: { vertLines: { color: "#14161b" }, horzLines: { color: "#14161b" } },
          rightPriceScale: { borderColor: "#191b21" },
          timeScale: { visible: false },
          crosshair: { mode: 0, vertLine: { color: "#3a3350", labelBackgroundColor: "#1a1530" }, horzLine: { color: "#3a3350", labelBackgroundColor: "#1a1530" } },
          autoSize: true
        });
        const rec: PaneRec = { chart: pc, sync: () => {} };
        if (key === "rsi") {
          rec.a = pc.addSeries(LineSeries, { ...lineOpts(IND_COLORS.rsi), lastValueVisible: true });
          rec.a.createPriceLine({ price: 70, color: "rgba(255,92,114,.3)", lineStyle: LineStyle.Dashed, lineWidth: 1 });
          rec.a.createPriceLine({ price: 30, color: "rgba(53,214,154,.3)", lineStyle: LineStyle.Dashed, lineWidth: 1 });
        } else if (key === "macd") {
          rec.h = pc.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false });
          rec.a = pc.addSeries(LineSeries, lineOpts(IND_COLORS.macdL));
          rec.b = pc.addSeries(LineSeries, lineOpts(IND_COLORS.macdS));
        } else {
          rec.a = pc.addSeries(LineSeries, lineOpts(IND_COLORS.k));
          rec.b = pc.addSeries(LineSeries, lineOpts(IND_COLORS.d));
          rec.c = pc.addSeries(LineSeries, lineOpts(IND_COLORS.j));
        }
        const vr = main.timeScale().getVisibleLogicalRange();
        if (vr) pc.timeScale().setVisibleLogicalRange(vr);
        rec.sync = (r) => { if (r && panesRef.current[key] === rec) pc.timeScale().setVisibleLogicalRange(r); };
        main.timeScale().subscribeVisibleLogicalRangeChange(rec.sync);
        panesRef.current[key] = rec;
      } else if (!want[key] && have) {
        main.timeScale().unsubscribeVisibleLogicalRangeChange(have.sync);
        have.chart.remove();
        delete panesRef.current[key];
      }
    }
  }, [inds]);

  // ── data binding: candles, volume, overlays, pane oscillators ───────────
  useEffect(() => {
    const cs = csRef.current, vol = volRef.current, chart = chartRef.current;
    if (!cs || !vol || !chart) return;
    // Sanitize before setData — unsorted/duplicate times throw inside the lib
    // and malformed OHLC paints garbage. Sort, dedupe, enforce invariants.
    const seen = new Set<number>();
    const clean: LwCandle[] = [];
    for (const c of [...candles].sort((a, b) => a.time - b.time)) {
      if (!Number.isFinite(c.time) || seen.has(c.time)) continue;
      if (![c.open, c.high, c.low, c.close].every((v) => Number.isFinite(v) && v > 0)) continue;
      seen.add(c.time);
      clean.push({ ...c, high: Math.max(c.open, c.close, c.high), low: Math.min(c.open, c.close, c.low) });
    }
    lastCandle.current = clean.at(-1) ?? null;
    cleanRef.current = clean;
    // CEX follow behavior — keep tracking live only when the user is already
    // parked at the right edge; a scrolled-back viewport is left alone.
    const vr = chart.timeScale().getVisibleRange();
    const lastT = clean.at(-1)?.time;
    const atEdge = !vr || lastT === undefined || Number(vr.to) >= lastT;
    cs.setData(clean.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    vol.setData(inds.has("VOL") ? clean.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.volume ?? 0,
      color: c.close >= c.open ? "rgba(53,214,154,.32)" : "rgba(255,92,114,.3)"
    })) : []);
    // overlays
    const ov = ovRef.current;
    const bind = (s: ISeriesApi<"Line"> | null | undefined, on: boolean, pts: Pt[]) => {
      if (!s) return;
      s.setData(on ? pts.map((x) => ({ time: x.time as UTCTimestamp, value: x.value })) : []);
      s.applyOptions({ visible: on });
    };
    bind(ov.e9, inds.has("EMA"), emaN(clean, 9));
    bind(ov.e21, inds.has("EMA"), emaN(clean, 21));
    bind(ov.ma, inds.has("MA"), smaN(clean, 20));
    const b = inds.has("BOLL") ? bollN(clean) : { up: [], mid: [], lo: [] };
    bind(ov.bU, inds.has("BOLL"), b.up); bind(ov.bM, inds.has("BOLL"), b.mid); bind(ov.bL, inds.has("BOLL"), b.lo);
    bind(ov.vw, inds.has("VWAP"), vwapN(clean));
    // oscillator panes
    const rsi = panesRef.current.rsi;
    if (rsi?.a) rsi.a.setData(rsiN(clean).map((x) => ({ time: x.time as UTCTimestamp, value: x.value })));
    const md = panesRef.current.macd;
    if (md?.a) {
      const m = macdN(clean);
      md.a.setData(m.line.map((x) => ({ time: x.time as UTCTimestamp, value: x.value })));
      md.b?.setData(m.signal.map((x) => ({ time: x.time as UTCTimestamp, value: x.value })));
      md.h?.setData(m.hist.map((x) => ({ time: x.time as UTCTimestamp, value: x.value, color: x.value >= 0 ? "rgba(53,214,154,.45)" : "rgba(255,92,114,.45)" })));
    }
    const kj = panesRef.current.kdj;
    if (kj?.a) {
      const o = kdjN(clean);
      kj.a.setData(o.k.map((x) => ({ time: x.time as UTCTimestamp, value: x.value })));
      kj.b?.setData(o.d.map((x) => ({ time: x.time as UTCTimestamp, value: x.value })));
      kj.c?.setData(o.j.map((x) => ({ time: x.time as UTCTimestamp, value: x.value })));
    }
    if (atEdge) chart.timeScale().scrollToRealTime();
  }, [candles, inds]);

  useEffect(() => {
    // Same ordering contract as setData — a merged trade feed can hand us
    // duplicate/out-of-order times, and the lib throws on those.
    const seen = new Set<number>();
    const clean = (markers ?? [])
      .filter((m) => Number.isFinite(m.time))
      .sort((a, b) => a.time - b.time)
      .filter((m) => !seen.has(m.time) && seen.add(m.time));
    markersRef.current?.setMarkers(clean.map((m) => m.side === "buy"
      ? { time: m.time as UTCTimestamp, position: "belowBar" as const, color: "#35d69a", shape: "arrowUp" as const, text: m.text ?? "" }
      : { time: m.time as UTCTimestamp, position: "aboveBar" as const, color: "#ff5c72", shape: "arrowDown" as const, text: m.text ?? "" }
    ));
  }, [markers]);

  // Horizontal levels (e.g. open limit orders) — dashed line at each price.
  useEffect(() => {
    const cs = csRef.current;
    if (!cs) return;
    for (const l of linesRef.current) cs.removePriceLine(l);
    linesRef.current = (lines ?? []).map((l) => cs.createPriceLine({
      price: l.price,
      color: l.side === "buy" ? "#35d69a" : "#ff5c72",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: ""
    }));
  }, [lines]);

  const toggle = (k: IndKey) => setInds((cur) => {
    const next = new Set(cur);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const paneDiv = (key: PaneKey, host: React.RefObject<HTMLDivElement | null>, label: string) => (
    <div className="relative shrink-0 border-t border-[#14161b]" style={{ height: key === "macd" ? PANE_H.MACD : key === "rsi" ? PANE_H.RSI : PANE_H.KDJ }}>
      <div ref={host} className="absolute inset-0" />
      <span className="pointer-events-none absolute left-2 top-1 z-10 font-mono text-[9px] text-white/40">{label}</span>
    </div>
  );

  return (
    <div className="absolute inset-0 flex flex-col">
      <div ref={ref} className="relative min-h-0 flex-1" />
      {inds.has("RSI") ? paneDiv("rsi", rsiHostRef, "RSI 14") : null}
      {inds.has("MACD") ? paneDiv("macd", macdHostRef, "MACD 12·26·9") : null}
      {inds.has("KDJ") ? paneDiv("kdj", kdjHostRef, "KDJ 9·3·3") : null}
      {/* Aster-style indicator toggle strip */}
      <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-t border-[#14161b] px-1.5 py-1">
        {IND_PILLS.map((k) => (
          <button key={k} type="button" onClick={() => toggle(k)} aria-pressed={inds.has(k)}
            className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide transition-colors",
              inds.has(k) ? "text-white" : "text-white/35 hover:text-white/60")}>{k}</button>
        ))}
      </div>
    </div>
  );
}
