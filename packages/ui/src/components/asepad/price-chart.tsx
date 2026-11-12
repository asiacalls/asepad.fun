"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  AreaSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  PriceScaleMode,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp
} from "lightweight-charts";
import { cn } from "@/lib/cn";
import { PricePower } from "@/components/price-power";
import { formatTokenPriceAxis, formatTokenPriceLabel } from "@/lib/asepad";

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type ChartProps = {
  candles: Candle[];
  height?: number;
  interval?: number;
  spotPrice?: number;
  currency?: "ASE" | "USD";
  usdRate?: number;
  loading?: boolean;
  error?: boolean;
  refreshing?: boolean;
  historyLimited?: boolean;
  onRetry?: () => void;
  /** Render an ASE/USD unit switcher in the toolbar. */
  onCurrencyChange?: (unit: "ASE" | "USD") => void;
};

const fmtVolume = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

export function PriceChart({
  candles, height = 400, interval = 60, spotPrice, currency = "ASE", usdRate,
  loading = false, error = false, refreshing = false, historyLimited = false, onRetry, onCurrencyChange
}: ChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const dataRef = useRef<Candle[]>([]);
  const hoverTime = useRef<number | null>(null);
  const initialized = useRef(false);
  const [mode, setMode] = useState<"candles" | "line">("candles");
  const [logScale, setLogScale] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [legend, setLegend] = useState<Candle | null>(null);
  const [compact, setCompact] = useState(false);
  const seriesRef = useRef<{
    cs: ISeriesApi<"Candlestick">;
    area: ISeriesApi<"Area">;
    vol: ISeriesApi<"Histogram">;
    spotLines: IPriceLine[];
  } | null>(null);
  const displayCurrency = currency === "USD" && usdRate && usdRate > 0 ? "USD" : "ASE";
  const priceFactor = displayCurrency === "USD" ? (usdRate ?? 1) : 1;
  const fmtPrice = useMemo(() => (price: number) => formatTokenPriceLabel(price, displayCurrency), [displayCurrency]);
  // Canvas can't use <sup> and mobile fonts lack Unicode superscripts — ASCII.
  const fmtAxis = useMemo(() => (price: number) => formatTokenPriceAxis(price, displayCurrency), [displayCurrency]);
  const data = useMemo(() => {
    const unique = new Map<number, Candle>();
    for (const c of candles) {
      if (![c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
        || !Number.isInteger(c.time) || c.time <= 0 || c.low <= 0 || c.volume < 0
        || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)) continue;
      unique.set(c.time, {
        ...c,
        open: c.open * priceFactor,
        high: c.high * priceFactor,
        low: c.low * priceFactor,
        close: c.close * priceFactor
      });
    }
    return [...unique.values()].sort((a, b) => a.time - b.time);
  }, [candles, priceFactor]);
  const displaySpot = typeof spotPrice === "number" && Number.isFinite(spotPrice) && spotPrice > 0
    ? spotPrice * priceFactor
    : null;

  function resetView() {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().applyOptions({ barSpacing: 9, rightOffset: 6 });
    chart.timeScale().scrollToPosition(6, false);
    seriesRef.current?.cs.priceScale().applyOptions({ autoScale: true });
  }

  function zoom(factor: number) {
    const chart = chartRef.current;
    if (!chart) return;
    const spacing = chart.timeScale().options().barSpacing;
    chart.timeScale().applyOptions({ barSpacing: Math.min(24, Math.max(3, spacing * factor)) });
  }

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const minWidth = compact ? 72 : 124;
    series.cs.priceScale().applyOptions({ minimumWidth: minWidth });
    series.vol.priceScale().applyOptions({ minimumWidth: minWidth });
  }, [compact]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0c101a" },
        textColor: "#8b95a7",
        fontSize: 11,
        panes: { separatorColor: "#303848", separatorHoverColor: "#7660ac", enableResize: false }
      },
      grid: {
        vertLines: { color: "rgba(148,163,184,0.04)" },
        horzLines: { color: "rgba(148,163,184,0.07)" }
      },
      timeScale: {
        borderColor: "#303848", timeVisible: true, secondsVisible: false,
        barSpacing: 9, minBarSpacing: 3, maxBarSpacing: 24, rightOffset: 6,
        fixLeftEdge: false, fixRightEdge: false
      },
      rightPriceScale: {
        borderColor: "#303848", minimumWidth: 124,
        scaleMargins: { top: 0.16, bottom: 0.12 }
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#64748b", style: LineStyle.Dashed, labelBackgroundColor: "#374151" },
        horzLine: { color: "#64748b", style: LineStyle.Dashed, labelBackgroundColor: "#374151" }
      },
      localization: { locale: "en-US" },
      handleScroll: { vertTouchDrag: false }
    });
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: "#2dd4a0", downColor: "#f87171",
      wickUpColor: "#2dd4a0", wickDownColor: "#f87171",
      borderUpColor: "#2dd4a0", borderDownColor: "#f87171", borderVisible: true,
      priceLineStyle: LineStyle.Dotted
    });
    const area = chart.addSeries(AreaSeries, {
      lineColor: "#a78bfa", topColor: "rgba(167,139,250,0.18)",
      bottomColor: "rgba(167,139,250,0.01)", lineWidth: 2, visible: false,
      priceLineStyle: LineStyle.Dotted
    });
    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false
    }, 1);
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.25, bottom: 0.02 }, minimumWidth: 124 });
    chart.panes()[1].setHeight(64);
    const spotLines = [cs, area].map((series) => series.createPriceLine({
      price: 0, color: "#a78bfa", lineWidth: 1, lineStyle: LineStyle.Dashed,
      title: "Spot", lineVisible: false, axisLabelVisible: false
    }));
    chartRef.current = chart;
    seriesRef.current = { cs, area, vol, spotLines };
    chart.subscribeCrosshairMove((p) => {
      hoverTime.current = typeof p.time === "number" ? p.time : null;
      setLegend(dataRef.current.find((c) => c.time === hoverTime.current) ?? dataRef.current.at(-1) ?? null);
    });
    const observer = new ResizeObserver(() => chart.panes()[1]?.setHeight(64));
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      initialized.current = false;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const range = chart.timeScale().getVisibleLogicalRange();
    const previous = dataRef.current;
    const following = !range || range.to >= previous.length - 1;
    const previousFirstIndex = previous.length ? data.findIndex((c) => c.time === previous[0].time) : 0;
    dataRef.current = data;
    const minPrice = Math.min(...data.map((c) => c.low));
    const precision = Number.isFinite(minPrice) ? Math.min(18, Math.max(4, 5 - Math.floor(Math.log10(minPrice)))) : 9;
    const priceFormat = {
      type: "custom" as const,
      minMove: 10 ** -precision,
      formatter: fmtAxis,
      tickmarksFormatter: (prices: readonly number[]) => prices.map(fmtAxis)
    };
    series.cs.applyOptions({ priceFormat });
    series.area.applyOptions({ priceFormat });
    series.cs.setData(data.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
    series.area.setData(data.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
    series.vol.setData(data.map((c) => ({
      time: c.time as UTCTimestamp, value: c.volume,
      color: c.close >= c.open ? "rgba(45,212,160,0.55)" : "rgba(248,113,113,0.55)"
    })));
    setLegend(data.find((c) => c.time === hoverTime.current) ?? data.at(-1) ?? null);
    if (data.length && !initialized.current) {
      resetView();
      initialized.current = true;
    } else if (range && previous.length && data.length) {
      const removed = previous.findIndex((c) => c.time === data[0].time);
      const offset = previousFirstIndex >= 0 ? previousFirstIndex : removed >= 0 ? -removed : 0;
      const shift = following ? data.length - previous.length : Math.max(-previous.length, offset);
      chart.timeScale().setVisibleLogicalRange({ from: range.from + shift, to: range.to + shift });
    }
  }, [data, fmtPrice]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.cs.applyOptions({ visible: mode === "candles" });
    series.area.applyOptions({ visible: mode === "line" });
    series.cs.priceScale().applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal // Logarithmic : Normal
    });
  }, [mode, logScale]);

  useEffect(() => {
    seriesRef.current?.spotLines.forEach((line) => line.applyOptions({
      price: displaySpot ?? 0, lineVisible: displaySpot !== null, axisLabelVisible: displaySpot !== null
    }));
  }, [displaySpot]);

  useEffect(() => {
    chartRef.current?.timeScale().applyOptions({ timeVisible: interval < 86400 });
    chartRef.current?.panes()[1]?.setHeight(64);
  }, [interval, expanded, height]);

  const buttonClass = "rounded-md px-2.5 py-1.5 text-[11px] font-medium transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
  const emptyMessage = loading ? "Loading indexed trades…" : error ? "Could not load chart history" : "No indexed trades yet";

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-[#0c101a]">
      {/* toggles */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] px-2 py-2">
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1" aria-label="Chart style">
            {(["candles", "line"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                className={cn(buttonClass, mode === m ? "bg-accent/15 text-accent" : "text-white/70")}>
                {m === "candles" ? "Candles" : "Line"}
              </button>
            ))}
          </div>
          {onCurrencyChange ? (
            <div className="ml-1 flex items-center gap-0.5 rounded-md bg-white/[0.04] p-0.5" aria-label="Price unit">
              {(["ASE", "USD"] as const).map((u) => (
                <button key={u} type="button" aria-pressed={displayCurrency === u}
                  disabled={u === "USD" && !(usdRate && usdRate > 0)}
                  onClick={() => onCurrencyChange(u)}
                  className={cn(
                    "rounded px-2 py-1 text-[10px] font-bold transition",
                    displayCurrency === u ? "bg-accent/20 text-accent" : "text-white/65 hover:bg-white/10 hover:text-white",
                    u === "USD" && !(usdRate && usdRate > 0) && "cursor-not-allowed opacity-40"
                  )}
                >{u}</button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1 text-white/60">
          <button type="button" aria-pressed={logScale} onClick={() => setLogScale((v) => !v)}
            className={cn(buttonClass, logScale && "bg-accent/15 text-accent")}>Log</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoom(0.8)} className={buttonClass}>−</button>
          <button type="button" aria-label="Zoom in" onClick={() => zoom(1.25)} className={buttonClass}>+</button>
          <button type="button" onClick={resetView} className={buttonClass}>Reset</button>
          <button type="button" aria-pressed={expanded} onClick={() => setExpanded((v) => !v)} className={buttonClass}>
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>
      {/* OHLCV legend */}
      <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/5 px-3 py-2 font-mono text-[11px] tabular-nums">
        {legend ? <>
          <span className="text-white/50">Last trade</span>
          <span className="text-white/60">{new Date(legend.time * 1000).toLocaleString("en-GB", { timeZone: "UTC", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })} UTC</span>
          {(["open", "high", "low", "close"] as const).map((field) => (
            <span key={field} className="text-white/60">{field[0].toUpperCase()} <b className={legend.close >= legend.open ? "font-medium text-emerald-300" : "font-medium text-red-300"}><PricePower text={fmtPrice(legend[field])} /></b></span>
          ))}
          <span className="text-white/60">Vol <b className="font-medium text-white/70">{fmtVolume(legend.volume)} ASE</b></span>
        </> : <span className="text-white/60">Price in {displayCurrency} per token</span>}
        {displaySpot !== null ? (
          <span className="text-accent/80" title={formatTokenPriceLabel(displaySpot, displayCurrency, false)}>
            Spot <b className="font-medium text-accent"><PricePower text={fmtPrice(displaySpot)} /></b>
          </span>
        ) : null}
      </div>
      {/* volume pane separator — native divider above the compact 64px volume pane */}
      <div className="relative">
        <div ref={ref} style={{ height: expanded ? Math.max(560, height) : (compact ? Math.min(height, 300) : height) }} className="w-full" aria-label={`Token price candles in ${displayCurrency} and separate ASE volume chart`} />
        <span className="pointer-events-none absolute bottom-[66px] left-3 text-[9px] uppercase tracking-wider text-white/60">Volume · ASE</span>
        {data.length === 0 ? (
          <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0c101a]/85 px-6 text-center">
            <p className="text-sm font-medium text-white/70">{emptyMessage}</p>
            <p className="max-w-sm text-xs text-white/60">Candles appear as trades are indexed. Empty intervals carry the last close forward.</p>
            {error && onRetry ? <button type="button" onClick={onRetry} className={cn(buttonClass, "text-accent")}>Retry</button> : null}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] px-3 py-2 text-[10px] text-white/60">
        <span>Indexed execution prices · {displayCurrency}/token · UTC{historyLimited ? " · Recent 5,000 trades" : ""}</span>
        <span className={error ? "text-amber-300" : "text-white/60"}>
          {error ? "Refresh failed, showing last data" : refreshing ? "Refreshing…" : `${data.length} candles`}
        </span>
      </div>
      {data.length > 0 && data.length < 10 ? (
        <p className="border-t border-white/5 px-3 py-2 text-[11px] leading-relaxed text-white/60">
          Early history: flat segments are intervals with no trades, they carry the last price forward. The purple Spot line is the live curve price.
        </p>
      ) : null}
    </div>
  );
}
