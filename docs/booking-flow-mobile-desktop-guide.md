# Booking Flow: How Mobile & Desktop Are Built

*A plain-English guide for anyone new to Shopify theme development — no coding background required to follow along.*

This document explains **only the "Book an Appointment" popup** (the booking flow), not the rest of the website. It answers three questions:

1. What kind of project is this, and where do things live?
2. What rule are we following to make it look right on a phone *and* a laptop?
3. Where exactly do I go to change something?

---

## 1. What kind of project is this?

This store runs on **Shopify**, using Shopify's own templating language called **Liquid**. Think of Shopify like a house with a fixed foundation (the platform) where we're allowed to customize the rooms (the "theme"). A theme is just a folder of files, and every file has one job:

| Folder | What lives here | Plain-English meaning |
|---|---|---|
| `layout/` | The outer shell of every page (e.g. `theme.liquid`) | The "picture frame" every page sits inside |
| `sections/` | Reusable page blocks (hero banners, footers, etc.) | Big Lego blocks you snap onto a page |
| `snippets/` | Smaller reusable pieces, included inside sections/layout | Small Lego pieces used to build a bigger block |
| `assets/` | CSS (styling), JavaScript (behavior), images | The paint, the wiring, and the pictures |
| `config/` | Settings shown in the Shopify theme editor (merchant-facing toggles) | The control panel a non-developer can use |
| `templates/`, `locales/` | Page-type templates, translated text | Not really touched by the booking flow |

The booking flow lives almost entirely in **`snippets/`** and **`assets/`**.

---

## 2. Where is the booking flow, file by file?

Everything is prefixed `kal-booking-flow` (or `kal-` for shared pieces) so it's easy to spot in a big theme.

```
snippets/
├── kal-booking-flow.liquid                     ← the "shell" — the popup box itself
├── kal-booking-flow-step-entry.liquid          ← Step 1: intro / choose consultation type
├── kal-booking-flow-step-concern-select.liquid ← Step 2: pick a concern
├── kal-booking-flow-step-doctor-select.liquid  ← Step 3: pick a clinic + doctor
├── kal-booking-flow-step-slot-picker.liquid    ← Step 4: pick a date/time
├── kal-booking-flow-step-therapy-slot.liquid   ← Step 4 alt: therapy booking variant
├── kal-booking-flow-step-patient-details.liquid← Step 5: patient's name/phone/etc.
├── kal-booking-flow-step-confirmation.liquid   ← Step 6: review before submitting
├── kal-booking-flow-step-booking-confirmed.liquid ← Final "you're booked!" screen
├── kal-booking-flow-doctor-card.liquid         ← One doctor's card (reused in step 3)
├── kal-booking-flow-option-card.liquid         ← "In-clinic / Video" style option card
├── kal-booking-flow-price-banner.liquid        ← The price strip at the bottom of a step
└── kal-booking-flow-concern-row.liquid         ← One row in the concern list

assets/
├── kal-booking-flow.css   ← ALL the styling/appearance for the whole flow (one file)
└── kal-booking-flow.js    ← ALL the behavior (opening/closing, switching steps, calling the backend)
```

**Rule of thumb:**
- Want to change **wording, layout structure, or what HTML elements exist** → edit the relevant `.liquid` file in `snippets/`.
- Want to change **colors, spacing, sizing, fonts, or how it rearranges between phone and desktop** → edit `assets/kal-booking-flow.css`.
- Want to change **what happens when you click something, or what data gets fetched from the backend** → edit `assets/kal-booking-flow.js`.

The whole popup is switched on for the entire site from one place: `layout/theme.liquid` has a single line, `{% render 'kal-booking-flow' %}`, which pulls in `kal-booking-flow.liquid` — and that file is what loads the CSS and JS files above. So the popup exists once per page, hidden until a "Request Appointment" button opens it.

---

## 3. The rule we follow for mobile vs. desktop: **"Mobile-first"**

There are two common philosophies in web design:

