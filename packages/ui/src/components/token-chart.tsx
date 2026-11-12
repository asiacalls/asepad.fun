"use client";
// TradingView-style chart chrome ported from asepad-futures for the AsePad
// token page: type toggles, Indicators dropdown (EMA/MA/BOLL/VWAP/VOL +
// RSI/MACD/KDJ sub-panes), OHLC legend, range tabs, %/log/auto scales.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, ColorType, CrosshairMode, LineStyle, PriceScaleMode,
  CandlestickSeries, HistogramSeries, LineSeries, AreaSeries,
  type IChartApi, type ISeriesApi, type CandlestickData, type LineData, type UTCTimestamp, type MouseEventParams
} from "lightweight-charts";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Eye, CandlestickChart, LineChart, ChartArea, Maximize2, MousePointer2, Minus, TrendingUp, Magnet, Trash2, Camera } from "lucide-react";
import { ema, sma, rsi, kdj, bollinger, macd, vwap, type IndCandle } from "@/lib/indicators";
import { cn } from "@/lib/cn";
import { toPng } from "html-to-image";

export type TfOpt = { s: number; l: string }; // seconds

const C = {
  up: "#3DE8B0", dn: "#FB7185",
  ema9: "#A78BFA", ema21: "#F5C044", ma: "#38BDF8",
  boll: "rgba(139,92,246,.55)", rsi: "#8B5CF6",
  macdL: "#3DE8B0", macdS: "#FB7185", vwap: "#F472B6",
  grid: "rgba(148,163,255,.06)", border: "rgba(148,163,255,.12)", text: "#8A93B8"
};
type IndKey = "EMA" | "MA" | "BOLL" | "VWAP" | "VOL" | "RSI" | "MACD" | "KDJ";
const IND_GROUPS: { label: string; items: { k: IndKey; l: string }[] }[] = [
  { label: "Overlays", items: [{ k: "EMA", l: "EMA 9 / 21" }, { k: "MA", l: "MA 20" }, { k: "BOLL", l: "Bollinger 20·2" }, { k: "VWAP", l: "VWAP" }] },
  { label: "Panes", items: [{ k: "VOL", l: "Volume" }, { k: "RSI", l: "RSI 14" }, { k: "MACD", l: "MACD 12·26·9" }, { k: "KDJ", l: "KDJ 9·3·3" }] }
];
type SMap = Partial<Record<"c" | "ln" | "ar" | "vol" | "e9" | "e21" | "ma" | "bU" | "bM" | "bL" | "vw" | "rsi" | "macdL" | "macdS" | "macdH" | "kK" | "kD" | "kJ", ISeriesApi<"Candlestick" | "Line" | "Area" | "Histogram">>>;

// Candle `time` arrives already in seconds (lightweight-charts convention) —
// never re-divide by 1000 or the whole series collapses into 1970.
const toT = (s: number) => Math.floor(s) as UTCTimestamp;

function baseChart(el: HTMLElement) {
  return createChart(el, {
    layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: C.text, fontSize: 10, fontFamily: "ui-monospace,monospace" },
    grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
    rightPriceScale: { borderColor: C.border },
    timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false },
    crosshair: { mode: CrosshairMode.Normal },
    autoSize: true
  });
}

