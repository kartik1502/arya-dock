---
version: beta
name: Arya-Dock-Cockpit-Design-System
description: A high-performance virtual macro keypad and companion control deck anchored on a deep navy-black cockpit canvas (#050811 → #0a0f1d → #04060b) with tactile glass keycaps, physical chassis framing bezels, glowing cyan telemetry accents, and the signature M tricolor pill strip (#0066b1 → #1c69d4 → #e22718).

colors:
  primary: "#ffffff"
  body-strong: "#cbd5e1"
  body: "#94a3b8"
  muted: "#64748b"
  dim: "#475569"
  hairline: "#334155"
  hairline-strong: "#1e293b"
  hairline-subtle: "rgba(255, 255, 255, 0.08)"
  canvas-start: "#050811"
  canvas-mid: "#0a0f1d"
  canvas-end: "#04060b"
  surface-card: "#0f172a"
  surface-elevated: "#1e293b"
  surface-soft: "#080e1a"
  surface-chassis: "#060911"
  m-blue-light: "#0066b1"
  m-blue-dark: "#1c69d4"
  m-red: "#e22718"
  cyan: "#38bdf8"
  emerald: "#10b981"
  amber: "#f59e0b"

gradients:
  canvas: "linear-gradient(135deg, #050811 0%, #0a0f1d 50%, #04060b 100%)"
  card: "linear-gradient(135deg, rgba(15, 23, 42, 0.85) 0%, rgba(8, 14, 26, 0.95) 100%)"
  deck: "linear-gradient(145deg, #0f172a 0%, #060911 100%)"
  key-glass: "linear-gradient(180deg, rgba(255, 255, 255, 0.22) 0%, rgba(0, 0, 0, 0.28) 100%)"
  paddle: "linear-gradient(180deg, #1e293b 0%, #162032 100%)"

rounded:
  sm: 6px
  md: 8px
  lg: 12px
  key: 14px
  chassis: 24px
  full: 9999px

typography:
  display-xl:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif'
    fontSize: 52px
    fontWeight: 900
    letterSpacing: 1.5px
  headline:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif'
    fontSize: 18px
    fontWeight: 900
    letterSpacing: 1.5px
  subline:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif'
    fontSize: 11px
    fontWeight: 700
    letterSpacing: 0.5px
  badge:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif'
    fontSize: 11px
    fontWeight: 700
    letterSpacing: 1.2px
  key-label:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif'
    fontSize: 11px
    fontWeight: 800
    letterSpacing: 0.5px
  key-sublabel:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif'
    fontSize: 9.5px
    fontWeight: 700
    letterSpacing: 0.4px
---

# Arya Dock — Cockpit Design System

## 1. Overview & Philosophy

Arya Dock's design system translates high-end hardware companion decks (tactile stream decks, aircraft cockpits, and motorsport control consoles) into a fluid, zero-hardware web application.

The design is built around five core tenets:
1. **Deep Cockpit Canvas**: A 3-stop rich navy-black gradient (`#050811` → `#0a0f1d` → `#04060b`) replacing stark flat black, eliminating harsh contrast while providing depth.
2. **Tactile Glass Keycaps**: Keys feature a rich colored substrate (`var(--key-accent)`), covered with a 2-stop vertical glass refraction gradient (`rgba(255, 255, 255, 0.22)` to `rgba(0, 0, 0, 0.28)`), illuminated matching borders via `color-mix()`, subtle top arc reflections, and dual inner/outer drop shadows.
3. **Console Chassis & Outer Bezel**: Double-bordered chassis (`stroke: #334155` outer, `#1e293b` inner) with `24px` border radius and deep ambient drop shadow (`0 20px 45px -10px rgba(0, 0, 0, 0.75)`).
4. **M Tricolor Signature Accent**: 3 sleek horizontal rounded pills (`#0066b1` light blue, `#1c69d4` tech blue, `#e22718` motorsport red) providing a refined identity marker.
5. **Physical Navigation & Telemetry**: Bottom shift paddles styled like physical console pushbuttons (`#1e293b` with `#334155` border and `10px` radius) flanking a centered telemetry cluster.

---

## 2. Color Palette & Gradients

### Surfaces & Backgrounds
- **Deep Cockpit Canvas**: `linear-gradient(135deg, #050811 0%, #0a0f1d 50%, #04060b 100%)`
- **Outer Framing Card**: `linear-gradient(135deg, rgba(15, 23, 42, 0.85) 0%, rgba(8, 14, 26, 0.95) 100%)`
- **Keypad Deck Chassis**: `linear-gradient(145deg, #0f172a 0%, #060911 100%)`
- **Surface Elevated**: `#1e293b` (slate-800)
- **Surface Card**: `#0f172a` (slate-900)
- **Surface Soft**: `#080e1a` (deep slate)

### Hairlines & Borders
- **Chassis Outer Stroke**: `#334155` (slate-700, 1.5px - 2px)
- **Chassis Inner Outline**: `#1e293b` (slate-800, 1px)
- **Card Highlight**: `rgba(255, 255, 255, 0.08)`

### Brand & Accents
- **M Blue Light**: `#0066b1`
- **M Blue Dark**: `#1c69d4`
- **M Red**: `#e22718`
- **Telemetry Cyan**: `#38bdf8` (dot glow: `box-shadow: 0 0 8px #38bdf8`)
- **Online Green**: `#10b981` (dot glow: `box-shadow: 0 0 8px #10b981`)
- **Connecting Amber**: `#f59e0b`

---

## 3. Tactile Glass Keycap Architecture

The signature element of Arya Dock is the virtual tactile glass key switch:

```css
.m-lcd-key {
  container-type: inline-size;
  position: relative;
  background-color: var(--key-accent, #1c69d4);
  background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.22) 0%, rgba(0, 0, 0, 0.28) 100%);
  border: 1.5px solid color-mix(in srgb, var(--key-accent, #1c69d4) 55%, #ffffff 45%);
  border-radius: clamp(10px, 2.5cqw, 16px);
  box-shadow: 0 8px 18px -4px rgba(0, 0, 0, 0.65),
              inset 0 1px 1px 0 rgba(255, 255, 255, 0.35),
              inset 0 -3px 4px 0 rgba(0, 0, 0, 0.35);
  transition: transform 0.1s cubic-bezier(0.2, 0, 0, 1), filter 0.15s ease, box-shadow 0.15s ease;
}

/* Glass arc sheen on top half */
.m-lcd-key::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 48%;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0.02) 100%);
  border-top-left-radius: inherit;
  border-top-right-radius: inherit;
  pointer-events: none;
}
```

### Key Interactions
- **Hover**: `transform: translateY(-2px); filter: brightness(1.12);`
- **Pressed**: `transform: translateY(2px) scale(0.97); filter: brightness(0.92); box-shadow: 0 2px 6px 0 rgba(0, 0, 0, 0.8), inset 0 2px 4px 0 rgba(0, 0, 0, 0.5);`
- **Edit Mode**: Animated pulsing border with glowing cyan/rose highlight.
- **Drag-over**: Highlighted target border with cyan box glow.

---

## 4. Components

### Brand Lockup & Top Header
- **Tricolor Pill Strip**: 3 rounded horizontal pills (height 6px, radius 3px).
- **Companion Deck Badge**: Pill badge with cyan indicator dot and tracking `1.2px`.
- **Mode Selector**: Rounded capsule container (`#0b1329`) with active mode glow.

### Console Chassis Bezel
- Houses the top deck status bar (`ARYA CONSOLE • ONLINE` + page indicator).
- Dynamic grid scaling from 1 to 24 keys with container queries ensuring zero text overflow.

### Physical Steering Paddles
- Molded physical buttons (`#1e293b` fill, `#334155` stroke, `10px` radius).
- Telemetry cluster displays real-time page index and profile topic.

### App Catalog Drawer & Modals
- High-blur frosted backdrop (`rgba(3, 7, 18, 0.82)` with `backdrop-filter: blur(10px)`).
- Card surface with `16px` radius, `#334155` border, and crisp responsive inputs.
