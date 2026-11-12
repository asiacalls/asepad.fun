import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#000000",
        foreground: "#F0F0F0",
        card: "rgba(255,255,255,0.03)",
        border: "rgba(192, 192, 192, 0.14)",
        chrome: {
          50: "#FAFAFA",
          100: "#F0F0F0",
          200: "#E0E0E0",
          300: "#D4D4D4",
          400: "#C0C0C0",
          500: "#A8A8A8",
          600: "#8A8A8A"
        },
        steel: {
          400: "#9CA3AF",
          500: "#6B7280"
        },
        /** Legacy utility names → silver/chrome palette */
        cyan: {
          300: "#E5E5E5",
          400: "#D1D1D1",
          500: "#B8B8B8"
        },
        purple: {
          300: "#B0B0B0",
          400: "#9A9A9A",
          500: "#808080"
        },
        navy: {
          900: "#0A0A0A"
        }
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(212,212,212,0.18), 0 0 40px rgba(255,255,255,0.06)",
        glowStrong:
          "0 0 0 1px rgba(232,232,232,0.28), 0 0 56px rgba(255,255,255,0.1), inset 0 1px 0 rgba(255,255,255,0.08)",
        chrome: "0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)"
      },
      backgroundImage: {
        "grid-fade":
          "radial-gradient(circle at 50% 0%, rgba(232,232,232,0.20), transparent 52%), radial-gradient(circle at 20% 30%, rgba(192,192,192,0.18), transparent 55%), radial-gradient(circle at 80% 40%, rgba(212,212,212,0.10), transparent 50%)",
        "grad-border":
          "linear-gradient(90deg, rgba(224,224,224,0.5), rgba(160,160,160,0.35), rgba(224,224,224,0.45))",
        "btn-chrome":
          "linear-gradient(180deg, #f0f0f0 0%, #c8c8c8 45%, #a0a0a0 100%)",
        "text-chrome": "linear-gradient(180deg, #ffffff 0%, #d4d4d4 50%, #a8a8a8 100%)"
      },
      keyframes: {
        floaty: {
          "0%, 100%": { transform: "translate3d(0,0,0)" },
          "50%": { transform: "translate3d(0,-10px,0)" }
        },
        shimmer: {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "100% 50%" }
        },
        pulseGlow: {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" }
        },
        tickerMarquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" }
        }
      },
      animation: {
        floaty: "floaty 6s ease-in-out infinite",
        shimmer: "shimmer 3.5s ease infinite",
        "pulse-glow": "pulseGlow 4s ease-in-out infinite",
        "ticker-marquee": "tickerMarquee 45s linear infinite"
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        brand: ["var(--font-brand)", "var(--font-sans)", "sans-serif"]
      }
    }
  },
  plugins: []
} satisfies Config;
