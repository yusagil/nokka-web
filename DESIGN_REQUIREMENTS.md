# Nokka — Landing Page Design Requirements

## 1. Visual Identity

### Color Palette (Dark Mode First)

The palette is built around a warm "recording" accent against a deep, cool-neutral dark background. No generic gradients. Colors are intentional and sparse.

#### Core Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-bg-primary` | `#0E0E10` | Page background — near-black with a faint warm undertone |
| `--color-bg-secondary` | `#161618` | Card surfaces, elevated containers |
| `--color-bg-tertiary` | `#1C1C1F` | Subtle differentiation (code blocks, input fields) |
| `--color-border-default` | `#2A2A2E` | Default borders — barely visible, structural only |
| `--color-border-subtle` | `#222225` | Hairline dividers |

#### Text Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-text-primary` | `#EDEDEF` | Headlines, primary body text |
| `--color-text-secondary` | `#A0A0A8` | Supporting text, descriptions |
| `--color-text-tertiary` | `#6B6B73` | Captions, metadata, disabled states |

#### Accent Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-accent` | `#E8442D` | Primary accent — a warm, confident vermilion-red evoking "REC" |
| `--color-accent-hover` | `#F25640` | Hover state for accent elements |
| `--color-accent-subtle` | `rgba(232, 68, 45, 0.12)` | Accent backgrounds, tags, badges |
| `--color-accent-glow` | `rgba(232, 68, 45, 0.06)` | Very faint glow for hero emphasis |

#### Semantic Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-success` | `#34C759` | macOS-native green — status indicators |
| `--color-warning` | `#FF9F0A` | macOS-native amber |
| `--color-info` | `#64D2FF` | macOS-native cyan — links, info |

#### Light Mode Override (Optional, Phase 2)

Not in scope for v1. The dark theme IS the brand. If added later, keep the same accent red and flip backgrounds to `#FAFAFA` / `#FFFFFF`.

---

### Typography

Use the native macOS system font stack. This is deliberate — Nokka is a macOS-native app and the typography should feel like it belongs on the platform.

```css
--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif;
--font-mono: "SF Mono", SFMono-Regular, ui-monospace, "Cascadia Code", "Fira Code", monospace;
```

#### Type Scale

| Token | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|--------|-------------|----------------|-------|
| `--text-display` | 56px | 700 | 1.1 | -0.03em | Hero headline only |
| `--text-h1` | 40px | 700 | 1.15 | -0.025em | Section headings |
| `--text-h2` | 28px | 600 | 1.2 | -0.02em | Sub-section headings |
| `--text-h3` | 20px | 600 | 1.3 | -0.015em | Card titles, feature names |
| `--text-body-lg` | 18px | 400 | 1.6 | -0.01em | Hero subheadline, lead text |
| `--text-body` | 16px | 400 | 1.6 | -0.005em | Default body text |
| `--text-body-sm` | 14px | 400 | 1.5 | 0 | Supporting text, captions |
| `--text-caption` | 12px | 500 | 1.4 | 0.01em | Labels, badges, metadata |
| `--text-mono` | 14px | 400 | 1.5 | 0 | Code, technical values, file sizes |

---

### Spacing System

Base unit: **4px**. All spacing uses multiples of 4.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Tight internal padding, icon gaps |
| `--space-2` | 8px | Default gap between inline elements |
| `--space-3` | 12px | Small component padding |
| `--space-4` | 16px | Default component padding |
| `--space-5` | 20px | Medium spacing |
| `--space-6` | 24px | Card padding |
| `--space-8` | 32px | Section internal spacing |
| `--space-10` | 40px | Between related content blocks |
| `--space-12` | 48px | Between sections (mobile) |
| `--space-16` | 64px | Between sections (tablet) |
| `--space-20` | 80px | Between sections (desktop) |
| `--space-24` | 96px | Major section breaks |
| `--space-32` | 128px | Hero top/bottom padding |

---

### Border Radius

