# Design Language

## Reference: The Robin System Panel

The Robin system panel is the definitive reference for the visual language of the entire application. Every workspace, every content type, every component should feel like it belongs in the same family as Robin.

---

## The Vibe

Dark, quiet, precise. Not flashy. Not gamer. Think: a well-lit control room at midnight. Everything is readable, nothing is screaming at you. The primary accent color glows softly against deep blacks and charcoal — like a status indicator on quality hardware. Electric but restrained.

The overall feel is **professional terminal meets modern IDE** — where the darkness serves readability, the accent color serves wayfinding, and white space (or rather, dark space) serves hierarchy.

---

## Color Foundation

### The Primary: Electric Sky Blue

```
#4fc3f7 — rgb(79, 195, 247)
```

This is the signature. Cool, electric, immediately recognizable but not fatiguing. It works across every context:
- Bold enough to be a title color against black
- Translucent enough at 12% opacity to be a card fill
- Subtle enough at 5% opacity to be a hover state

### Opacity Scale (for primary accent)

These ratios are the design system. They create visual hierarchy from a single color:

| Token | Opacity | Use | Example |
|-------|---------|-----|---------|
| `primary-ghost` | 0.03-0.05 | Barely-there hover, inactive surface | Hover state on guide link |
| `primary-fill` | 0.08 | Icon button hover, faint active | Robin icon hover |
| `primary-dim` | 0.12 | User chat bubble, active tab fill, badge bg | Active pill tab, user message |
| `primary-border` | 0.25 | Active borders, focused input, subtle outline | Active card border, input focus |
| `primary-solid` | 1.0 | Text, icons, toggle-on, headings | Tab label, section title, toggle |

This same scale applies regardless of what the primary color is. Change the hue, keep the ratios.

### Background Scale

Five shades of dark, each with a purpose:

| Token | Hex | Use |
|-------|-----|-----|
| `bg-void` | #0a0a0a | Page background, deepest layer |
| `bg-inset` | #0d0d0d | Input fields, recessed areas |
| `bg-base` | #111111 | Chat panel, sidebar backgrounds |
| `bg-card` | #161616 | Cards, bubbles, code blocks, elevated surfaces |
| `bg-hover` | #1c1c1c | Card hover state |

The progression is subtle — each step is only a few shades lighter. This creates depth without contrast shock. Nothing is bright. The darkest surface is where you spend the most time looking.

### Border Scale

Two border values, used everywhere:

| Token | Hex | Use |
|-------|-----|-----|
| `border-subtle` | #1e1e1e | Major section dividers, panel borders |
| `border-default` | #282828 | Card borders, input borders, inactive outlines |

Borders are structural, not decorative. They define edges without drawing attention.

### Text Scale

Three levels. Never more.

| Token | Hex | Use |
|-------|-----|-----|
| `text-primary` | #e0e0e0 | Headings, names, primary content |
| `text-secondary` | #aaaaaa | Body text, descriptions, paragraph content |
| `text-dim` | #666666 | Labels, placeholders, section dividers, metadata |

Body text is NOT white. It's `#aaa` — warm enough to read comfortably, dim enough to let headings and accents stand out. Only `text-primary` gets close to white, and it's still not `#fff`.

### Semantic Colors

These are exceptions to the primary color rule. Used sparingly:

| Token | Hex | Use |
|-------|-----|-----|
| `status-on` | #4caf50 | Active/enabled badges, success |
| `status-off` | #666666 | Disabled badges, inactive |
| `status-error` | #f44336 | Error states (rare) |
| `status-warn` | #ff9800 | Warnings (rare) |

These appear only in badges and status indicators. They never style backgrounds, borders, or large surfaces.

---

## Workspace Accent Palette

Colors available for workspace customization. All in the same "electric but not garish" family as the primary blue. Cool-toned, luminous, comfortable against dark backgrounds.

| Name | Hex | RGB | Vibe |
|------|-----|-----|------|
| Sky | #4fc3f7 | 79, 195, 247 | The default. Electric sky blue. Robin's color. |
| Teal | #4dd0c7 | 77, 208, 199 | Cool mint. Calming, technical. |
| Lavender | #9fa8da | 159, 168, 218 | Soft indigo-violet. Gentle, distinctive. |
| Sage | #81c784 | 129, 199, 132 | Muted green. Natural, easy on eyes. |
| Peach | #f0a07a | 240, 160, 122 | Warm coral, not hot. Approachable. |
| Steel | #90a4ae | 144, 164, 174 | Blue-grey. Minimal, industrial. |
| Lilac | #b39ddb | 179, 157, 219 | Soft purple. Distinctive without being loud. |
| Ice | #80deea | 128, 222, 234 | Bright cyan. Close to the default but greener. |