export function TokenChart({ candles, symbol, tfLabel, tfs, tf, onTf, empty, loading, formatPx, unitToggle, lines }: {
  candles: IndCandle[]; symbol: string; tfLabel: string;
  tfs: readonly TfOpt[]; tf: number; onTf: (s: number) => void;
  empty?: boolean; loading?: boolean; formatPx: (n: number) => string;
  unitToggle?: React.ReactNode;
  lines?: { price: number; side: string }[];
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const rsiWrap = useRef<HTMLDivElement>(null);
  const macdWrap = useRef<HTMLDivElement>(null);
  const kdjWrap = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const panes = useRef<Partial<Record<"rsi" | "macd" | "kdj", IChartApi>>>({});
  const series = useRef<SMap>({});
  const [chartType, setChartType] = useState<"candles" | "line" | "area">("candles");
  const orderLines = useRef<{ series: ISeriesApi<"Candlestick">; pl: unknown }[]>([]);
  const [inds, setInds] = useState<Set<IndKey>>(new Set(["VOL"]));
  const [indOpen, setIndOpen] = useState(false);
  const indBtnRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [indPos, setIndPos] = useState<{ top: number; left: number } | null>(null);
  // The toolbar scrolls (overflow-x clips an in-flow menu) and ancestor
  // transforms break position:fixed — so the menu renders absolutely inside
  // the chart root, offset from the button's own rect.
  const openInd = () => {
    const b = indBtnRef.current?.getBoundingClientRect();
    const r = rootRef.current?.getBoundingClientRect();
    if (b && r) setIndPos({ top: b.bottom - r.top + 4, left: b.left - r.left });
    setIndOpen((v) => !v);
  };
  useEffect(() => {
    if (!indOpen) return;
    const close = () => setIndOpen(false);
    const t = setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
    return () => { clearTimeout(t); document.removeEventListener("click", close); };
  }, [indOpen]);
  const [scaleMode, setScaleMode] = useState<"pct" | "log" | "normal">("normal");
  const candlesRef = useRef<IndCandle[]>([]);
  candlesRef.current = candles;
  // Drawing tools — hlines ride createPriceLine; trendlines are 2-point
  // LineSeries. `pending` holds the first trend click.
  const [tool, setTool] = useState<"cursor" | "hline" | "trend">("cursor");
  const [magnet, setMagnet] = useState(false);
  const toolRef = useRef(tool); toolRef.current = tool;
  const magnetRef = useRef(magnet); magnetRef.current = magnet;
  const drawItems = useRef<{ remove: () => void }[]>([]);
  const pendingP = useRef<{ time: number; price: number } | null>(null);

  const fmt = formatPx;

  // ── main chart ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!wrap.current) return;
    const ch = baseChart(wrap.current);
    chart.current = ch;
    const s = series.current;
    // Custom price format — token prices live far below 0.01, so the default
    // 2-decimal axis rendered "0.00" everywhere (invisible right strip).
    const pf = { type: "custom" as const, formatter: (p: number) => fmt(p), minMove: 1e-9 };
    s.c = ch.addSeries(CandlestickSeries, { upColor: C.up, downColor: C.dn, wickUpColor: C.up, wickDownColor: C.dn, borderVisible: false, priceFormat: pf });
    s.ln = ch.addSeries(LineSeries, { color: C.up, lineWidth: 2, lastValueVisible: false, priceLineVisible: false, visible: false, priceFormat: pf });
    s.ar = ch.addSeries(AreaSeries, { lineColor: C.up, topColor: "rgba(61,232,176,.25)", bottomColor: "rgba(61,232,176,0)", lineWidth: 2, lastValueVisible: false, priceLineVisible: false, visible: false, priceFormat: pf });
    s.vol = ch.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false });
    ch.priceScale("").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    s.e9 = ch.addSeries(LineSeries, { color: C.ema9, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    s.e21 = ch.addSeries(LineSeries, { color: C.ema21, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    s.ma = ch.addSeries(LineSeries, { color: C.ma, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    s.bU = ch.addSeries(LineSeries, { color: C.boll, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    s.bM = ch.addSeries(LineSeries, { color: C.boll, lineStyle: LineStyle.Dashed, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    s.bL = ch.addSeries(LineSeries, { color: C.boll, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    s.vw = ch.addSeries(LineSeries, { color: C.vwap, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    ch.subscribeCrosshairMove((p: MouseEventParams) => {
      const d = p.seriesData?.get(series.current.c!) as CandlestickData | undefined;
      const leg = legendRef.current; if (!leg) return;
      const q = <T extends Element>(sel: string) => leg.querySelector<T>(sel);
      if (!d) { q("[data-d]")!.textContent = ""; return; }
      const src = (p.time ? candlesRef.current.find((c) => Math.floor(c.time) === (p.time as number)) : undefined) ?? candlesRef.current[candlesRef.current.length - 1];
      if (!src) return;
      q("[data-o]")!.textContent = fmt(src.open); q("[data-h]")!.textContent = fmt(src.high);
      q("[data-l]")!.textContent = fmt(src.low); q("[data-c]")!.textContent = fmt(src.close);
      const pc = candlesRef.current[Math.max(0, candlesRef.current.indexOf(src) - 1)];
      const chg = pc ? ((src.close - pc.close) / pc.close) * 100 : 0;
      const el = q("[data-d]")!;
      el.textContent = `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`;
      (el as HTMLElement).style.color = chg >= 0 ? C.up : C.dn;
    });
    ch.subscribeClick((p: MouseEventParams) => {
      const t = toolRef.current; if (!t || t === "cursor" || !p.point) return;
      const c = series.current.c; if (!c) return;
      let price = Number(c.coordinateToPrice(p.point.y));
      if (!Number.isFinite(price) || p.time == null) return;
      // Magnet snaps clicks to the nearest candle's close.
      if (magnetRef.current) {
        const hit = candlesRef.current.find((x) => Math.floor(x.time) === (p.time as number));
        if (hit) price = hit.close;
      }
      if (t === "hline") {
        const pl = c.createPriceLine({ price, color: "#F5C044", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "" });
        drawItems.current.push({ remove: () => c.removePriceLine(pl) });
      } else if (t === "trend") {
        const tp = { time: p.time as number, price };
        if (!pendingP.current) { pendingP.current = tp; return; }
        const ls = ch.addSeries(LineSeries, { color: "#F5C044", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
        ls.setData([{ time: pendingP.current.time as UTCTimestamp, value: pendingP.current.price }, { time: tp.time as UTCTimestamp, value: tp.price }]);
        drawItems.current.push({ remove: () => ch.removeSeries(ls) });
        pendingP.current = null;
      }
    });
    return () => { ch.remove(); chart.current = null; series.current = {}; drawItems.current = []; pendingP.current = null; };
  }, []);

  // ── indicator sub-panes ───────────────────────────────────────────────────
  useEffect(() => {
    const mk = (el: HTMLDivElement | null, key: "rsi" | "macd" | "kdj") => {
      if (!el || panes.current[key]) return;
      const ch = baseChart(el);
      panes.current[key] = ch;
      if (key === "rsi") series.current.rsi = ch.addSeries(LineSeries, { color: C.rsi, lineWidth: 1 });
      if (key === "macd") {
        series.current.macdH = ch.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false });
        series.current.macdL = ch.addSeries(LineSeries, { color: C.macdL, lineWidth: 1 });
        series.current.macdS = ch.addSeries(LineSeries, { color: C.macdS, lineWidth: 1 });
      }
      if (key === "kdj") {
        series.current.kK = ch.addSeries(LineSeries, { color: C.macdL, lineWidth: 1 });
        series.current.kD = ch.addSeries(LineSeries, { color: C.ema21, lineWidth: 1 });
        series.current.kJ = ch.addSeries(LineSeries, { color: C.rsi, lineWidth: 1 });
      }
      ch.timeScale().applyOptions({ visible: false });
    };
    if (inds.has("RSI")) mk(rsiWrap.current, "rsi"); else { panes.current.rsi?.remove(); delete panes.current.rsi; delete series.current.rsi; }
    if (inds.has("MACD")) mk(macdWrap.current, "macd"); else { panes.current.macd?.remove(); delete panes.current.macd; delete series.current.macdH; delete series.current.macdL; delete series.current.macdS; }
    if (inds.has("KDJ")) mk(kdjWrap.current, "kdj"); else { panes.current.kdj?.remove(); delete panes.current.kdj; delete series.current.kK; delete series.current.kD; delete series.current.kJ; }
  }, [inds]);

  // ── data + indicator series ───────────────────────────────────────────────
  useEffect(() => {
    const s = series.current;
    if (!s.c) return;
    // lightweight-charts demands strictly-ascending unique times — keep the
    // last candle per second bucket.
    const dedup = new Map<number, IndCandle>();
    for (const c of candles) dedup.set(Math.floor(c.time), c);
    const cs = [...dedup.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
    const cd = cs.map((c) => ({ time: toT(c.time), open: c.open, high: c.high, low: c.low, close: c.close }));
    const ld = cs.map((c) => ({ time: toT(c.time), value: c.close } as LineData));
    s.c.setData(cd); s.c.applyOptions({ visible: chartType === "candles" });
    s.ln?.setData(ld); s.ln?.applyOptions({ visible: chartType === "line" });
    s.ar?.setData(ld); s.ar?.applyOptions({ visible: chartType === "area" });
    s.vol?.setData(inds.has("VOL") ? cs.map((c) => ({ time: toT(c.time), value: c.volume ?? 0, color: c.close >= c.open ? "rgba(61,232,176,.28)" : "rgba(251,113,133,.28)" })) : []);
    s.e9?.setData(inds.has("EMA") ? ema(cs, 9).map((x) => ({ time: toT(x.time), value: x.value } as LineData)) : []);
    s.e21?.setData(inds.has("EMA") ? ema(cs, 21).map((x) => ({ time: toT(x.time), value: x.value } as LineData)) : []);
    s.ma?.setData(inds.has("MA") ? sma(cs, 20).map((x) => ({ time: toT(x.time), value: x.value } as LineData)) : []);
    if (inds.has("BOLL")) { const b = bollinger(cs); s.bU?.setData(b.up.map((x) => ({ time: toT(x.time), value: x.value } as LineData))); s.bM?.setData(b.mid.map((x) => ({ time: toT(x.time), value: x.value } as LineData))); s.bL?.setData(b.lo.map((x) => ({ time: toT(x.time), value: x.value } as LineData))); }
    else { s.bU?.setData([]); s.bM?.setData([]); s.bL?.setData([]); }
    s.vw?.setData(inds.has("VWAP") ? vwap(cs).map((x) => ({ time: toT(x.time), value: x.value } as LineData)) : []);
    if (series.current.rsi) series.current.rsi.setData(rsi(cs).map((x) => ({ time: toT(x.time), value: x.value } as LineData)));
    if (series.current.macdL) {
      const m = macd(cs);
      series.current.macdH?.setData(m.hist.map((x) => ({ time: toT(x.time), value: x.value, color: x.value >= 0 ? "rgba(61,232,176,.5)" : "rgba(251,113,133,.5)" })));
      series.current.macdL.setData(m.line.map((x) => ({ time: toT(x.time), value: x.value } as LineData)));
      series.current.macdS?.setData(m.signal.map((x) => ({ time: toT(x.time), value: x.value } as LineData)));
    }
    if (series.current.kK) {
      const o = kdj(cs);
      series.current.kK.setData(o.k.map((x) => ({ time: toT(x.time), value: x.value } as LineData)));
      series.current.kD?.setData(o.d.map((x) => ({ time: toT(x.time), value: x.value } as LineData)));
      series.current.kJ?.setData(o.j.map((x) => ({ time: toT(x.time), value: x.value } as LineData)));
    }
    for (const k of ["rsi", "macd", "kdj"] as const) panes.current[k]?.timeScale().fitContent();
  }, [candles, inds, chartType]);

  // ── order lines (limit orders / levels) ───────────────────────────────────
  useEffect(() => {
    const c = series.current.c as ISeriesApi<"Candlestick"> | undefined; if (!c) return;
    for (const ol of orderLines.current) c.removePriceLine(ol.pl as never);
    orderLines.current = [];
    for (const l of lines ?? []) {
      const pl = c.createPriceLine({ price: l.price, color: l.side === "buy" ? C.up : C.dn, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
      orderLines.current.push({ series: c, pl });
    }
  }, [lines, candles]);

  // ── price scale mode ──────────────────────────────────────────────────────
  useEffect(() => {
    chart.current?.priceScale("right").applyOptions({
      mode: scaleMode === "log" ? PriceScaleMode.Logarithmic : scaleMode === "pct" ? PriceScaleMode.Percentage : PriceScaleMode.Normal
    });
  }, [scaleMode]);

  const goRange = (ms: number) => {
    const ch = chart.current; if (!ch || !candles.length) return;
    const last = candles[candles.length - 1]!;
    const from = last.time - ms / 1000; // candle times are seconds
    // Sparse testnet data: a window with <5 candles reads as "broken" — fall
    // back to the newest ~50 candles so the tab always responds visibly.
    if (candles.filter((c) => c.time >= from).length < 5) {
      ch.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 50), to: candles.length + 2 });
      return;
    }
    ch.timeScale().setVisibleRange({ from: toT(from), to: toT(last.time) });
  };

  return (
    <div ref={outerRef} className="flex min-h-0 flex-1 flex-col">
      {/* top toolbar — timeframe · type · indicators */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-white/[0.06] px-2 py-1.5">
        {unitToggle ? <>{unitToggle}<span className="mx-1 h-4 w-px shrink-0 bg-white/10" /></> : null}
        <div className="flex items-center">
          {tfs.map((t) => (
            <button key={t.l} type="button" onClick={() => onTf(t.s)}
              className={cn("rounded px-2 py-1 text-[11px] font-medium transition-colors", tf === t.s ? "bg-white/10 text-white" : "text-white/45 hover:text-white/70")}>{t.l}</button>
          ))}
        </div>
        <span className="mx-1 h-4 w-px shrink-0 bg-white/10" />
        <div className="flex items-center gap-0.5">
          {([["candles", CandlestickChart], ["line", LineChart], ["area", ChartArea]] as const).map(([k, I]) => (
            <button key={k} type="button" onClick={() => setChartType(k)} title={`${k} chart`}
              className={cn("grid h-6 w-6 place-items-center rounded transition-colors", chartType === k ? "text-emerald-300" : "text-white/45 hover:text-white/70")}>
              <I size={14} />
            </button>
          ))}
        </div>
        <span className="mx-1 h-4 w-px shrink-0 bg-white/10" />
        <div className="relative">
          <button type="button" ref={indBtnRef} onClick={openInd}
            className={cn("flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition-colors", indOpen ? "bg-white/10 text-white" : "text-white/45 hover:text-white/70")}>
            <span className="italic">fx</span> Indicators <ChevronDown size={11} className={cn("transition-transform", indOpen && "rotate-180")} />
          </button>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" title="Fullscreen" onClick={() => rootRef.current?.closest("[data-chart-panel]")?.requestFullscreen?.()}
            className="grid h-6 w-6 place-items-center rounded text-white/45 hover:text-white/70"><Maximize2 size={12} /></button>
        </div>
      </div>

      {/* legend */}
      <div ref={legendRef} className="hidden flex-wrap items-center gap-2.5 px-3 pt-2 font-mono text-[11px] text-white/50 sm:flex">
        <span className="font-sans font-semibold text-white/80">{symbol} · {tfLabel} · AsePad</span>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span>O <span data-o className="text-white/80">{candles.length ? fmt(candles.at(-1)!.open) : "-"}</span></span>
        <span>H <span data-h className="text-emerald-400">{candles.length ? fmt(candles.at(-1)!.high) : "-"}</span></span>
        <span>L <span data-l className="text-red-400">{candles.length ? fmt(candles.at(-1)!.low) : "-"}</span></span>
        <span>C <span data-c className="text-white/80">{candles.length ? fmt(candles.at(-1)!.close) : "-"}</span></span>
        <span data-d className="font-semibold" />
      </div>

      {/* main pane */}
      <div data-chart-root ref={rootRef} className="relative min-h-0 flex-1 bg-[#07080d]">
        <div ref={wrap} className="absolute inset-0" />
        <img src="/brand/asepadtitle.png" alt="" className="pointer-events-none absolute inset-0 m-auto h-20 w-auto select-none opacity-[0.13]" />
        {/* vertical tool strip — cursor / hline / trend / magnet / camera / clear */}
        <div className="absolute left-1 top-1 z-20 flex flex-col rounded-lg border border-white/10 bg-[#0d0f16]/90 p-0.5 backdrop-blur-sm">
          {([
            ["cursor", MousePointer2, "Cursor"],
            ["hline", Minus, "Horizontal line — click a price level"],
            ["trend", TrendingUp, "Trend line — click two points"],
          ] as const).map(([k, I, title]) => (
            <button key={k} type="button" title={title} onClick={() => setTool(k)}
              className={cn("grid h-7 w-7 place-items-center rounded transition-colors", tool === k ? "bg-emerald-400/15 text-emerald-300" : "text-white/45 hover:text-white/70")}>
              <I size={13} />
            </button>
          ))}
          <span className="mx-1 my-0.5 h-px bg-white/10" />
          <button type="button" title="Magnet — snap drawings to candle close" onClick={() => setMagnet((v) => !v)}
            className={cn("grid h-7 w-7 place-items-center rounded transition-colors", magnet ? "bg-emerald-400/15 text-emerald-300" : "text-white/45 hover:text-white/70")}>
            <Magnet size={13} />
          </button>
          <button type="button" title="Screenshot" onClick={() => {
            const el = outerRef.current; if (!el) return;
            void toPng(el, { backgroundColor: "#07080d", pixelRatio: 2 }).then((shot) => {
              const a = document.createElement("a"); a.href = shot; a.download = `${symbol}-${tfLabel}.png`; a.click();
            }).catch(() => {
              const shot = chart.current?.takeScreenshot().toDataURL("image/png");
              if (shot) { const a = document.createElement("a"); a.href = shot; a.download = `${symbol}-${tfLabel}.png`; a.click(); }
            });
          }}
            className="grid h-7 w-7 place-items-center rounded text-white/45 transition-colors hover:text-white/70">
            <Camera size={13} />
          </button>
          <button type="button" title="Clear drawings" onClick={() => { for (const d of drawItems.current) d.remove(); drawItems.current = []; pendingP.current = null; }}
            className="grid h-7 w-7 place-items-center rounded text-white/45 transition-colors hover:text-red-300">
            <Trash2 size={13} />
          </button>
        </div>
        <AnimatePresence>
          {indOpen && indPos ? (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
              style={{ position: "absolute", top: indPos.top, left: indPos.left }}
              className="z-[60] w-48 rounded-xl border border-white/10 bg-[#0d0f16] p-1.5 shadow-xl">
              {IND_GROUPS.map((g) => (
                <div key={g.label}>
                  <div className="px-2 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-widest text-white/35">{g.label}</div>
                  {g.items.map((it) => (
                    <button key={it.k} type="button" onClick={() => setInds((s) => { const n = new Set(s); n.has(it.k) ? n.delete(it.k) : n.add(it.k); return n; })}
                      className={cn("flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[12px] transition-colors",
                        inds.has(it.k) ? "bg-violet-500/15 text-violet-200" : "text-white/60 hover:bg-white/5")}>
                      {it.l}
                      <span className={cn("h-1.5 w-1.5 rounded-full", inds.has(it.k) ? "bg-emerald-400" : "bg-white/20")} />
                    </button>
                  ))}
                </div>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>
        {empty || loading ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-black/40 backdrop-blur-[1px]">
            {loading ? (
              <div className="text-center">
                <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-emerald-400" />
                <p className="text-sm text-white/60">Loading indexed trades…</p>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-sm font-medium text-white/70">No indexed trades yet</p>
                <p className="mt-1 max-w-[280px] text-xs text-white/50">Candles appear where trades happened — quiet stretches show as open space, no fake flat line.</p>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* indicator sub-panes */}
      {inds.has("RSI") ? <Pane label="RSI 14" innerRef={rsiWrap} /> : null}
      {inds.has("MACD") ? <Pane label="MACD 12·26·9" innerRef={macdWrap} /> : null}
      {inds.has("KDJ") ? <Pane label="KDJ 9·3·3" innerRef={kdjWrap} /> : null}

      {/* bottom bar — range tabs · scales */}
      <div className="flex items-center gap-1 border-t border-white/[0.06] px-2 py-1 text-[11px]">
        {([["1d", 86_400_000], ["5d", 432_000_000], ["1m", 2_592_000_000], ["3m", 7_776_000_000], ["All", 0]] as const).map(([l, ms]) => (
          <button key={l} type="button" onClick={() => (ms === 0 ? chart.current?.timeScale().fitContent() : goRange(ms))}
            className="rounded px-1.5 py-0.5 text-white/45 transition-colors hover:text-white/70">{l}</button>
        ))}
        <div className="ml-auto flex items-center gap-0.5 font-mono text-[10px]">
          {(["pct", "log", "normal"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setScaleMode(m)}
              className={cn("rounded border px-1.5 py-0.5 transition-colors", scaleMode === m ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300" : "border-transparent text-white/45 hover:text-white/70")}>
              {m === "pct" ? "%" : m === "log" ? "log" : "auto"}
            </button>
          ))}
          <span className="mx-1 h-3 w-px bg-white/10" />
          <button type="button" title="Reset view" onClick={() => chart.current?.timeScale().fitContent()}
            className="grid h-5 w-5 place-items-center rounded text-white/45 hover:text-white/70"><Eye size={11} /></button>
        </div>
      </div>
    </div>
  );
}

function Pane({ label, innerRef }: { label: string; innerRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className="border-t border-white/[0.06]">
      <p className="px-3 pt-1 font-mono text-[9px] uppercase tracking-widest text-white/35">{label}</p>
      <div ref={innerRef} className="h-20" />
    </div>
  );
}