Consistent rounding that echoes macOS window chrome. Not too round (avoids bubbly/toy feel), not too sharp (avoids enterprise feel).

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 6px | Small elements: badges, tags, inputs |
| `--radius-md` | 10px | Cards, buttons, containers |
| `--radius-lg` | 14px | Larger cards, modal-like elements |
| `--radius-xl` | 20px | Hero images, featured containers |
| `--radius-full` | 9999px | Pill buttons, status indicators |

---

### Shadow System

Shadows are minimal and only used to create layering — never for decoration. On dark backgrounds, shadows are nearly invisible; rely on border and background-color shifts instead.

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.3)` | Subtle lift for small elements |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.4)` | Cards, elevated surfaces |
| `--shadow-lg` | `0 8px 32px rgba(0,0,0,0.5)` | Hero image, featured screenshots |
| `--shadow-glow` | `0 0 40px var(--color-accent-glow)` | Subtle accent glow (hero only) |

---

## 2. Component Specifications

### Navigation Bar

- **Position**: Fixed top, `backdrop-filter: blur(12px)` with `--color-bg-primary` at 80% opacity
- **Height**: 56px
- **Content**: Logo (left), nav links center-aligned, download CTA (right)
- **Nav links**: Home, Features, Download — text-body-sm, secondary color, no underlines
- **Active state**: text-primary color, no other decoration
- **Logo**: "Nokka" wordmark in --text-h3 weight, --color-text-primary. No icon in the nav — the wordmark is enough.
- **CTA**: Small pill button, accent background, white text, 32px height
- **Scroll behavior**: Background opacity increases from 60% to 85% on scroll
- **Mobile**: Hamburger not needed for 3 links — stack horizontally, shrink spacing. Below 375px, hide "Features" link.

---

### Hero Section

**Layout**: Centered, single-column. No split hero. The headline, subheadline, and CTA stack vertically with generous spacing, followed by a full-width app screenshot.

**Headline**:
- Text: Short, punchy. Example: "Record your Mac screen. Nothing more."
- Style: `--text-display`, `--color-text-primary`
- Max-width: 680px, centered

**Subheadline**:
- Text: One sentence positioning. Example: "A lightweight, native macOS screen recorder. No cloud. No account. No nonsense."
- Style: `--text-body-lg`, `--color-text-secondary`
- Max-width: 520px, centered

**CTA Button**:
- Label: "Download for macOS" (not "Get Started" or "Try Free")
- Style: Pill shape (`--radius-full`), `--color-accent` background, white text, 48px height, 24px horizontal padding
- Icon: A small download arrow (SF Symbols style) to the left of the text
- Hover: Scale to 1.02, background shifts to `--color-accent-hover`, `--shadow-sm`
- Active: Scale to 0.98
- Below button: "macOS 13+ / Apple Silicon & Intel / 4.2 MB" in `--text-caption`, `--color-text-tertiary`

**Hero Visual**:
- A real screenshot of the app in action — the floating control bar visible over a screen recording session
- Wrapped in a container with `--radius-xl`, `--shadow-lg`, and a 1px `--color-border-default` border
- Slight perspective tilt (CSS `perspective` + `rotateX(2deg)`) — very subtle, not dramatic
- Below the fold on mobile; partially visible as a teaser on desktop (user scrolls to see full image)
- No autoplay video in the hero. Static screenshot is more trustworthy and faster to load.

**Spacing**:
- Top padding: `--space-32` (128px)
- Headline → Subheadline: `--space-5` (20px)
- Subheadline → CTA: `--space-8` (32px)
- CTA → Meta text: `--space-3` (12px)
- Meta text → Hero image: `--space-16` (64px)

**Responsive**:
- Mobile: `--text-display` drops to 36px, hero image is full-bleed with 16px side padding
- Tablet: `--text-display` drops to 44px, hero image gets 32px side padding
- Desktop: As described above

---

### Problem Statement Section

**Approach**: Frame positively — what Nokka IS, not what competitors aren't. Present three value props that implicitly address pain points.

**Layout**: Three-column grid on desktop, single-column stack on mobile.

