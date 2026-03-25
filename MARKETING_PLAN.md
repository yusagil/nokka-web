# Nokka — Website Marketing Plan

---

## 1. Emotional & Cognitive Triggers Analysis

### 1.1 Ownership Psychology (Endowment Effect + Loss Aversion)

**The Core Insight:** When you attend a meeting, give a presentation, or walk someone through a process on screen — that's *your* work, *your* knowledge, *your* moment. But the recording? It lives on Zoom's servers, behind Teams' admin panel, in someone else's Loom workspace. You participated, but you don't own it.

**Psychological Mechanisms:**
- **Endowment Effect:** People value things more when they feel ownership. A recording on your Mac feels like *yours*. A recording in Zoom's cloud feels like *theirs*.
- **Loss Aversion:** The fear of losing access to something you contributed to is stronger than the joy of having it. "What if they delete the workspace?" "What if my account expires?"
- **Control Bias:** Local files = permanent access. No subscription expiry, no platform shutdown, no admin revoking access.

**Messaging Angle:** Frame Nokka as *reclaiming* what's already yours. Not adding something new — *taking back* what platforms have been keeping from you.

---

### 1.2 Control & Autonomy (Self-Determination Theory)

**The Core Insight:** Existing tools decide what gets recorded. Zoom records the whole call. QuickTime records the whole screen. OBS requires a PhD in configuration. Users want *surgical precision* — record exactly this window, exactly this region, nothing more.

**Psychological Mechanisms:**
- **Autonomy Need:** SDT's strongest motivator. People are more satisfied when they feel in control of their environment.
- **Competence Satisfaction:** Being able to precisely define a recording area feels competent and intentional, not accidental.
- **Intrinsic Motivation:** When tools respect your intent, you actually *want* to use them.

**Messaging Angle:** Position recording modes as *respecting your intent*. You decide what matters. The tool obeys.

---

### 1.3 Multitasking Freedom

**The Core Insight:** Recording shouldn't be a full-screen commitment. People want to capture a specific window while checking Slack, writing notes, or browsing documentation. Current tools either lock your screen or record everything including the mess.

**Psychological Mechanisms:**
- **Flow State Protection:** Interrupting workflow to manage recordings breaks deep work.
- **Cognitive Bandwidth:** If recording requires attention, it competes with the actual task.

**Messaging Angle:** "Record and forget." Set it, continue working, stop when done.

---

### 1.4 Simplicity Bias (Cognitive Load Reduction)

**The Core Insight:** OBS has 47 settings panels. Loom requires a browser extension + account + login. QuickTime needs you to hunt through File menus. People want: click, record, done.

**Psychological Mechanisms:**
- **Paradox of Choice:** More options = more anxiety = less action.
- **Hick's Law:** Decision time increases logarithmically with the number of choices.
- **Default Effect:** People stick with the easiest path. Make recording the easiest thing on their Mac.

**Messaging Angle:** Zero learning curve. If you can click a menu bar icon, you can use Nokka.

---

### 1.5 Privacy & Security (Local-First)

**The Core Insight:** Screen recordings often contain sensitive information — credentials visible in terminals, private Slack messages, financial dashboards, personal browsing. Uploading these to cloud services is an invisible risk most people ignore until it's too late.

**Psychological Mechanisms:**
- **Privacy Calculus:** People weigh convenience against privacy risk. Local-only recording removes the trade-off entirely.
- **Trust Asymmetry:** Users inherently trust their own machine more than any cloud service.

**Messaging Angle:** Your recordings never leave your Mac. No uploads, no servers, no "oops."

---

### 1.6 Speed & Efficiency (Instant Access)

**The Core Insight:** The best recording is the one you actually make. If it takes more than 3 seconds to start, you'll say "I'll record the next one" — and you never do.

**Psychological Mechanisms:**
- **Friction Cost:** Every extra click or second of setup exponentially decreases the likelihood of action.
- **Present Bias:** People disproportionately value immediate payoff. Instant recording start = immediate reward.

