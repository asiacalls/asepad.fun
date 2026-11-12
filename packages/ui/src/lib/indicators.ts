// Technical-indicator math for the TradingView-style token chart.
// Pure functions over candles {time,open,high,low,close,volume} (ms time).
export type IndCandle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
export type IndPoint = { time: number; value: number };

export const ema = (cs: IndCandle[], period: number): IndPoint[] => {
  const k = 2 / (period + 1); let e = 0;
  return cs.map((c, i) => { e = i === 0 ? c.close : c.close * k + e * (1 - k); return { time: c.time, value: e }; });
};
export const sma = (cs: IndCandle[], period: number): IndPoint[] => {
  const out: IndPoint[] = []; let acc = 0;
  cs.forEach((c, i) => { acc += c.close; if (i >= period) acc -= cs[i - period]!.close; if (i >= period - 1) out.push({ time: c.time, value: acc / period }); });
  return out;
};
export const rsi = (cs: IndCandle[], period = 14): IndPoint[] => {
  if (cs.length < period + 1) return [];
  let g = 0, l = 0; const out: IndPoint[] = [];
  for (let i = 1; i < cs.length; i++) {
    const d = cs[i]!.close - cs[i - 1]!.close;
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= period) { g += up / period; l += dn / period; if (i === period) out.push({ time: cs[i]!.time, value: l === 0 ? 100 : 100 - 100 / (1 + g / l) }); }
    else { g = (g * (period - 1) + up) / period; l = (l * (period - 1) + dn) / period; out.push({ time: cs[i]!.time, value: l === 0 ? 100 : 100 - 100 / (1 + g / l) }); }
  }
  return out;
};
export const kdj = (cs: IndCandle[], period = 9, smooth = 3) => {
  const k: IndPoint[] = [], d: IndPoint[] = [], j: IndPoint[] = [];
  let prevK = 50, prevD = 50;
  for (let i = period - 1; i < cs.length; i++) {
    const w = cs.slice(i - period + 1, i + 1);
    const hi = Math.max(...w.map((c) => c.high)), lo = Math.min(...w.map((c) => c.low));
    const rsv = hi === lo ? 50 : ((cs[i]!.close - lo) / (hi - lo)) * 100;
    const nK = (prevK * (smooth - 1) + rsv) / smooth, nD = (prevD * (smooth - 1) + nK) / smooth;
    k.push({ time: cs[i]!.time, value: nK }); d.push({ time: cs[i]!.time, value: nD }); j.push({ time: cs[i]!.time, value: 3 * nK - 2 * nD });
    prevK = nK; prevD = nD;
  }
  return { k, d, j };
};
export const bollinger = (cs: IndCandle[], period = 20, k = 2) => {
  const up: IndPoint[] = [], mid: IndPoint[] = [], lo: IndPoint[] = [];
  for (let i = period - 1; i < cs.length; i++) {
    const s = cs.slice(i - period + 1, i + 1).map((c) => c.close);
    const m = s.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / period);
    up.push({ time: cs[i]!.time, value: m + k * sd }); mid.push({ time: cs[i]!.time, value: m }); lo.push({ time: cs[i]!.time, value: m - k * sd });
  }
  return { up, mid, lo };
};
export const macd = (cs: IndCandle[], fast = 12, slow = 26, sig = 9) => {
  const ef = ema(cs, fast), es = ema(cs, slow);
  const line = ef.map((f, i) => ({ time: f.time, value: f.value - (es[i]?.value ?? f.value) }));
  const sigCs = line.map((p) => ({ time: p.time, open: p.value, high: p.value, low: p.value, close: p.value }));
  const signal = ema(sigCs, sig);
  const hist = line.map((p, i) => ({ time: p.time, value: p.value - (signal[i]?.value ?? p.value) }));
  return { line, signal, hist };
};
export const vwap = (cs: IndCandle[]): IndPoint[] => {
  let pv = 0, vv = 0;
  return cs.map((c) => { const tp = (c.high + c.low + c.close) / 3; pv += tp * (c.volume ?? 0); vv += c.volume ?? 0; return { time: c.time, value: vv > 0 ? pv / vv : c.close }; });
};