- **Desktop-first**: design for a big laptop screen, then shrink things down for phones.
- **Mobile-first**: design for a small phone screen *first* (this is the default), then add extra rules that only kick in on bigger screens.

**This project uses mobile-first.** In practice that means:

- Every style is written assuming a phone screen unless it's wrapped in a special "only apply this on bigger screens" rule.
- That special rule is called a **media query**, and it looks like this in the CSS file:

```css
@media screen and (min-width: 750px) {
  /* anything in here ONLY applies once the screen is 750px wide or more */
}
```

- **750px is our breakpoint** — the dividing line between "phone/tablet layout" and "desktop layout." It's the same breakpoint Shopify's own default "Dawn" theme uses, so it's consistent with the rest of the store.
- There's one extra, smaller rule at **420px** for fine-tuning very small/old phones.

You can see this pattern by searching the CSS file for `@media` — every single responsive adjustment in the booking flow goes through one of these two breakpoints. Nothing is hard-coded to a fixed pixel width outside of that.

### Why mobile-first?
Most people booking an appointment do it from their phone while looking at their calendar or waiting somewhere — so the "default" (unlabeled) styles are built for that experience first, and desktop is treated as the "bonus" enhancement layered on top. This also keeps the CSS lighter for phones, since a phone doesn't have to "undo" desktop styles it will never use.

---

## 4. How mobile and desktop actually differ (this is the important part)

For most simple websites, "responsive" just means the *same* HTML reflows and rearranges itself as the screen shrinks (like text wrapping to a new line). **This booking flow does something more deliberate:** for every step, there are genuinely **two separate blocks of markup** — one built specifically for mobile, one built specifically for desktop — and only one of them is ever visible at a time.

You can see this directly in any step file, e.g. `snippets/kal-booking-flow-step-doctor-select.liquid`:

```html
<div class="kal-step-doctor-select">

  <!-- ============ MOBILE ONLY (below 750px) ============ -->
  <div class="kal-step-doctor-select__mobile">
    ... the entire mobile screen: header, scrolling list, sticky footer ...
  </div>

  <!-- ============ DESKTOP (750px and up) ============ -->
  <div class="kal-step-doctor-select__desktop">
    ... a totally different two-column layout: info panel on the left,
        clinic/doctor picker on the right ...
  </div>

</div>
```

Both blocks are always present in the page's HTML. The CSS file (`kal-booking-flow.css`) then decides which one is actually shown, using that same 750px breakpoint:

```css
.kal-step-doctor-select__mobile {
  display: flex;   /* visible by default (this is the "mobile" default) */
}
@media screen and (min-width: 750px) {
  .kal-step-doctor-select__mobile {
    display: none;  /* hide the mobile version once we hit desktop width */
  }
}

.kal-step-doctor-select__desktop {
  display: none;   /* hidden by default */
}
@media screen and (min-width: 750px) {
  .kal-step-doctor-select__desktop {
    display: grid;  /* show the desktop version only from 750px up */
  }
}
```

**Why build it this way instead of one flexible layout?**
Mobile shows a single scrolling column with a header at top and a sticky "Continue" button pinned to the bottom. Desktop shows a two-column layout (an info panel on the left, the actual step content on the right) inside a fixed-size centered popup. These two designs are different enough (not just "the same boxes, narrower") that trying to force one HTML structure to do both jobs would mean fighting the CSS constantly. Building them as two clearly-labeled blocks keeps each one simple and easy to reason about independently — the tradeoff is that when you change wording or add a field, you generally need to update it in **both** the `__mobile` and `__desktop` blocks of that step's file, since they don't share markup.

### Popup shape itself
- **On phone**: the popup fills the entire screen (full-width, full-height) — like a native app screen.
- **On desktop**: the popup becomes a centered card, roughly 802px wide and 500px tall, with rounded corners and a drop shadow, floating over a dimmed background.

That's controlled in `assets/kal-booking-flow.css` on the very first `.kal-booking-flow` rule and its `@media (min-width: 750px)` companion.

---

