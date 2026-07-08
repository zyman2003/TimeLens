import React, { useEffect, useRef, useState } from "react";

/* ============================================================
   TELESCOPE v5 — Glass lens + pinned sections
   · #F5F5F5 card, #FFFFFF glass cover, fixed & centered
   · Bars: grey years · #FF8C4C months · #D5BEFE weeks
   · Click while magnified → pin that section open (stays put)
   · Multiple sections can stay expanded at once
   · Hover a pinned section → "CLOSE ✕" hint; click → snap back
   ============================================================ */

// ---------- palette ----------
const BG = "#EEEEEE";
const CARD = "#F7F7F7";
const COVER = "#FFFFFF";
const INK = "#232323";
const GREY = "#B4B4B4"; // year bars
const GREY_HI = "#8C8C8C";
const GREY_HOVER = "#5A5A5A"; // year bar hover (lens off)
const ORANGE = "#FF8C4C"; // month bars
const PURPLE = "#94BDFF"; // week bars
const FAINT = "#E4E4E4";
const DIM = "#A6A6A6";

// ---------- data · 16 years ----------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
const rand = mulberry32(21);
const N_YEARS = 16;
const DATA = Array.from({ length: N_YEARS }, (_, yi) => {
  const year = 2011 + yi;
  const trend = 0.55 + 0.5 * Math.sin(yi * 0.55) + yi * 0.05;
  const months = MONTHS.map((m, mi) => {
    const season = 0.6 + 0.4 * Math.sin((mi / 12) * Math.PI * 2 + yi * 0.7);
    const weeks = Array.from({ length: 4 }, () =>
      Math.max(300, (700 + rand() * 2100) * season * trend),
    );
    return { name: m, weeks, value: weeks.reduce((a, b) => a + b, 0) };
  });
  return { year, months, total: months.reduce((a, m) => a + m.value, 0) };
});
const fmtK = (n) =>
  "$" +
  (n >= 1000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + "K" : n.toFixed(0));