**Cards** (3 items):

1. **"No Sign-Up Required"**
   - Description: "Download, open, record. That's it. No accounts, no onboarding flows, no email harvesting."
   - Icon: A key with a line through it (or a simple lock-open icon)

2. **"Stays on Your Mac"**
   - Description: "Recordings save locally. No cloud uploads, no bandwidth costs, no wondering who has your data."
   - Icon: A Mac mini / desktop icon

3. **"Featherweight"**
   - Description: "Under 5 MB. Launches instantly. Uses minimal CPU and memory while recording."
   - Icon: A feather

**Card styling**:
- Background: `--color-bg-secondary`
- Border: 1px `--color-border-default`
- Border-radius: `--radius-lg`
- Padding: `--space-6`
- Icon: 28px, `--color-accent`, placed above the title
- Title: `--text-h3`, `--color-text-primary`
- Description: `--text-body`, `--color-text-secondary`
- No hover effects on these cards — they're informational, not interactive

**Section heading**: "Why Nokka" or simply omit the heading and let the cards speak. If included, use `--text-h1`, centered, with `--space-10` below.

**Responsive**:
- Desktop: 3-column grid with `--space-6` gap
- Tablet: 3-column grid, narrower
- Mobile: Stack vertically with `--space-4` gap between cards

---

### Feature Showcase Section

**Layout**: Tabbed interface showing the three recording modes. No carousel. Tabs are always visible so the user understands scope at a glance.

**Section heading**: "Three ways to record" — `--text-h1`, centered

**Tab bar**:
- Three tabs: "Full Screen", "Region Select", "Window Capture"
- Style: Pill-shaped segmented control (macOS-native feel)
- Container: `--color-bg-secondary` background, `--radius-full`, 1px `--color-border-default` border
- Active tab: `--color-bg-tertiary` background, `--color-text-primary` text
- Inactive tab: Transparent background, `--color-text-secondary` text
- Tab height: 40px
- Transition: Background slides between tabs (150ms ease)

**Tab content** (for each mode):
- Left side (60%): Screenshot showing that recording mode in action
  - Wrapped in `--radius-lg` container with `--shadow-md`
  - Real UI screenshot — not a mockup or illustration
- Right side (40%): Text content
  - Mode title: `--text-h2`
  - Description: `--text-body`, `--color-text-secondary`, 2-3 sentences max
  - 2-3 bullet points with key details (keyboard shortcut, specific behavior)
  - Bullets use a small accent-colored dot, not checkmarks

**Floating Control Bar showcase**:
- Below the tabbed section, a dedicated callout
- Show the actual floating bar UI at 2x scale
- Label each button/control with subtle annotation lines
- Background: Very subtle gradient from `--color-bg-primary` to `--color-bg-secondary`
- Keep annotations minimal: "Start/Stop", "Pause", "Mic Toggle", "Settings"

**Responsive**:
- Desktop: Side-by-side (screenshot left, text right)
- Tablet: Same layout, tighter spacing
- Mobile: Stack vertically — tabs become horizontally scrollable pills, screenshot above text

---

### Trust / Social Proof Section

**Approach**: No fake testimonials. Use real, verifiable trust signals.

**Trust signals to include**:

1. **macOS Native badge**: "Built with Swift & SwiftUI" with a Swift logo
2. **Version number**: "v1.x — Actively maintained"
3. **Open source indicator** (if applicable): GitHub star count, link to repo
4. **App size**: "4.2 MB download" — reinforces the lightweight message
5. **Privacy statement**: "Zero analytics. Zero tracking. Your recordings never leave your Mac."

**Layout**: A single row of trust badges/pills on desktop, wrapping on mobile.

**Badge styling**:
- Background: `--color-bg-secondary`
- Border: 1px `--color-border-default`
- Border-radius: `--radius-full`
- Padding: `--space-2` vertical, `--space-4` horizontal
- Text: `--text-caption`, `--color-text-secondary`
- Icon: 16px, inline, `--color-text-tertiary`

