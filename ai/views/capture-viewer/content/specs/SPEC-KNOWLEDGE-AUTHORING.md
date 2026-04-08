# Knowledge Authoring Specification

## Overview

Every system wiki page has two audiences: the human reading the guide, and the AI answering questions about it. This spec defines how to write for both — what goes in `content` (human-facing), what goes in `context` (AI-facing), and the principles that make both effective.

The goal is not to create an encyclopedia. The goal is to give the AI the structural knowledge it needs to investigate on the fly and the human the understanding they need to not get confused in the first place.

---

## The Two Fields

Every `system_wiki` row has:

| Field | Audience | Purpose |
|-------|----------|---------|
| `content` | Human | What the user reads in the guide panel. Markdown. Explains concepts, answers common questions, maps where confusion lives. |
| `context` | AI (Robin) | What Robin retrieves when she needs to answer a question. Compressed, keyword-rich, action-oriented. Not injected into every message — read on demand via tools. |

These are NOT the same text reformatted. They serve different purposes and are written with different constraints.

---

## Writing the Human Content

### Structure

Every page follows this skeleton:

```markdown
## What is {thing}?
One paragraph. No jargon. A person who has never seen this before 
should understand what it is and why it exists.

## How does it work?
The mental model. Not implementation details — the conceptual 
framework. "Think of it as..."

## Common questions
2-4 questions a new user would ask. Direct answers.

---

## Where Confusion Lives

### {Confusion Pattern Name}
What the confusion is, why it happens, and the structural pattern 
underneath it. Not the specific values (those change) — the shape 
of the problem (that doesn't).

**The pattern:** One sentence describing the general form of this 
confusion that applies across providers, versions, and time.
```

### Principles

1. **Explain the shape, not the specifics.** "Providers have two endpoints" is evergreen. "Kimi's endpoint is api.kimi.com" is not. The shape stays true even when the details change.

2. **Name the confusion, not just the feature.** Don't just say "here's how auth works." Say "here's where auth breaks down and why." Users don't read docs when things work — they read them when they're stuck.

3. **Patterns over examples.** "**The pattern:** User has Provider X's key and tries it in CLI Y" teaches the reader to recognize the problem in any context. A specific example teaches them to solve one case.

4. **No hardcoded values.** No endpoint URLs, no pricing, no version numbers, no model names in the guide text. These go stale. If a specific value is essential, frame it as "check the provider's current documentation for the exact endpoint."

5. **Short sections.** Each confusion pattern is 2-3 paragraphs max. If it needs more, it's two patterns.

---

## Writing the AI Context

### Structure

Every context field follows this skeleton:

```
{Thing} = {one-line definition with key terms}.

STRUCTURAL CONFUSION POINTS (these don't change even when specifics do):

1. {PATTERN NAME}: {What it is}. {Why users hit it}. {What to check first}.

2. {PATTERN NAME}: ...

INVESTIGATION PLAYBOOK (when a user has problems):
- First: {triage question}
- Second: {narrowing question}
- Third: {diagnostic check}
- Search: "{search pattern 1}", "{search pattern 2}"
- Check: {where to verify}
- Verify: {what to confirm}

WHAT NOT TO DO: {Anti-patterns — things Robin should never do when 
answering about this topic}
```

### Principles

1. **Confusion points are numbered.** Robin can reference them: "This sounds like confusion point #1 — the two-endpoint problem."

2. **Search patterns are explicit.** Robin doesn't have to figure out what to Google. The context tells her: search for "{provider} {cli} setup guide". These patterns work across providers because they use placeholders.

3. **Investigation is sequential.** The playbook is ordered — triage first, then narrow, then diagnose. Robin follows the sequence rather than jumping to conclusions.

4. **Anti-patterns are stated.** "Don't recite endpoint URLs from memory" is as important as "search for the current one." Without the anti-pattern, Robin will confidently give a stale answer.

5. **No prose.** The context field is not a paragraph. It's a compressed reference card. Sentence fragments are fine. Abbreviations are fine. The AI doesn't need grammatical prose — it needs actionable signals.

6. **Keywords for retrieval.** The context should contain the terms a user would use when asking about this topic, even if those aren't the technically correct terms. If users say "API key" when they mean "access token," both terms should appear in the context.

---

## The Confusion Map Pattern

This is the core authoring technique. Both the human content and the AI context are organized around **where confusion lives**, not around features.

### Why