**Messaging Angle:** Lives in your menu bar. One click or one shortcut. Recording in under 2 seconds.

---

## 2. Target Personas

### Persona 1: "The Knowledge Worker" — Alex, 32, Product Manager

**Context:** Attends 4-6 video calls daily across Zoom, Google Meet, and Teams. Frequently needs to reference what was discussed but can't always get the official recording. Sometimes the host doesn't record. Sometimes the recording expires.

**Pain Points:**
- "The meeting recording belongs to whoever hosted it, not me"
- "I want my own copy of calls I participated in"
- "I need to capture just the presentation, not my entire screen with Slack notifications"
- "Loom is great for sharing but I don't always want things in the cloud"

**Emotional Triggers:** Ownership, privacy, autonomy
**Decision Driver:** "Can I own my recordings locally and record just what I need?"
**Objections:** "Is the quality good enough?" / "Will it slow down my Mac during calls?"

---

### Persona 2: "The Creator" — Maya, 27, Developer Advocate / Content Creator

**Context:** Records tutorials, code walkthroughs, and demo videos regularly. Currently juggles OBS (too complex for quick recordings) and QuickTime (too basic — no system audio, no region select).

**Pain Points:**
- "OBS is overkill when I just want to record a terminal window"
- "QuickTime can't capture system audio without hacks"
- "I need to record a specific region for social media aspect ratios"
- "I want to pause mid-recording when I get interrupted"

**Emotional Triggers:** Control, simplicity, competence
**Decision Driver:** "Can I get exactly the recording I want without fighting the tool?"
**Objections:** "Can it capture system audio natively?" / "What about output quality/format?"

---

### Persona 3: "The Async Communicator" — Jordan, 38, Remote Engineering Lead

**Context:** Leads a distributed team across time zones. Uses screen recordings instead of meetings whenever possible. Needs quick, no-fuss recordings to explain code reviews, architecture decisions, and bug reproductions.

**Pain Points:**
- "Loom is heavy and requires me to be online"
- "I just want to record my IDE window and talk over it"
- "I don't want to create accounts or manage cloud storage for internal recordings"
- "I need to record one window while I reference another"

**Emotional Triggers:** Efficiency, simplicity, multitasking freedom
**Decision Driver:** "Can I start recording in 2 seconds and share the file directly?"
**Objections:** "File sizes?" / "Can teammates on other platforms play the output?"

---

### Persona 4: "The Privacy-Conscious Professional" — Sam, 45, Freelance Consultant

**Context:** Works with multiple clients, often handling sensitive financial data, contracts, and credentials on screen. Needs to record sessions for documentation but can't risk screen content being uploaded to third-party servers.

**Pain Points:**
- "I can't use cloud-based recording tools with client data on screen"
- "I need recordings that stay on my machine, period"
- "I want something native that doesn't feel like a security liability"

**Emotional Triggers:** Privacy, trust, professional responsibility
**Decision Driver:** "Does this tool guarantee my recordings stay local?"
**Objections:** "Is it really fully offline?" / "Any analytics/telemetry?"

---

## 3. Website Information Architecture

**Format:** Single-page landing page, vertical scroll, progressive disclosure.