**No star ratings, no "trusted by X users", no logos of companies.**

---

### Download / CTA Section

**Layout**: Centered, focused. This is the final push — keep it clean.

**Heading**: "Ready to record?" — `--text-h1`, centered
**Subtext**: "Download Nokka and start recording in seconds." — `--text-body-lg`, `--color-text-secondary`

**Download button**: Same styling as hero CTA but larger:
- Height: 56px
- Font size: 18px
- Icon: Download arrow
- Label: "Download for macOS"

**Below button**:
- System requirements in a compact layout:
  ```
  macOS 13 Ventura or later  /  Apple Silicon & Intel  /  4.2 MB
  ```
- Style: `--text-mono`, `--color-text-tertiary`, separated by `/` dividers
- Optional: "Also available on Homebrew: `brew install nokka`" in `--text-mono`

**Visual treatment**:
- A very subtle radial gradient behind the section using `--color-accent-glow`
- No border, no card wrapper — let it breathe

**Responsive**:
- All breakpoints: Centered, single-column. Reduce heading size on mobile.

---

### Footer

**Approach**: Minimal. The footer is not a navigation destination.

**Layout**: Single row on desktop, stacked on mobile.

**Left side**: "Nokka" wordmark + copyright year
**Right side**: Links — GitHub (if open source), Twitter/X, Release Notes, Privacy

**Styling**:
- Background: `--color-bg-primary` (same as page — no visual break)
- Top border: 1px `--color-border-subtle`
- Text: `--text-body-sm`, `--color-text-tertiary`
- Links: `--color-text-secondary`, no underline, underline on hover
- Padding: `--space-8` vertical
- Max-width: Same as page content (1120px)

---

## 3. Responsive Strategy

### Breakpoints

| Token | Value | Target |
|-------|-------|--------|
| `--bp-mobile` | 375px | iPhone SE and up |
| `--bp-tablet` | 768px | iPad portrait |
| `--bp-desktop` | 1024px | Laptop screens |
| `--bp-wide` | 1280px | Desktop monitors |
| `--bp-ultra` | 1440px | Large displays (max content width) |

### Content Width

- Max content width: **1120px**
- Side padding: 16px (mobile), 32px (tablet), 40px (desktop), auto-centered (wide+)

### Key Layout Changes

| Element | Mobile | Tablet | Desktop |
|---------|--------|--------|---------|
| Nav | Horizontal, compact | Full | Full |
| Hero headline | 36px | 44px | 56px |
| Hero image | Full-bleed | Padded | Padded with perspective |
| Value prop cards | 1 column | 3 columns | 3 columns |
| Feature tabs | Scrollable pills | Full bar | Full bar |
| Feature content | Stacked | Side-by-side | Side-by-side |
| Trust badges | Wrap | Single row | Single row |
| Footer | Stacked | Single row | Single row |

### Touch Targets

- Minimum tap target: **44px** height/width
- Minimum spacing between tap targets: **8px**
- CTA buttons: 48px+ height on all breakpoints

---

## 4. Interaction & Animation

### Philosophy

Every animation must answer: "What does this help the user understand?" If the answer is "nothing, it just looks cool" — remove it.

### Scroll Animations

| Element | Animation | Trigger | Duration | Easing |
|---------|-----------|---------|----------|--------|
| Section headings | Fade in + translate Y (12px) | Enter viewport (20% visible) | 400ms | `ease-out` |
| Value prop cards | Fade in + translate Y (16px), staggered 80ms | Enter viewport | 500ms | `ease-out` |
| Feature screenshots | Fade in + scale (0.97 to 1.0) | Tab switch or viewport enter | 300ms | `ease-out` |
| Trust badges | Fade in, staggered 50ms | Enter viewport | 300ms | `ease-out` |
| Hero image | Already visible on load — no entrance animation | N/A | N/A | N/A |

### Hover States