// ---------- spring engine ----------
function useSprings(init) {
  const store = useRef(
    Object.fromEntries(
      Object.entries(init).map(([k, v]) => [k, { v, t: v, vel: 0 }]),
    ),
  );
  const [, tick] = useState(0);
  const reduced = useRef(
    typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    let raf,
      last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.03, (now - last) / 1000);
      last = now;
      let moving = false;
      for (const k in store.current) {
        const s = store.current[k];
        if (reduced.current) {
          s.v = s.t;
          s.vel = 0;
          continue;
        }
        const F = -160 * (s.v - s.t) - 21 * s.vel;
        s.vel += F * dt;
        s.v += s.vel * dt;
        if (Math.abs(s.v - s.t) > 0.0005 || Math.abs(s.vel) > 0.0005)
          moving = true;
        else {
          s.v = s.t;
          s.vel = 0;
        }
      }
      if (moving) tick((x) => x + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const set = (k, target, snap = false) => {
    store.current[k].t = target;
    if (snap) {
      store.current[k].v = target;
      store.current[k].vel = 0;
    }
    tick((x) => x + 1);
  };
  return [store.current, set];
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);

// ---------- geometry ----------
const W = 1000,
  H = 600; // trimmed bottom space
const M = { l: 52, r: 52 };
const BASE = 470,
  TOP = 196;
const CHART_W = W - M.l - M.r;
const HEAD_LINE = 176; // top divider
const FOOT_LINE = H - 46; // bottom divider
const COVER_Y = HEAD_LINE + 1; // cover spans exactly between the two lines
const COVER_H = FOOT_LINE - HEAD_LINE - 2;

export default function TelescopeLens() {
  const [springs, setSpring] = useSprings({
    lens: 0,
    depth: 0,
    cx: W / 2,
    gate: 1,
  });
  const [active, setActive] = useState(false);
  const [depthMode, setDepth] = useState("monthly");
  const [inside, setInside] = useState(false);
  // pinned sections: { [yearIndex]: 'monthly' | 'weekly' }, plus a spring each
  const [pins, setPins] = useState({});
  const [pinSprings, setPinSpring] = useSprings({}); // dynamic keys pin_<i>
  const [hoverPin, setHoverPin] = useState(null);
  const svgRef = useRef(null);

  const lens = clamp(springs.lens.v, 0, 1);
  const depth = clamp(springs.depth.v, 0, 1);
  const lensCx = springs.cx.v;
  const gate = clamp(springs.gate.v, 0, 1); // 1 = live lens on, 0 = suppressed over a pin

  // register a spring for a pin lazily
  const ensurePinSpring = (i) => {
    if (!("pin_" + i in pinSprings)) {
      pinSprings["pin_" + i] = { v: 0, t: 0, vel: 0 };
    }
  };

  const toggleLens = () => {
    const next = !active;
    setActive(next);
    if (!next) setSpring("lens", 0);
    else if (inside) setSpring("lens", 1);
  };
  const pickDepth = (m) => {
    setDepth(m);
    setSpring("depth", m === "weekly" ? 1 : 0);
  };

  const toLocalX = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * W;
  };
  const onMove = (e) => {
    const x = clamp(toLocalX(e), M.l + 10, W - M.r - 10);
    if (!inside) {
      setSpring("cx", x, true);
      setInside(true);
    } else setSpring("cx", x);
    if (active) setSpring("lens", 1);
  };
  const onLeave = () => {
    setInside(false);
    setSpring("lens", 0);
    setHoverPin(null);
  };
  const onWheel = (e) => {
    if (!active) return;
    if (e.deltaY < -8 && depthMode === "monthly") pickDepth("weekly");
    if (e.deltaY > 8 && depthMode === "weekly") pickDepth("monthly");
  };

  // ---------- base slots (fixed positions; pins live here) ----------
  const baseSlot = CHART_W / N_YEARS;
  const cIdx = (lensCx - M.l) / baseSlot - 0.5;
  const nearI = clamp(Math.round(cIdx), 0, N_YEARS - 1);

  // ---------- widths: fisheye (live lens) + pinned expansions ----------
  // Each year gets a "gain" ≥1. Live lens adds a gaussian bump; each pin adds
  // a fixed bump. Widths renormalize to fill the chart → everything shifts
  // smoothly and pinned sections keep their room even as the lens roams.
  // While the cursor is over a pinned section, the live lens is suppressed so
  // the layout freezes — you can hover every bar inside without it shifting.
  const sigma = 0.55;
  const liveBoost = 7.5 + 4.5 * depth;
  const lensLive = lens * gate;
  const gains = DATA.map((_, i) => {
    let g = 1;
    const bump = Math.exp(-((i - cIdx) ** 2) / (2 * sigma * sigma));
    g += liveBoost * bump * lensLive;
    if (pins[i] != null) {
      ensurePinSpring(i);
      const p = clamp(pinSprings["pin_" + i].v, 0, 1);
      const pBoost = pins[i] === "weekly" ? 12 : 7.5;
      g += pBoost * p;
    }
    return g;
  });
  const gainSum = gains.reduce((a, b) => a + b, 0);
  const widths = gains.map((g) => (g / gainSum) * CHART_W);
  const xs = [];
  widths.reduce((acc, w, i) => {
    xs[i] = acc;
    return acc + w;
  }, M.l);

  const maxTotal = Math.max(...DATA.map((d) => d.total));
  const maxMonth = Math.max(
    ...DATA.flatMap((d) => d.months.map((m) => m.value)),
  );
  const maxWeek = Math.max(
    ...DATA.flatMap((d) => d.months.flatMap((m) => m.weeks)),
  );
  const chartH = BASE - TOP;
  const focusData = DATA[nearI];

  // ---------- live glass cover (roaming) ----------
  let coverX = 0,
    coverW = 0,
    wsum = 0;
  DATA.forEach((_, i) => {
    const bump = Math.exp(-((i - cIdx) ** 2) / (2 * sigma * sigma));
    const wgt = bump ** 2;
    coverX += xs[i] * wgt;
    coverW += widths[i] * wgt;
    wsum += wgt;
  });
  if (wsum > 0.0001) {
    coverX /= wsum;
    coverW /= wsum;
  } else {
    coverX = lensCx;
    coverW = 0;
  }
  const coverOn = lensLive > 0.04 && wsum > 0.0001;

  // ---------- click: pin current section, or close a pinned one ----------
  const onClick = () => {
    if (!active) return;
    // if hovering a pinned section, close it
    if (hoverPin != null) {
      setPins((prev) => {
        const n = { ...prev };
        delete n[hoverPin];
        return n;
      });
      setPinSpring("pin_" + hoverPin, 0);
      setHoverPin(null);
      return;
    }
    // otherwise pin the year currently under the live lens
    if (lens > 0.5) {
      const i = nearI;
      ensurePinSpring(i);
      setPins((prev) => ({ ...prev, [i]: depthMode }));
      setPinSpring("pin_" + i, 1);
    }
  };

  // detect hover over a pinned (settled) section; drive the suppression gate
  useEffect(() => {
    if (!active) {
      setHoverPin(null);
      setSpring("gate", 1);
      return;
    }
    let found = null;
    for (const key in pins) {
      const i = +key;
      const p = pinSprings["pin_" + i]?.v ?? 0;
      if (p < 0.55) continue;
      // small inward margin (hysteresis) so the edge doesn't flicker on/off
      const margin = 8;
      if (lensCx >= xs[i] - margin && lensCx <= xs[i] + widths[i] + margin) {
        found = i;
        break;
      }
    }
    setHoverPin(found);
    setSpring("gate", found != null ? 0 : 1); // eases in/out via the spring
  }, [lensCx, active, pins]);

  // ---------- HUD ----------
  let hudLabel = "ALL TIME",
    hudValue = fmtK(DATA.reduce((a, d) => a + d.total, 0));
  if (lens > 0.5 || hoverPin != null) {
    const i = hoverPin != null ? hoverPin : nearI;
    const fx = xs[i],
      fwd = widths[i];
    const u = clamp((lensCx - fx) / fwd, 0, 0.999);
    const dep = hoverPin != null ? (pins[i] === "weekly" ? 1 : 0) : depth;
    if (dep > 0.5) {
      const wi = Math.floor(u * 48);
      const mo = DATA[i].months[Math.floor(wi / 4)];
      hudLabel = `WK ${(wi % 4) + 1} · ${mo.name} ${DATA[i].year}`;
      hudValue = fmtK(mo.weeks[wi % 4]);
    } else {
      const mi = Math.floor(u * 12);
      hudLabel = `${DATA[i].months[mi].name} ${DATA[i].year}`;
      hudValue = fmtK(DATA[i].months[mi].value);
    }
  } else if (inside) {
    hudLabel = `${focusData.year}`;
    hudValue = fmtK(focusData.total);
  }

  // renders one expanded section's sub-bars into `els`
  const renderSub = (d, i, x, w, openAmt, dep, els, keyp, highlightLive) => {
    const subOp = smooth(clamp(openAmt, 0, 1));
    const pad = Math.min(12, w * 0.06);
    const innerW = w - pad * 2;

    const moOp = subOp * (1 - dep);
    if (moOp > 0.02) {
      const mw = innerW / 12;
      d.months.forEach((m, mi) => {
        const bh = (m.value / maxMonth) * chartH * subOp;
        const bw = Math.max(3, mw * 0.58);
        els.push(
          <rect
            key={keyp + "m" + mi}
            x={x + pad + mi * mw + (mw - bw) / 2}
            y={BASE - bh}
            width={bw}
            height={bh}
            rx={bw / 2}
            fill="url(#gMonth)"
            filter="url(#softBottom)"
            opacity={moOp}
          />,
        );
      });
      if (w > 240)
        [0, 3, 6, 9].forEach((mi) =>
          els.push(
            <text
              key={keyp + "ml" + mi}
              x={x + pad + (mi + 0.5) * (innerW / 12)}
              y={BASE + 30}
              textAnchor="middle"
              fill={DIM}
              fontSize="10"
              letterSpacing="1"
              opacity={moOp}
            >
              {MONTHS[mi]}
            </text>,
          ),
        );
    }

    const wkOp = subOp * dep;
    if (wkOp > 0.02) {
      const ww = innerW / 48;
      d.months.forEach((m, mi) =>
        m.weeks.forEach((v, wi) => {
          const k = mi * 4 + wi;
          const bh = (v / maxWeek) * chartH * subOp;
          els.push(
            <rect
              key={keyp + "w" + k}
              x={x + pad + k * ww + ww * 0.25}
              y={BASE - bh}
              width={Math.max(1.8, ww * 0.5)}
              height={bh}
              rx={Math.max(0.9, ww * 0.25)}
              fill="url(#gWeek)"
              filter="url(#softBottom)"
              opacity={wkOp}
            />,
          );
        }),
      );
      if (w > 240)
        [0, 3, 6, 9].forEach((mi) =>
          els.push(
            <text
              key={keyp + "wl" + mi}
              x={x + pad + (mi * 4 + 2) * (innerW / 48)}
              y={BASE + 30}
              textAnchor="middle"
              fill={DIM}
              fontSize="10"
              letterSpacing="1"
              opacity={wkOp}
            >
              {MONTHS[mi]}
            </text>,
          ),
        );
    }

    // ink highlight bar under the live cursor
    if (highlightLive && subOp > 0.5) {
      const u = clamp((lensCx - x - pad) / innerW, 0, 0.999);
      if (dep > 0.5) {
        const k = Math.floor(u * 48),
          ww = innerW / 48;
        const v = d.months[Math.floor(k / 4)].weeks[k % 4];
        const bh = (v / maxWeek) * chartH * subOp;
        els.push(
          <rect
            key={keyp + "hiw"}
            x={x + pad + k * ww + ww * 0.25}
            y={BASE - bh}
            width={Math.max(1.8, ww * 0.5)}
            height={bh}
            rx={Math.max(0.9, ww * 0.25)}
            fill={INK}
            opacity={subOp}
          />,
        );
      } else {
        const mi = Math.floor(u * 12),
          mw = innerW / 12;
        const bw = Math.max(3, mw * 0.58);
        const bh = (d.months[mi].value / maxMonth) * chartH * subOp;
        els.push(
          <rect
            key={keyp + "him"}
            x={x + pad + mi * mw + (mw - bw) / 2}
            y={BASE - bh}
            width={bw}
            height={bh}
            rx={bw / 2}
            fill={INK}
            opacity={subOp}
          />,
        );
      }
    }

    els.push(
      <text
        key={keyp + "yl"}
        x={x + w / 2}
        y={BASE + 66}
        textAnchor="middle"
        fill={INK}
        fontSize="19"
        letterSpacing="1"
        fontWeight="700"
        opacity={subOp}
      >
        {d.year}
      </text>,
    );
  };

  return (
    <div
      style={{
        height: "100vh",
        width: "100%",
        background: BG,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 56,
        boxSizing: "border-box",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600&display=swap');

        /* ---- lens control cluster (top-right, right-anchored) ---- */
        .lens-cluster {
          position: absolute; top: 8.7cqw; right: 4.2cqw; transform: translateY(-50%);
          display: flex; align-items: center; flex-direction: row;
          justify-content: flex-end;
        }

        /* depth pill — grows leftward when the lens is on */
        .split-pill {
          position: relative; display: flex; align-items: center; overflow: hidden;
          height: 6.2cqw; border-radius: 999px;
          background: ${INK};
          box-shadow: 0 6px 18px rgba(0,0,0,0.16), inset 0 1px 1px rgba(255,255,255,0.06);
          max-width: 0; opacity: 0; padding: 0;
          transform-origin: right center; transform: scaleX(0.6);
          transition:
            max-width .46s cubic-bezier(.34,1.7,.4,1),
            transform .46s cubic-bezier(.34,1.7,.4,1),
            opacity .3s, padding .3s, margin-right .3s;
          pointer-events: none; margin-right: 0;
        }
        .split-pill.show { max-width: 40cqw; opacity: 1; padding: 0 0.8cqw; transform: scaleX(1); pointer-events: auto; margin-right: 0.8cqw; }
        .split-pill button {
          border: none; cursor: pointer; height: 5.1cqw; padding: 0 2cqw; border-radius: 999px;
          font: 500 1.72cqw/1 'Inter', sans-serif; letter-spacing: 0.4px; white-space: nowrap;
          color: rgba(255,255,255,0.55); background: transparent;
          transition: background .25s, color .25s;
        }
        .split-pill button.sel { background: #fff; color: ${INK}; }
        .split-pill .divider { width: 1px; height: 2.5cqw; background: rgba(255,255,255,0.18); flex: 0 0 auto; }

        /* magnify control — labeled pill idle, collapses to circle when on */
        .lens-orb {
          position: relative; z-index: 2; height: 7cqw; flex: 0 0 auto;
          border-radius: 999px; cursor: pointer; border: none;
          display: flex; align-items: center; gap: 1.2cqw;
          padding: 0 2.8cqw 0 2.4cqw;
          color: ${INK}; font: 500 1.86cqw/1 'Inter', sans-serif; letter-spacing: 0.4px;
          background:
            radial-gradient(130% 130% at 32% 22%, rgba(255,255,255,0.95), rgba(255,255,255,0.5) 42%, rgba(255,255,255,0.25) 72%),
            rgba(255,255,255,0.4);
          backdrop-filter: blur(14px) saturate(1.2);
          -webkit-backdrop-filter: blur(14px) saturate(1.2);
          border: 1px solid rgba(255,255,255,0.75);
          box-shadow:
            0 3px 9px rgba(0,0,0,0.06),
            0 1px 2px rgba(0,0,0,0.04),
            inset 0 1.5px 2px rgba(255,255,255,1),
            inset 0 -5px 10px rgba(0,0,0,0.05),
            inset 3px 0 6px rgba(255,255,255,0.5);
          transition: transform .3s cubic-bezier(.34,1.7,.5,1), box-shadow .3s, background .3s, border-color .3s, padding .3s;
        }
        .lens-orb::after {
          content: ""; position: absolute; top: 0.8cqw; left: 1.9cqw; width: 26%; height: 30%;
          border-radius: 999px;
          background: linear-gradient(180deg, rgba(255,255,255,0.9), rgba(255,255,255,0));
          filter: blur(1px); pointer-events: none; opacity: 1; transition: opacity .3s;
        }
        .lens-orb .lens-label {
          max-width: 14cqw; opacity: 1; overflow: hidden; white-space: nowrap;
          transition: max-width .3s, opacity .2s, margin .3s;
        }
        .lens-orb:hover { transform: translateY(-1px); }
        .lens-orb:active { transform: scale(.96); }
        /* pressed → circle, no text, solid black */
        .lens-orb.on {
          width: 7cqw; padding: 0; justify-content: center;
          background: ${INK}; border-color: ${INK};
          box-shadow:
            0 4px 12px rgba(0,0,0,0.14),
            0 1px 2px rgba(0,0,0,0.08),
            inset 0 1px 1px rgba(255,255,255,0.10);
        }
        .lens-orb.on .lens-label { max-width: 0; opacity: 0; margin-left: -1.3cqw; }
        .lens-orb.on::after { opacity: 0.12; }
        .lens-orb svg { position: relative; flex: 0 0 auto; width: 3.4cqw; height: 3.4cqw; }
      `}</style>

      {/* responsive column, ~50% of viewport, capped */}
      <div
        style={{
          width: "50vw",
          minWidth: 420,
          maxWidth: 860,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {/* product description, above the card */}
        <div
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontSize: 13,
            color: DIM,
            textAlign: "center",
            letterSpacing: 0.2,
          }}
        >
          Multi-scale zoom for your charts without context switching
        </div>

        {/* fixed-size card */}
        <div
          style={{
            position: "relative",
            width: "100%",
            containerType: "inline-size",
            background: CARD,
            borderRadius: 30,
            boxShadow: "0 20px 50px rgba(0,0,0,.10)",
            overflow: "hidden",
          }}
        >
          {/* lens control cluster: depth pill + magnify control */}
          <div className="lens-cluster">
            <div className={"split-pill" + (active ? " show" : "")}>
              <button
                className={depthMode === "monthly" ? "sel" : ""}
                onClick={() => pickDepth("monthly")}
              >
                Monthly
              </button>
              <span className="divider" />
              <button
                className={depthMode === "weekly" ? "sel" : ""}
                onClick={() => pickDepth("weekly")}
              >
                Weekly
              </button>
            </div>
            <button
              className={"lens-orb" + (active ? " on" : "")}
              onClick={toggleLens}
              aria-pressed={active}
              aria-label="Toggle magnifier lens"
            >
              {/* eye-scan icon */}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                {(() => {
                  const c = active ? "#fff" : INK;
                  return (
                    <g
                      stroke={c}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    >
                      <path d="M4 8 V6.5 A2.5 2.5 0 0 1 6.5 4 H8" />
                      <path d="M16 4 H17.5 A2.5 2.5 0 0 1 20 6.5 V8" />
                      <path d="M20 16 V17.5 A2.5 2.5 0 0 1 17.5 20 H16" />
                      <path d="M8 20 H6.5 A2.5 2.5 0 0 1 4 17.5 V16" />
                      <path
                        d="M6.5 12 C8.5 8.8 15.5 8.8 17.5 12 C15.5 15.2 8.5 15.2 6.5 12 Z"
                        fill={c}
                        stroke="none"
                      />
                      <circle
                        cx="12"
                        cy="12"
                        r="1.9"
                        fill={active ? INK : "#fff"}
                        stroke="none"
                      />
                    </g>
                  );
                })()}
              </svg>
              <span className="lens-label">Magnify</span>
            </button>
          </div>

          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            style={{
              display: "block",
              cursor: active
                ? hoverPin != null
                  ? "pointer"
                  : "crosshair"
                : "default",
            }}
            onMouseMove={onMove}
            onMouseLeave={onLeave}
            onWheel={onWheel}
            onClick={onClick}
            role="application"
            aria-label="Revenue chart with a glass magnifier. Toggle the lens, hover to expand, click to pin a section open."
          >
            <defs>
              {/* bar gradients: solid on top, lighter + softening toward the base */}
              <linearGradient id="gYear" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={GREY} />
                <stop offset="1" stopColor={GREY} stopOpacity="0.25" />
              </linearGradient>
              <linearGradient id="gYearHi" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={GREY_HI} />
                <stop offset="1" stopColor={GREY_HI} stopOpacity="0.28" />
              </linearGradient>
              <linearGradient id="gYearHover" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={GREY_HOVER} />
                <stop offset="1" stopColor={GREY_HOVER} stopOpacity="0.3" />
              </linearGradient>
              <linearGradient id="gMonth" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={ORANGE} />
                <stop offset="1" stopColor={ORANGE} stopOpacity="0.22" />
              </linearGradient>
              <linearGradient id="gWeek" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={PURPLE} />
                <stop offset="1" stopColor={PURPLE} stopOpacity="0.22" />
              </linearGradient>
              {/* tiny blur so bar bottoms melt into the card */}
              <filter
                id="softBottom"
                x="-20%"
                y="-10%"
                width="140%"
                height="130%"
              >
                <feGaussianBlur stdDeviation="0.6" />
              </filter>
            </defs>

            {/* header */}
            <text
              x={M.l}
              y={52}
              fill={DIM}
              fontSize="13"
              letterSpacing="3"
              fontWeight="500"
            >
              REVENUE
            </text>
            <text
              x={M.l - 3}
              y={108}
              fill={INK}
              fontSize="46"
              fontWeight="600"
              letterSpacing="-1.5"
              fontFamily="'JetBrains Mono', monospace"
            >
              <tspan>{hudValue.charAt(0)}</tspan>
              <tspan dx="3">{hudValue.slice(1)}</tspan>
            </text>
            <text
              x={M.l}
              y={148}
              fill={GREY_HOVER}
              fontSize="17"
              letterSpacing="1.5"
              fontWeight="400"
            >
              {hudLabel}
            </text>
            <line
              x1={0}
              y1={176}
              x2={W}
              y2={176}
              stroke={FAINT}
              strokeWidth="1"
            />

            {/* ---- pinned glass covers (settled, behind bars) ---- */}
            {Object.keys(pins).map((key) => {
              const i = +key;
              const p = clamp(pinSprings["pin_" + i]?.v ?? 0, 0, 1);
              if (p < 0.02) return null;
              const x = xs[i],
                w = widths[i];
              const isHov = hoverPin === i;
              const bx = x - 10,
                bw = w + 20,
                by = COVER_Y,
                bh = COVER_H;
              const cxI = bx + bw - 22,
                cyI = by + 22; // collapse icon center
              return (
                <g key={"cover" + i} pointerEvents="none" opacity={smooth(p)}>
                  <rect
                    x={bx}
                    y={by}
                    width={bw}
                    height={bh}
                    rx={20}
                    fill="rgba(0,0,0,0.05)"
                    transform="translate(0 4)"
                    style={{ filter: "blur(7px)" }}
                  />
                  <rect
                    x={bx}
                    y={by}
                    width={bw}
                    height={bh}
                    rx={20}
                    fill={COVER}
                  />
                  <rect
                    x={bx}
                    y={by}
                    width={bw}
                    height={bh}
                    rx={20}
                    fill="none"
                    stroke="rgba(255,255,255,0.9)"
                    strokeWidth="1.4"
                  />
                  {/* collapse icon — two arrows pointing inward (compress) */}
                  <g
                    style={{ transition: "opacity .2s" }}
                    opacity={0.55 + 0.45 * (isHov ? 1 : 0)}
                  >
                    <circle
                      cx={cxI}
                      cy={cyI}
                      r={14}
                      fill={isHov ? INK : "rgba(35,35,35,0.08)"}
                      style={{ transition: "fill .2s" }}
                    />
                    {(() => {
                      const c = isHov ? "#fff" : INK,
                        sw = 1.7,
                        a = 5.5;
                      // top-right arrow pointing down-left toward center
                      return (
                        <g
                          stroke={c}
                          strokeWidth={sw}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="none"
                        >
                          <line
                            x1={cxI + a}
                            y1={cyI - a}
                            x2={cxI + 1.2}
                            y2={cyI - 1.2}
                          />
                          <polyline
                            points={`${cxI + 1.2},${cyI - 4.6} ${cxI + 1.2},${cyI - 1.2} ${cxI + 4.6},${cyI - 1.2}`}
                          />
                          {/* bottom-left arrow pointing up-right toward center */}
                          <line
                            x1={cxI - a}
                            y1={cyI + a}
                            x2={cxI - 1.2}
                            y2={cyI + 1.2}
                          />
                          <polyline
                            points={`${cxI - 1.2},${cyI + 4.6} ${cxI - 1.2},${cyI + 1.2} ${cxI - 4.6},${cyI + 1.2}`}
                          />
                        </g>
                      );
                    })()}
                  </g>
                </g>
              );
            })}

            {/* ---- live roaming glass cover ---- */}
            {coverOn && (
              <g
                pointerEvents="none"
                opacity={smooth(clamp(lensLive * 1.4, 0, 1))}
              >
                <rect
                  x={coverX - 12}
                  y={COVER_Y}
                  width={coverW + 24}
                  height={COVER_H}
                  rx={20}
                  fill="rgba(0,0,0,0.05)"
                  transform="translate(0 4)"
                  style={{ filter: "blur(7px)" }}
                />
                <rect
                  x={coverX - 12}
                  y={COVER_Y}
                  width={coverW + 24}
                  height={COVER_H}
                  rx={20}
                  fill={COVER}
                />
                <rect
                  x={coverX - 12}
                  y={COVER_Y}
                  width={coverW + 24}
                  height={COVER_H}
                  rx={20}
                  fill="none"
                  stroke="rgba(255,255,255,0.95)"
                  strokeWidth="1.5"
                />
              </g>
            )}

            {/* depth label — sits on the glass cover's top-left edge */}
            {coverOn && (
              <text
                x={coverX + 4}
                y={COVER_Y + 30}
                fill={DIM}
                fontSize="16"
                letterSpacing="1.5"
                fontWeight="700"
                opacity={smooth(clamp(lensLive * 1.3, 0, 1))}
                pointerEvents="none"
              >
                {depthMode === "weekly" ? "Weekly" : "Monthly"}
              </text>
            )}

            {/* ---- bars ---- */}
            {DATA.map((d, i) => {
              const x = xs[i],
                w = widths[i];
              const pinAmt =
                pins[i] != null
                  ? clamp(pinSprings["pin_" + i]?.v ?? 0, 0, 1)
                  : 0;
              const pinDep = pins[i] === "weekly" ? 1 : 0;

              // live lens influence on THIS year (its own gaussian share)
              const bump = Math.exp(-((i - cIdx) ** 2) / (2 * sigma * sigma));
              const liveOpen =
                smooth(clamp(bump * 1.15, 0, 1)) *
                lensLive *
                (pinAmt < 0.5 ? 1 : 0);

              const yearH = (d.total / maxTotal) * chartH;
              const pillW = Math.min(24, w * 0.62);
              const openTotal = Math.max(liveOpen, pinAmt);
              const showSub = openTotal > 0.18 && w > 56;
              const pillOp = 1 - smooth(clamp((openTotal - 0.1) * 1.7, 0, 1));
              const isNear = i === nearI;
              const els = [];

              if (pillOp > 0.01) {
                const darker = i % 2 === 1;
                const hoverIdle = !active && inside && isNear; // hover highlight when lens off
                els.push(
                  <rect
                    key="pill"
                    x={x + w / 2 - pillW / 2}
                    y={BASE - yearH}
                    width={pillW}
                    height={yearH}
                    rx={pillW / 2}
                    fill={
                      hoverIdle
                        ? "url(#gYearHover)"
                        : darker
                          ? "url(#gYearHi)"
                          : "url(#gYear)"
                    }
                    filter="url(#softBottom)"
                    opacity={pillOp}
                    style={{ transition: "fill .18s" }}
                  />,
                );
              }

              if (showSub) {
                if (pinAmt > 0.02) {
                  // settled pinned section — highlight the bar under the cursor
                  // whenever the cursor is inside THIS pinned section
                  renderSub(
                    d,
                    i,
                    x,
                    w,
                    pinAmt,
                    pinDep,
                    els,
                    "p" + i,
                    hoverPin === i,
                  );
                } else {
                  // live roaming expansion
                  renderSub(
                    d,
                    i,
                    x,
                    w,
                    liveOpen,
                    depth,
                    els,
                    "l" + i,
                    isNear && hoverPin == null,
                  );
                }
              } else if (i % 4 === 0 || w > 40) {
                els.push(
                  <text
                    key="lab"
                    x={x + w / 2}
                    y={BASE + 30}
                    textAnchor="middle"
                    fill={DIM}
                    fontSize="13"
                    letterSpacing="1"
                    opacity={1 - smooth(clamp(openTotal * 2, 0, 1))}
                  >
                    {String(d.year).slice(2)}
                  </text>,
                );
              }
              return <g key={i}>{els}</g>;
            })}

            {/* footer */}
            <line
              x1={0}
              y1={H - 46}
              x2={W}
              y2={H - 46}
              stroke={FAINT}
              strokeWidth="1"
            />
            <text
              x={M.l}
              y={H - 16}
              fill={DIM}
              fontSize="16"
              letterSpacing="0.5"
              fontWeight="400"
            >
              TimeLens
            </text>
            <text
              x={W - M.r}
              y={H - 16}
              textAnchor="end"
              fill={DIM}
              fontSize="15"
              letterSpacing="0.3"
            >
              {!active
                ? "Tap Magnify, then hover to zoom"
                : hoverPin != null
                  ? "Click the collapse icon to close this section"
                  : "Hover to zoom · Click to pin"}
            </text>
          </svg>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: "24px",
          left: "24px",
          fontSize: "12px",
          color: "#A6A6A6",
          fontFamily: "'Inter', sans-serif",
        }}
      >
        Designed by{" "}
        <a
          href="https://ameliaz.framer.website/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#232323", textDecoration: "underline" }}
        >
          Amelia Z
        </a>
      </div>
    </div>
  );
}