Features don't confuse people. The gaps between features confuse people. The difference between two endpoints confuses people. The mismatch between a marketing name and an API identifier confuses people. The fact that an API key from one dashboard doesn't work on another dashboard confuses people.

If the wiki only describes features, Robin can only answer "how does X work?" If the wiki maps confusion, Robin can answer "why isn't X working?" — which is the question people actually ask.

### How to Find Confusion Points

Ask these questions about any topic:

1. **What do users assume that isn't true?** (e.g., "any API key works in any CLI")
2. **What looks the same but is different?** (e.g., two endpoints with similar URLs)
3. **What has the same name but different behavior?** (e.g., model name vs marketing name)
4. **What works in one context but not another?** (e.g., CLI harness compatibility)
5. **What changes frequently enough to make cached knowledge dangerous?** (e.g., pricing)

Each answer is a confusion pattern. Name it, describe the shape, write the investigation steps.

---

## The Investigation Playbook Pattern

Every context field ends with an investigation playbook. This is Robin's checklist for when a user has a problem.

### Structure

```
INVESTIGATION PLAYBOOK (when a user has {topic} problems):
- First: {broadest triage question — which category?}
- Second: {narrowing question — which variant?}
- Third: {diagnostic — what specific thing to check?}
- Search: {2-3 search patterns with {placeholders}}
- Check: {where to look for authoritative answers}
- Verify: {what to confirm before giving an answer}
```

### Why This Works

Without a playbook, Robin tries to answer from her weights — which may be months out of date. With a playbook, she follows a diagnostic sequence that leads her to current information every time.

The playbook is also a teaching tool for Robin. After following it a few times, she internalizes the diagnostic pattern for that topic. The playbook doesn't make her dumber — it makes her consistently right instead of occasionally wrong.

---

## The Anti-Pattern Section

Every context field should include a "WHAT NOT TO DO" section. This is surprisingly important.

### Common Anti-Patterns

- **Don't recite from memory.** Pricing, endpoints, model names, version numbers — these change. Always search.
- **Don't assume the user's setup.** They might have both a subscription and a pay-as-you-go account. Ask, don't assume.
- **Don't answer with a different provider's information.** If the user asks about Kimi, don't answer with Claude's setup process.
- **Don't recommend without checking.** "Just use endpoint X" is dangerous if X changed last week. Verify first.

### Why Anti-Patterns Matter

LLMs are confident by default. They'll give a plausible-sounding wrong answer rather than say "I need to check." The anti-pattern section is a calibration tool — it tells Robin specifically when her confidence should drop and she should reach for a tool instead.

---

## Field Reference

### `content` (human-facing)

| Property | Guideline |
|----------|-----------|
| Length | 2,000-6,000 characters. Long enough to be useful, short enough to scan. |
| Format | Markdown. H2 for sections, H3 for confusion patterns. |
| Tone | Direct, no jargon, no filler. Write for someone who's smart but new to this. |
| Code | Use backticks for identifiers. No hardcoded values — use placeholders. |
| Links | Don't link to external URLs (they break). Describe where to find things. |

### `context` (AI-facing)

| Property | Guideline |
|----------|-----------|
| Length | 1,000-2,500 characters. Compressed but complete. |
| Format | Plain text. Numbered lists. ALL CAPS section headers. |
| Tone | Terse, operational. Sentence fragments. Keyword-dense. |
| Search patterns | Always use `{placeholders}` so they work for any provider/tool. |
| Anti-patterns | Always include. Calibrate Robin's confidence. |

### `surface_when` (trigger field)

One sentence describing when Robin should proactively reference this page. Used by the system to decide which context to offer Robin before she asks for it.

```
"User asks about CLI setup, configuration errors, switching between 
assistants, or mentions specific CLI names"
```

### `description` (index entry)

One line shown in the settings list. 50-80 characters.

```
"What CLIs are, where confusion lives, and how to investigate"
```

---

## Quality Checklist

Before considering a wiki page complete:

- [ ] Human content explains the shape, not just the feature
- [ ] At least 2 confusion patterns identified and named
- [ ] Each confusion pattern has a "The pattern:" summary
- [ ] No hardcoded values (URLs, prices, versions) in the content
- [ ] Context field has numbered confusion points
- [ ] Context field has an investigation playbook with search patterns
- [ ] Context field has anti-patterns (WHAT NOT TO DO)
- [ ] `surface_when` describes when this page is relevant
- [ ] `description` is a clear, scannable one-liner