| Element | Hover Effect | Duration |
|---------|-------------|----------|
| CTA buttons | Background color shift + scale(1.02) | 150ms |
| Nav links | Color shift to `--color-text-primary` | 100ms |
| Footer links | Underline appears | 100ms |
| Feature tabs | Background color shift | 100ms |
| Cards | No hover effect (informational, not interactive) | N/A |

### Micro-interactions

- **CTA click**: Scale to 0.98 for 100ms, then release — tactile feel
- **Tab switch**: Active tab background slides (not jumps) to new position, 150ms ease
- **Download button**: On click, icon animates from arrow-down to checkmark (if download initiates)

### Page Load Sequence

1. Nav fades in immediately (0ms)
2. Hero headline fades in (100ms delay, 400ms duration)
3. Hero subheadline fades in (200ms delay, 400ms duration)
4. CTA button fades in (300ms delay, 300ms duration)
5. Hero image fades in (400ms delay, 500ms duration)
6. Everything below the fold: scroll-triggered only

### Reduced Motion

When `prefers-reduced-motion: reduce` is active:
- All animations become instant (0ms duration)
- No translate/scale transforms
- Opacity transitions allowed (200ms max)
- Tab switching is instant

---

## 5. Accessibility Requirements

### Color Contrast

| Combination | Ratio | Requirement |
|-------------|-------|-------------|
| `--color-text-primary` on `--color-bg-primary` | 15.2:1 | WCAG AAA |
| `--color-text-secondary` on `--color-bg-primary` | 6.8:1 | WCAG AA |
| `--color-text-tertiary` on `--color-bg-primary` | 4.5:1 | WCAG AA (large text only) |
| White on `--color-accent` | 4.8:1 | WCAG AA |
| `--color-accent` on `--color-bg-primary` | 4.6:1 | WCAG AA |

*Verify all ratios during implementation. Adjust `--color-text-tertiary` up if needed.*

### Focus States

- All interactive elements must have visible focus indicators
- Focus ring: 2px solid `--color-accent`, offset 2px
- Focus ring on dark backgrounds must be clearly visible
- Tab order follows visual layout order
- Skip-to-content link as first focusable element

### Screen Reader Considerations

- Semantic HTML throughout (`<nav>`, `<main>`, `<section>`, `<footer>`)
- All images have descriptive `alt` text
- Feature tabs use proper `role="tablist"`, `role="tab"`, `role="tabpanel"` with `aria-selected`
- CTA buttons have clear, action-oriented labels (not "Click here")
- Section headings create logical document outline
- Download link indicates file type and size in accessible name

### Keyboard Navigation

- All interactive elements reachable via Tab key
- Feature tabs navigable with arrow keys
- Escape closes any overlay/modal (if added later)
- Enter/Space activates buttons and tabs

---

## 6. Asset Requirements

### Screenshots Needed

1. **Hero screenshot**: Full app in recording mode — floating control bar visible over a desktop, showing region selection or active recording state. 2880x1800 (Retina) minimum.
2. **Full Screen mode**: Screenshot showing the full-screen recording indicator and control bar.
3. **Region Select mode**: Screenshot showing the region selection overlay with drag handles.
4. **Window Capture mode**: Screenshot showing window highlighting during selection.
5. **Floating control bar**: Isolated capture of just the control bar at 2x resolution for the annotated callout.

### Screenshot Guidelines

- Capture on a clean macOS desktop — remove personal files/icons from the dock
- Use a neutral wallpaper (solid dark gray or macOS default dark wallpaper)
- Show realistic content on screen (a code editor, a presentation, documentation)
- Retina resolution (2x) for all captures
- Export as WebP with PNG fallback. Target < 200KB per image after optimization.

### Icons

- Style: SF Symbols-inspired — monoline, 1.5px stroke, rounded caps
- Size: Design at 24px, use at 16px-28px
- Color: Single color (inherit from CSS)
- Needed icons: Key/lock-open, Mac/desktop, Feather, Download arrow, Swift logo, GitHub mark
- Prefer inline SVGs for performance and color control

### No illustrations. No abstract graphics. Real UI only.

---

## 7. Design System Tokens

### Colors