## 5. Naming convention (so the CSS isn't a mystery)

The class names follow a pattern called **BEM** (Block, Element, Modifier) — a widely-used naming convention, not something invented for this project:

- `kal-step-doctor-select` → the **Block** (the whole doctor-selection step)
- `kal-step-doctor-select__mobile` → an **Element** inside that block (double underscore `__`)
- `kal-facility-chip--active` → a **Modifier**, a variation of a normal element (double dash `--`), e.g. "this chip is the one currently selected"

Once you know this, you can read any class name and know exactly what it belongs to and what state it's in, just from its name — no need to search the CSS to guess.

---

## 6. What the JavaScript file (`kal-booking-flow.js`) actually does

You don't need to read JavaScript to understand its job. In plain terms, it:

1. **Opens/closes the popup** when a "Request Appointment" button anywhere on the site is clicked.
2. **Switches between steps.** Every step's outer wrapper has a `data-kal-step="stepname"` label. Clicking a "Continue" button just tells the script "hide every step except this one" — it doesn't reload the page.
3. **Talks to the backend (the CMS/API)** to fetch real clinics, real doctors, and real available time slots, and to submit the finished booking. The backend's web address is configured by the store owner in the Shopify theme editor (not hard-coded in a file), under a setting called **"CMS backend API base URL."**
4. Applies the same logic regardless of mobile or desktop — the JS doesn't care which layout is visible; it just shows/hides the correct `data-kal-step` block, and both the mobile and desktop markup for that step update together since they share the same underlying data.

---

## 7. Merchant-facing settings (no coding required)

A store owner (non-developer) can control some things about the booking flow directly from **Shopify Admin → Online Store → Themes → Customize → Theme settings**, without touching any code:

- Turn the entire booking flow on/off
- Set the backend API URL it talks to
- Change the default "Request Appointment" button text
- Set a WhatsApp fallback number
- Upload the Entry step's banner image

These live in `config/settings_schema.json`, but a merchant never needs to open that file — they use the visual theme editor.

---

## 8. Quick "I want to change X" cheat sheet