```
┌─────────────────────────────────────────────┐
│  NAVIGATION BAR                             │
│  Logo | Features | Download | GitHub(?)     │
├─────────────────────────────────────────────┤
│                                             │
│  HERO SECTION                               │
│  Headline + Subheadline + Primary CTA       │
│  Hero visual: App in action (menu bar +     │
│  floating control bar + region selection)    │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  PROBLEM SECTION                            │
│  "The recording problem" — emotional pain   │
│  points framed as shared frustrations       │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  SOLUTION SECTION                           │
│  3 pillars: Own it / Control it / Forget it │
│  Each with icon + short copy + visual       │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  RECORDING MODES                            │
│  Interactive showcase of 3 modes:           │
│  Full Screen | Region | Window              │
│  With animated demos or screenshots         │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  FEATURES GRID                              │
│  6-8 features in compact cards:             │
│  System audio, Pause/Resume, Shortcuts,     │
│  Countdown, H.264, Menu bar, etc.           │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  "WHY NOT..." SECTION                       │
│  Honest comparison vs alternatives          │
│  Not a table — conversational format        │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  TRUST / TECHNICAL DETAILS                  │
│  Native SwiftUI, ScreenCaptureKit,          │
│  local-only, no telemetry, lightweight      │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  DOWNLOAD SECTION                           │
│  Big CTA, system requirements,              │
│  "Free" badge, DMG download                 │
│                                             │
├─────────────────────────────────────────────┤
│                                             │
│  FOOTER                                     │
│  Made by [name] | GitHub | Contact          │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 4. Copy Direction

### 4.1 Hero Section

**Headlines (pick one):**

1. **"Your screen. Your recording. Your Mac."**
2. **"Record exactly what you want. Keep it forever."**
3. **"Screen recording that stays on your Mac."**

**Subheadline:**
"A lightweight, native macOS screen recorder. Full screen, specific window, or custom region — with system audio, pause/resume, and zero cloud dependency. Just press ⌘⇧R."

**CTA:** "Download for macOS" (with "Free" badge next to it)

**Emotional Trigger:** Ownership + Simplicity + Speed

**Notes:** The hero visual should show the menu bar icon expanded, with the floating control bar visible over a blurred desktop. The feel should be: clean, native, *belongs on your Mac*.

---

### 4.2 Problem Section

**Headlines:**

1. **"You were in that meeting. Why can't you have the recording?"**
2. **"Your recordings shouldn't live on someone else's server."**
3. **"Screen recording on Mac shouldn't be this hard."**

**Body Copy Direction:**
Frame as three relatable frustrations. Keep it conversational, second-person, present tense. No corporate speak.

**Frustration 1 — Ownership:**
"You spent an hour in that meeting. You presented. You contributed. But the recording? It's in the host's Zoom account. Or buried in Teams admin storage. Maybe they'll share it. Maybe they won't. Maybe it expires in 30 days. Your work, their recording."

**Frustration 2 — Control:**
"You want to record your IDE, not your entire desktop with Slack DMs and personal tabs visible. QuickTime gives you the whole screen or nothing. OBS gives you 47 menus to figure out first. You just want to draw a rectangle around what matters."

**Frustration 3 — Simplicity:**
"You open the recording app. It wants you to sign in. Create a workspace. Choose a plan. Connect your calendar. All you wanted was to hit record."

**Emotional Trigger:** Loss Aversion, Frustration, Autonomy

---

### 4.3 Solution Section — Three Pillars

**Structure:** Three columns, each with an icon, headline, and 2-3 sentences.

#### Pillar 1: "Own It"

**Headlines:**
1. "Your recordings. On your Mac. Period."
2. "Recordings that belong to you."
3. "Local files. No expiry date."

**Body:** "Every recording saves directly to your Mac as an MP4. No cloud uploads, no account required, no platform that can revoke access. You participated in it — you should own it."

**Emotional Trigger:** Ownership Psychology, Loss Aversion

#### Pillar 2: "Control It"

**Headlines:**
1. "Record exactly what matters."
2. "Full screen, one window, or just a region."
3. "Surgical precision. Zero waste."

**Body:** "Choose your recording mode: the full screen, a specific window (works across Spaces and fullscreen apps), or drag to select any region. Record what you intend to. Nothing more."

**Emotional Trigger:** Autonomy, Competence

#### Pillar 3: "Forget It"

**Headlines:**
1. "Hit record. Keep working."
2. "Recording that stays out of your way."
3. "Set it and forget it."

**Body:** "Nokka records in the background with a minimal floating bar. Switch apps, browse docs, write code — the recording captures exactly what you told it to, while you do everything else."

**Emotional Trigger:** Multitasking Freedom, Flow Protection

---

### 4.4 Recording Modes Section

**Section Headline:** "Three ways to capture"

**Mode 1 — Full Screen**
- Headline: "Everything. All of it."
- Copy: "One click captures your entire display. Simple as it gets."

**Mode 2 — Region Selection**
- Headline: "Draw a rectangle. Record what's inside."
- Copy: "Click and drag to define your recording area. Resize with handles. Perfect for tutorials, specific app sections, or social media dimensions."

**Mode 3 — Window Capture**
- Headline: "Pick a window. Any window."
- Copy: "Select a specific application window — even if it's in another Space or running fullscreen. Record that app while you work in another."

**Emotional Trigger:** Control, Autonomy, Competence

**Visual Direction:** Each mode should have a small animated demo or annotated screenshot showing the interaction.

---

### 4.5 Features Grid

**Section Headline:** "Everything you need. Nothing you don't."

| Feature | Copy |
|---------|------|
| **System Audio + Mic** | "Capture system sound and your microphone on separate tracks. Record what you hear and what you say." |
| **Pause & Resume** | "Life interrupts. Pause your recording, handle it, pick up exactly where you left off." |
| **Global Shortcuts** | "⌘⇧R to record. ⌘⇧P to pause. ⌘⇧M for mic. Works from anywhere, no window switching." |
| **Menu Bar App** | "Lives in your menu bar. Click to start. No dock icon, no window clutter, no setup ritual." |
| **Floating Control Bar** | "A minimal pill-shaped bar stays visible during recording. Minimizable when you don't need it." |
| **Countdown Timer** | "Configurable countdown before recording starts. Enough time to switch to the right app." |
| **H.264 Hardware Acceleration** | "Hardware-accelerated MP4 encoding. Smooth recording without taxing your CPU." |
| **macOS Native** | "Built with SwiftUI and ScreenCaptureKit. No Electron, no web wrapper. Feels like it belongs on your Mac." |

**Emotional Trigger per feature:** Each feature card subtly reinforces simplicity, control, or performance.

---

### 4.6 "Why Not..." Section

**Section Headline:** "You've tried the others."

**Tone:** Honest, not snarky. Acknowledge that alternatives exist and are good at what they do. Position Nokka as the right tool for a specific job.

**vs. Loom:**
"Loom is great for sharing recordings with a team. But it requires an account, uploads everything to the cloud, and you can't pause mid-recording. If you want local files and more recording control, Nokka is simpler."

**vs. OBS:**
"OBS is a professional broadcasting tool. It can do almost anything — if you're willing to learn it. For quick screen recordings on your Mac, it's like driving a semi truck to the grocery store."

**vs. QuickTime:**
"QuickTime is built in and free. But it can't record system audio without workarounds, doesn't support region selection, and the controls are buried in File menus. It works until it doesn't."

**vs. macOS Built-in (⌘⇧5):**
"The built-in toolbar is convenient but limited. No system audio capture, basic controls, no pause/resume. Fine for a quick screenshot. Not enough for real recording work."

**vs. CleanShot X:**
"CleanShot excels at screenshots and quick clips. If you need focused screen recording with system audio, window capture across Spaces, and pause/resume — that's Nokka's territory."

**Emotional Trigger:** Social proof by differentiation. Validates user's past experience. Positions Nokka in a clear lane.

---

### 4.7 Trust / Technical Details Section

**Section Headline:** "Built for your Mac. Runs on your Mac. Stays on your Mac."

**Copy Direction:**

"Nokka is a native macOS app built with SwiftUI and Apple's ScreenCaptureKit framework. It uses hardware-accelerated H.264 encoding, runs lean, and stores recordings locally as standard MP4 files.

No Electron. No embedded browser. No telemetry. No cloud. No account.

Requires macOS 14 (Sonoma) or later."

**Emotional Trigger:** Trust, Privacy, Technical Credibility

---

### 4.8 Download Section

**Headlines:**
1. "Ready when you are."
2. "Download. Record. Own it."
3. "One file. No installer drama."

**CTA Button:** "Download Nokka" (with "Free · macOS 14+" underneath)

**Supporting Copy:** "Direct DMG download. Drag to Applications. Done."

**System Requirements (small text):**
- macOS 14 (Sonoma) or later
- Apple Silicon or Intel Mac
- Screen Recording permission required

**Emotional Trigger:** Speed, Simplicity, Zero Friction

---

### 4.9 Footer

**Content:**
- "Made by [Your Name]"
- Link to GitHub (if open source)
- Contact / feedback email
- "Built with SwiftUI in [City]"

**Tone:** Personal, indie dev. Not a corporation.

---

## 5. Conversion Strategy

### 5.1 Primary CTA: DMG Download

**Placement:**
- Hero section (above the fold)
- Sticky nav bar (always visible on scroll)
- Bottom of features section
- Dedicated download section near footer

**Button Design:**
- High contrast, rounded, macOS-native feel
- Text: "Download for macOS" or "Download Nokka"
- Sub-label: "Free · macOS 14+"
- Optional: Small download size indicator (e.g., "12 MB") to reinforce lightweight nature

---

### 5.2 Trust Building Elements

| Element | Purpose | Placement |
|---------|---------|-----------|
| **"Free" badge** | Remove price objection entirely | Hero, Download section |
| **"No account required"** | Remove signup friction | Problem section, Features |
| **"No cloud, no uploads"** | Privacy assurance | Solution pillars, Tech section |
| **Native tech stack callout** | Technical credibility | Tech section |
| **DMG file size** | "This is lightweight" proof | Download button area |
| **macOS native visual design** | "This belongs on your Mac" feel | Entire site design |
| **Open source badge** (if applicable) | Maximum transparency | Nav, Footer |
| **Honest competitor comparison** | "We're not hiding anything" | Why Not section |

---

### 5.3 Objection Handling

| Objection | Response (embedded in page) | Location |
|-----------|---------------------------|----------|
| "Is it really free?" | "Free" badge prominently displayed, no pricing section tricks | Hero, Download |
| "Will it slow my Mac?" | "Hardware-accelerated H.264 encoding" feature card | Features grid |
| "Is the quality good?" | "MP4 with H.264" + mention hardware acceleration | Features, Tech |
| "Can it capture system audio?" | Explicit feature card: "System audio + Mic, separate tracks" | Features grid |
| "Is it safe / private?" | "No telemetry, no cloud, no account" in tech section | Tech section |
| "Why not just use QuickTime?" | Honest comparison in "Why Not" section | Comparison section |
| "Will it work on my Mac?" | Clear system requirements: macOS 14+, Apple Silicon/Intel | Download section |
| "What format are recordings?" | "Standard MP4 files" — plays everywhere | Features grid |

---

### 5.4 Micro-Interactions & Engagement

- **Animated recording mode demos:** Short looping animations showing each mode in action (region drag, window pick, full screen). Lets visitors "see" the product without downloading.
- **Keyboard shortcut highlight:** When the shortcut section scrolls into view, briefly flash the key combo visually. Reinforces "this is fast."
- **Scroll progress indicator:** Subtle bar showing page progress. Reduces "how long is this page" anxiety.
- **Download button state:** On hover, show a subtle animation (e.g., arrow pointing down) and display file size. On click, show download progress or "Opening..." feedback.
- **Dark/Light mode:** Match system preference. Reinforces "this app respects your Mac setup."

---

## 6. SEO & Positioning

### 6.1 Primary Keywords

| Keyword | Search Intent | Priority |
|---------|--------------|----------|
| mac screen recorder | Discovery | High |
| macos screen recording app | Discovery | High |
| screen recorder for mac | Discovery | High |
| record screen on mac with audio | Feature-specific | High |
| mac screen recorder with system audio | Feature-specific | High |
| native mac screen recorder | Differentiator | Medium |

### 6.2 Long-Tail Keywords

| Keyword | Intent |
|---------|--------|
| record specific window on mac | Window capture mode |
| screen recorder mac no cloud | Privacy-focused |
| lightweight screen recorder macos | Performance-focused |
| record region of screen mac | Region capture mode |
| mac screen recorder with pause resume | Feature-specific |
| screen recorder macos no account | Friction-free |
| record mac screen without quicktime | Alternative seeking |
| free native mac screen recorder | Discovery + price |
| screen recorder with system audio macos sonoma | Version-specific |
| record one window while using another mac | Multitasking use case |
| own your meeting recordings | Pain point-driven |
| local screen recording mac no upload | Privacy use case |

### 6.3 Positioning Statement

**For** Mac users who record their screen regularly,
**who are frustrated by** cloud-dependent tools, overly complex setups, and not owning their recordings,
**Nokka is** a native macOS screen recorder
**that** lets you capture your full screen, a specific window, or any region — with system audio — and saves everything locally as MP4.
**Unlike** Loom, OBS, or QuickTime,
**Nokka** is lightweight, instant, and keeps your recordings on your Mac where they belong.

### 6.4 Meta Description (for homepage)

"Nokka is a free, native macOS screen recorder. Record your full screen, a specific window, or any region with system audio. Local MP4 files. No account, no cloud, no complexity."

### 6.5 Page Title

"Nokka — Screen Recording for Mac. Local. Native. Yours."

---

## 7. Design & Tone Guidelines

### Visual Direction
- **Color palette:** Muted, macOS-native feel. Think Raycast or Linear — dark mode default, clean typography, generous whitespace.
- **Typography:** System font stack (SF Pro or similar). No playful fonts. Professional but not corporate.
- **Imagery:** App screenshots in context (real desktop, real apps visible). No stock photos. No abstract illustrations.
- **Layout:** Single column, generous spacing, no sidebar. Mobile-responsive but desktop-first (it's a Mac app).

### Tone of Voice
- **Confident but not arrogant.** We know what Nokka does well and what it doesn't try to do.
- **Specific, not vague.** "Records MP4 with H.264 hardware acceleration" not "high quality recording."
- **Conversational, not casual.** Write like you're explaining to a smart colleague, not a marketing audience.
- **Honest about trade-offs.** If QuickTime is good enough for someone, say so. Respect builds trust.
- **Indie developer voice.** One person (or small team) built this because they needed it. That authenticity is a feature.

### What to Avoid
- "Revolutionary" / "Game-changing" / "Best-in-class"
- Excessive exclamation marks
- Vague benefit claims without specifics
- Stock photography of people pointing at screens
- Feature comparison tables that unfairly trash competitors
- Any copy that sounds like it was generated by a marketing team at a Series B startup

---

## 8. Implementation Priority

### Phase 1 — Launch MVP
1. Hero section with headline + CTA
2. Three-pillar solution section (Own / Control / Forget)
3. Recording modes with static screenshots
4. Features grid
5. Download section with DMG link
6. Footer

### Phase 2 — Enhancement
1. Problem section with emotional copy
2. "Why Not..." competitor comparison
3. Animated recording mode demos
4. Trust/technical details section
5. SEO optimization (meta tags, structured data, OG images)

### Phase 3 — Growth
1. Blog / changelog for SEO content
2. Product Hunt launch page integration
3. Social proof (testimonials, usage stats, GitHub stars)
4. Localization (Korean version given founder's background)
5. Video demo embedded in hero

---

*This plan prioritizes authentic messaging rooted in real pain points. The website should feel like a tool page built by someone who uses it daily — because it is.*