```css
:root {
  /* Backgrounds */
  --color-bg-primary: #0E0E10;
  --color-bg-secondary: #161618;
  --color-bg-tertiary: #1C1C1F;

  /* Borders */
  --color-border-default: #2A2A2E;
  --color-border-subtle: #222225;

  /* Text */
  --color-text-primary: #EDEDEF;
  --color-text-secondary: #A0A0A8;
  --color-text-tertiary: #6B6B73;

  /* Accent */
  --color-accent: #E8442D;
  --color-accent-hover: #F25640;
  --color-accent-subtle: rgba(232, 68, 45, 0.12);
  --color-accent-glow: rgba(232, 68, 45, 0.06);

  /* Semantic */
  --color-success: #34C759;
  --color-warning: #FF9F0A;
  --color-info: #64D2FF;
}
```

### Typography

```css
:root {
  /* Font Families */
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif;
  --font-mono: "SF Mono", SFMono-Regular, ui-monospace, "Cascadia Code", "Fira Code", monospace;

  /* Font Sizes */
  --text-display: 56px;
  --text-h1: 40px;
  --text-h2: 28px;
  --text-h3: 20px;
  --text-body-lg: 18px;
  --text-body: 16px;
  --text-body-sm: 14px;
  --text-caption: 12px;
  --text-mono: 14px;

  /* Font Weights */
  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --weight-bold: 700;

  /* Line Heights */
  --leading-tight: 1.1;
  --leading-snug: 1.2;
  --leading-normal: 1.5;
  --leading-relaxed: 1.6;

  /* Letter Spacing */
  --tracking-tight: -0.03em;
  --tracking-snug: -0.02em;
  --tracking-normal: -0.005em;
  --tracking-wide: 0.01em;
}
```

### Spacing

```css
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;
  --space-32: 128px;
}
```

### Borders & Radius

```css
:root {
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-full: 9999px;

  --border-width: 1px;
  --border-default: 1px solid var(--color-border-default);
  --border-subtle: 1px solid var(--color-border-subtle);
}
```

### Shadows

```css
:root {
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 40px var(--color-accent-glow);
}
```

### Animation

```css
:root {
  /* Durations */
  --duration-fast: 100ms;
  --duration-normal: 150ms;
  --duration-slow: 300ms;
  --duration-entrance: 400ms;
  --duration-stagger: 80ms;

  /* Easings */
  --ease-default: ease-out;
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Transforms */
  --translate-entrance: 12px;
  --translate-card: 16px;
  --scale-hover: 1.02;
  --scale-press: 0.98;
}
```

### Layout

```css
:root {
  --content-max-width: 1120px;
  --nav-height: 56px;
  --nav-blur: 12px;

  --padding-mobile: 16px;
  --padding-tablet: 32px;
  --padding-desktop: 40px;

  --bp-mobile: 375px;
  --bp-tablet: 768px;
  --bp-desktop: 1024px;
  --bp-wide: 1280px;
  --bp-ultra: 1440px;
}
```

---

## Implementation Notes

### Performance Budget

- **First Contentful Paint**: < 1.2s
- **Largest Contentful Paint**: < 2.5s (hero screenshot is the LCP element)
- **Total page weight**: < 800KB (including images)
- **JavaScript**: Minimal — vanilla JS or lightweight framework. No heavy animation libraries.
- **Images**: WebP with `<picture>` fallback to PNG. Use `loading="lazy"` for below-fold images.

### Tech Considerations

- The site is built with Next.js (already configured in the project)
- Use CSS custom properties for all tokens — no CSS-in-JS for design tokens
- Prefer CSS animations over JS animations
- Use `next/image` for optimized image loading
- No external font loading — system fonts only (zero FOUT, zero layout shift)

### Content Principles

- Headlines: Short, declarative, no exclamation marks
- Body text: Conversational but precise. Technical readers respect clarity.
- No buzzwords: "AI-powered", "next-gen", "revolutionary" — none of that
- No pricing section for v1 (free app)
- No comparison tables (confident products don't need them)
