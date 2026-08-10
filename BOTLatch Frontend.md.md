# IRONFORGE Frontend Design System & Technical Specification

This document provides the full UI/UX design tokens, visual style guide, component specs, CSS architecture, and JavaScript runtime behaviors for the **IRONFORGE — Elite Strength & Conditioning Studio** website.

---

## 1. Design System Tokens & Foundations

### 1.1 Color Palette (CSS Custom Properties)

```css
:root {
  /* Surface & Background Colors */
  --bg: #0a0a0a;              /* Base dark background */
  --bg-darker: #050505;       /* Deep contrast background (sections, cards) */
  --bg-card: #141414;         /* Default surface for cards and containers */
  --bg-card-hover: #1a1a1a;   /* Interactive hover state for cards */

  /* Typography & Foreground */
  --fg: #f5f5f5;              /* Primary text color */
  --fg-dim: #c0c0c0;          /* Secondary text color */
  --muted: #6a6a6a;           /* Captions, metadata, inactive states */

  /* Primary Accent: Blaze Orange */
  --accent: #FF5400;          /* High-visibility action color */
  --accent-bright: #FF7A33;   /* Interactive hover state */
  --accent-dim: #B33A00;      /* Borders, subtle accents, scrollbar thumb */
  --accent-glow: rgba(255, 84, 0, 0.45); /* Box-shadows and pulse effects */

  /* Metallic Silver Accents */
  --silver: #C8C8C8;          /* Light metallic trim */
  --silver-dim: #5a5a5a;      /* Text stroke and subtle borders */

  /* Structural Borders */
  --border: #1f1f1f;          /* Standard divider */
  --border-light: #2a2a2a;    /* Highlighting structural grids */
}