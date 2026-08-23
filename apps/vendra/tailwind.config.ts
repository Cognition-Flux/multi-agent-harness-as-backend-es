import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}",
    // Streamdown renders markdown with tailwind utility classes of its own —
    // scan its dist so they compile (the tw4 equivalent is an @source line).
    // App-local path: pnpm's isolated linker symlinks it here, not at root.
    "./node_modules/streamdown/dist/*.js",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        agent: {
          DEFAULT: "hsl(var(--agent))",
          foreground: "hsl(var(--agent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        // Layered ambient shadows tinted with the foreground ink; "glow"
        // variants carry the brand orange for elevated or live surfaces.
        soft: "0 1px 2px 0 hsl(24 10% 10% / 0.04), 0 8px 24px -12px hsl(24 10% 10% / 0.10)",
        lift: "0 2px 4px -1px hsl(24 10% 10% / 0.06), 0 16px 40px -16px hsl(24 10% 10% / 0.18)",
        glow: "0 0 0 1px hsl(var(--agent) / 0.10), 0 8px 30px -10px hsl(var(--agent) / 0.30)",
        "glow-agent": "0 0 0 1px hsl(var(--agent) / 0.12), 0 8px 30px -10px hsl(var(--agent) / 0.30)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "collapsible-down": {
          from: { height: "0", opacity: "0" },
          to: { height: "var(--radix-collapsible-content-height)", opacity: "1" },
        },
        "collapsible-up": {
          from: { height: "var(--radix-collapsible-content-height)", opacity: "1" },
          to: { height: "0", opacity: "0" },
        },
        "glow-pulse": {
          "0%, 100%": {
            boxShadow: "0 0 0 1px hsl(var(--agent) / 0.15), 0 0 16px 0 hsl(var(--agent) / 0.10)",
          },
          "50%": {
            boxShadow: "0 0 0 1px hsl(var(--agent) / 0.35), 0 0 28px 2px hsl(var(--agent) / 0.22)",
          },
        },
        "gradient-pan": {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "200% 50%" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        // Seamless loop: the track holds two copies of its content, so a
        // -50% translate lands exactly on the second copy's start.
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        // Pulse dot traveling along a horizontal rail (pipeline/flow strips).
        "travel-x": {
          "0%": { left: "0%", opacity: "0" },
          "12%": { opacity: "1" },
          "88%": { opacity: "1" },
          "100%": { left: "100%", opacity: "0" },
        },
        // HITL countdown bar draining left-to-right (landing live-case demo).
        drain: {
          from: { width: "100%" },
          to: { width: "0%" },
        },
      },
      animation: {
        shimmer: "shimmer 2s linear infinite",
        "fade-in": "fade-in 0.3s ease-out both",
        "fade-in-up": "fade-in-up 0.4s ease-out both",
        "scale-in": "scale-in 0.2s ease-out both",
        "collapsible-down": "collapsible-down 0.25s ease-out",
        "collapsible-up": "collapsible-up 0.2s ease-in",
        "glow-pulse": "glow-pulse 2.4s ease-in-out infinite",
        // Slow and linear: with a periodic gradient tile the loop is
        // seamless, and the drift reads as a soft glow rather than a sweep.
        "gradient-pan": "gradient-pan 10s linear infinite",
        // Gentle vertical drift for the landing hero's floating chips.
        float: "float 4.2s ease-in-out infinite",
        marquee: "marquee 30s linear infinite",
        // `both` so the reduced-motion kill-switch (which collapses the
        // duration) parks on the keyframes' own opacity:0 end state instead
        // of reverting to a static visible dot.
        "travel-x": "travel-x 2.1s ease-in-out infinite both",
        // Matches HITL_DURATIONS[1] in live-cases.tsx — retune both together.
        drain: "drain 2.6s linear forwards",
      },
    },
  },
  plugins: [],
};

export default config;