| I want to... | Go to... |
|---|---|
| Change wording/copy on a step | The step's `.liquid` file in `snippets/` (edit **both** `__mobile` and `__desktop` blocks) |
| Change a color, font size, or spacing | `assets/kal-booking-flow.css` |
| Change what happens on phones only | Find the rule *without* `@media`, or inside the step's `__mobile` block |
| Change what happens on desktop only | Find the rule *inside* `@media screen and (min-width: 750px)`, or the step's `__desktop` block |
| Change the breakpoint where mobile→desktop switches | Search-and-replace `750px` in `kal-booking-flow.css` (do this carefully — it's used ~15 times) |
| Change button click behavior / API calls | `assets/kal-booking-flow.js` |
| Add a brand-new step to the flow | Add a new snippet file, `{% render %}` it inside `snippets/kal-booking-flow.liquid`, then add its `data-kal-step="..."` wiring in `kal-booking-flow.js` |
| Turn the whole flow on/off, or change the backend URL | Shopify Admin → Customize → Theme settings (no code) |

---

## 9. Prompts you can use with Claude while building this flow

You don't need to know how to code to direct this work well — you mainly need to be specific about **which screen** (mobile or desktop), **which step**, and **what "done" looks like**. The prompts below are grouped by the stage you're in. Copy one, swap in your specifics, and paste it into the chat.

The goal of this section is to close the gap between "we built something" and "we built the right thing, verified, on both screen sizes" — that's what "give it 100%" means in practice: nothing shipped without being checked.

### A. Before starting — get oriented / align on scope

- "Before we touch any code, explain what currently happens in the [step name] step on mobile vs desktop, in plain English, so I can confirm that's actually what should happen."
- "I want to change [X]. Tell me which files that touches, and whether it affects mobile only, desktop only, or both, before you make any edits."
- "Here's a screenshot/Figma link of what this step should look like. Compare it to what's currently in the code and tell me what's different, before changing anything."
- "Don't write any code yet — just tell me your plan for how you'd implement [feature], and which files you'd touch."

### B. While building a new step or feature

- "Build [feature] the same way the other steps are built — a `__mobile` block and a separate `__desktop` block in the same `.liquid` file, following the existing BEM naming pattern."
- "I'm adding a new step called [name]. Walk me through every place it needs to be wired up — the snippet file, `kal-booking-flow.liquid`, and `kal-booking-flow.js` — so nothing is missed."
- "Match the spacing/colors/fonts to the existing steps — reuse the CSS variables already defined at the top of `kal-booking-flow.css` instead of hardcoding new values."
- "After you make this change, tell me explicitly: did you update both the mobile and desktop markup, or just one?"

### C. Verifying it actually works (the "100%" checklist)

- "Start the dev server / preview and actually open the booking flow. Click through this step on a mobile-width and a desktop-width view and tell me what you see, not just what the code says."
- "Resize the preview across 420px, 749px, 750px, and a full desktop width, and tell me if anything breaks, overlaps, or gets cut off at any of those sizes."
- "Test the full flow end-to-end from Entry to Booking Confirmed on mobile width, then again on desktop width. Report any step where something looks wrong or a button doesn't do what it should."
- "Check that the Continue/Back buttons, the close button, and the progress dots all work correctly on both mobile and desktop for this step."
- "Does this change break any other step that reuses the same CSS class or the same JS function? Check for that before calling it done."

### D. When something looks wrong (bug reports that are easy to act on)

- "On [phone/desktop], on the [step name] step, [describe what you see] instead of [what you expected]. Screenshot attached." *(Screenshots make this dramatically faster to fix — always include one if you can.)*
- "This looks fine on desktop but broken on mobile — go check the `__mobile` block and its styles in the CSS, not the desktop ones."
- "This worked yesterday and broke after [describe recent change] — check what changed in that area first before searching everywhere."
- "The layout looks right but clicking [button] doesn't do anything — check `kal-booking-flow.js` for how that button is wired up."

### E. Reviewing before you consider it finished

- "Show me a summary of every file you changed and why, in plain English, before I approve this."
- "Read back the change you just made and tell me honestly whether you actually tested it in a browser, or only read the code and assumed it works."
- "Is there anywhere else in the codebase that does something similar to this, that I should be consistent with?"
- "Double check: does this change need updating in the Shopify theme settings (`config/settings_schema.json`) too, or is it purely a code-level change?"

### F. General habits worth building into how you ask

- **Always name mobile or desktop explicitly** — "fix the spacing" is ambiguous; "fix the spacing on the mobile view of the doctor-select step" is not.
- **Ask for the plan before the code** on anything non-trivial — it's much cheaper to correct a plan than a finished implementation.
- **Ask "did you actually check this in a browser?"** — reading code and running code can disagree, especially for visual/responsive issues.
- **Attach a screenshot or Figma link whenever you can** — for anything visual, this is worth more than a paragraph of description.
- **Ask for a plain-English explanation of any change** before it's made, if you don't fully follow the technical explanation — you're entitled to understand what's happening to your own product.

---

## 10. Glossary (for the non-technical reader)

- **Liquid** — Shopify's templating language. Looks like HTML with extra `{% %}` and `{{ }}` tags for logic and data.
- **Snippet** — A small, reusable chunk of Liquid/HTML, included into a bigger file.
- **CSS** — The styling language: colors, sizes, spacing, layout.
- **Media query** — A CSS rule that only applies at certain screen widths (our tool for "mobile vs desktop").
- **Breakpoint** — The specific screen width where the layout switches (ours is 750px).
- **BEM** — A class-naming convention: `block__element--modifier`.
- **`data-kal-step`** — A label on each step's wrapper `<div>` that the JavaScript uses to know which step is currently showing.
- **API / backend** — The separate system (CMS) that holds real clinics, doctors, and time slots, and that the booking flow fetches data from and submits bookings to.

---

*Last updated: 2026-09-13.*