**What's NOT in this palette:**
- Hot pink (#ec4899) — too aggressive, fatiguing
- Mustard yellow (#facc15) — too warm, clashes with the dark background
- Neon green — gamer aesthetic, not this
- Pure red — reads as error, not accent

Every color in this palette passes the Robin test: swap it into `--robin-primary` and everything still looks cohesive. The opacity scale (0.05, 0.08, 0.12, 0.25, 1.0) produces natural-looking fills and borders regardless of the hue.

---

## Component Patterns

### Cards

The fundamental surface unit. Used for: settings items, agent tiles, chat bubbles, detail meta strips, registry items.

```
Background: var(--bg-card)         #161616
Border: 1px solid var(--border-default)   #282828
Border radius: 10px
Padding: 10px 12px (compact) or 16px (spacious)
Hover: border-color → primary at 0.25
Active: border-color → primary at 1.0, bg → primary at 0.05
```

Cards have a **single border radius** across the app: `10px`. Not 4px (too sharp), not 16px (too bubbly). 10px reads as modern without being playful.

### Chat Bubbles

**User bubble:** Card with primary-dim fill and primary-border outline. Right-aligned.
```
Background: rgba(primary-rgb, 0.12)
Border: 1px solid rgba(primary-rgb, 0.25)
Border radius: 10px
```

**Assistant bubble:** Card background, default border. Left-aligned.
```
Background: var(--bg-card)   #161616
Border: 1px solid var(--border-default)   #282828
```

The user's bubble catches your eye because of the accent fill. The assistant's bubble recedes because it matches the surface. This creates natural reading flow.

### Pill Tabs

```
Inactive: bg white 0.03, border #282828, text #666
Hover: bg white 0.06, text #aaa
Active: bg primary 0.12, border primary 0.25, text primary, font-weight 600
Border radius: 20px (full pill)
Padding: 6px 16px
Icon + label, gap 6px
```

### Section Dividers

```
Font size: 0.625rem (10px)
Weight: 600
Transform: uppercase
Letter spacing: 0.08em
Color: var(--text-dim)
Padding: 8px 4px
```

Small, uppercase, dimmed. They organize without interrupting.

### Separators / Lines

```
Height: 1px
Color: var(--border-subtle) for major divisions
Color: rgba(primary-rgb, 0.15) for within-context divisions
```

### Typography

| Context | Size | Weight | Color |
|---------|------|--------|-------|
| Page title | 1.5rem (24px) | 700 | text-primary |
| Section title | 1.25rem (20px) | 700 | primary |
| Card name | 0.8125rem (13px) | 600 | text-primary |
| Body text | 0.8125rem (13px) | 400 | text-secondary |
| Description | 0.6875rem (11px) | 400 | text-dim |
| Badge | 0.5625rem (9px) | 600 | varies |
| Section divider | 0.625rem (10px) | 600 | text-dim |

Font: system font (`font-family: inherit`). Monospace for code: `'SF Mono', 'Fira Code', monospace`.

### Code Inline

```
Background: rgba(255, 255, 255, 0.06)
Padding: 2px 6px
Border radius: 3px
Font size: 0.75rem
Color: var(--primary) for accent, var(--text-secondary) for neutral
```

### Code Blocks

```
Background: var(--bg-card)
Border: 1px solid var(--border-default)
Border radius: 6px
Padding: 16px
Font size: 0.75rem
Color: var(--text-secondary)
Line height: 1.6
Overflow-x: auto
```

### Transitions

Everything animates at **150ms**. No variation. Fast enough to feel immediate, slow enough to be perceived.

```
transition: all 150ms;
```

The one exception: the overlay slide-in animation at **250ms ease-out**.

### Related Links / Tags

Pill-shaped link buttons:
```
Background: rgba(primary-rgb, 0.12)
Border: 1px solid rgba(primary-rgb, 0.25)
Border radius: 14px
Padding: 4px 12px
Font size: 0.75rem
Color: primary
Hover: bg → primary at 0.18
```

---

## What Makes Robin Feel Right

1. **Consistent opacity language.** 0.12 means "active fill" everywhere — tabs, bubbles, badges. 0.25 means "active border" everywhere. You learn the visual vocabulary once.

2. **No competing colors.** One accent color does all the work. Status colors (green/red) appear only on tiny badges. Everything else is shades of the primary against shades of black.

3. **Depth through shade, not shadow.** The background scale (#0a → #0d → #11 → #16 → #1c) creates layering without drop shadows. Surfaces are distinguished by darkness, not by floating.

4. **Text hierarchy through value, not size.** #e0e0e0 → #aaa → #666 creates three clear levels. You don't need giant headings when the brightness does the work.

5. **Cards are the universal container.** Everything is a card — chat bubbles, settings items, meta strips, code blocks. Same border radius, same border color, same hover behavior. This repetition is calming, not boring.

6. **Accent on interaction, not decoration.** The primary color appears when you hover, when something is active, when something is clickable. It never appears just to be pretty. This means every touch of blue is meaningful.

---

## Anti-Patterns

- **Hot, saturated accents** (hot pink, mustard, neon green) — these fatigue the eye and fight the dark background
- **Multiple accent colors on one screen** — the current per-panel theming (pink wiki, cyan code, yellow issues) breaks the calm; one color at a time
- **White text (#ffffff)** — too harsh. #e0e0e0 is the ceiling
- **Large colored surfaces** — accent color never fills more than a badge or bubble. It tints at 5-12% opacity
- **Inconsistent border radius** — everything is 10px cards, 20px pills, or 3px code. No 4px, no 8px, no 12px
- **Decorative borders** — borders are structural (separating regions) or interactive (hover/active states). Never ornamental
- **Shadows** — depth comes from shade differences, not box-shadow. The rare exception is modals/overlays
- **Multiple transition speeds** — 150ms for everything. Don't overthink it
