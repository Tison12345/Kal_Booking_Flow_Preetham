# Plan: Facility Selection → Booking Flow (Demo Store)

*Status: PLAN ONLY — nothing in this document has been built yet.*

## 1. Why this exists

The booking popup currently assumes one fixed clinic everywhere — "Kerala Ayurveda Wellness
Center, Kormangala" is hardcoded as plain text in every step's left-hand info column (see
`.kal-step-entry__location-text` usages across `snippets/kal-booking-flow-step-*.liquid`).
Slot Picker also has a real facility wired in, but as a hardcoded HTML attribute
(`data-kal-facility-id="185b85d7-fad2-405d-b8ea-13dc683fbde8"` in
`kal-booking-flow-step-slot-picker.liquid`), not something a visitor actually chose.

Goal: build the missing first step — **let a visitor pick their real clinic before the booking
popup opens, and have that choice flow through the whole popup** — entirely in this demo store,
so it's a complete, working reference a senior developer can port into the real
`keralaayurveda.com` theme later. This is being built and tested end-to-end here first, not
directly in the live store.

## 2. What we're copying from the real site (and what we're changing)

The real site already has a "Find a Clinic" page for this exact purpose
(`templates/page.clinic-list.json` → `sections/clinic-list.liquid`), a plain
state-grouped list of clinic name links, each one a repeatable Shopify block of type
`clinics_list` with fields: `location_name`, `clinic_address`, `location_url_clnk` (maps
link), `link_clinic_url` (link to that clinic's own page).

We're copying that visual/structural pattern (grouped headings + plain clinic-name links,
not doctor-card-style cards), but:

- **Adding one field that doesn't exist on the real site's block today: `facility_id`** — the
  real UUID from the CMS `facilities` table (Supabase). This is the missing join key identified
  in the earlier architecture discussion — without it, a clicked clinic name has no way to tell
  the booking flow which real facility it corresponds to.
- **Scaling down to 3–4 test facilities**, not the real site's ~27, since this is for testing the
  mechanism, not a production directory.
- **Linking out to the booking popup instead of to a separate clinic detail page** — clicking a
  facility here should carry its `facility_id` into the popup, not navigate to a clinic page.

## 3. The two pieces being built

### 3a. New page: "Find a Clinic" (outside the popup)

- A real Shopify page (own template/section), separate from `kal-booking-flow.liquid` — matches
  what you confirmed: this sits *outside* the popup, exactly like the real site's page.
- New section, e.g. `sections/kal-facility-select.liquid`, with a repeatable block type
  `facility`:
  - `facility_id` (text) — real UUID from Supabase `facilities`
  - `facility_name` (text)
  - `facility_address` (text)
  - `opens_at` (text) — matches the "Opens 8 AM" copy already used everywhere in the popup
- 3–4 test blocks added via the Shopify Theme Editor (no separate data file — same
  merchant-editable pattern the real site already uses).
- Each facility renders as a plain link/list item (matching the screenshot's style), carrying
  `data-facility-id="{{ block.settings.facility_id }}"`.
- Clicking a facility:
  1. Stores the chosen `facility_id` (and `facility_name`/`facility_address`, so the popup
     doesn't need a second lookup) — plan is `localStorage`, scoped to this browser only, no
     backend call needed for this step.
  2. Triggers the existing "Request Appointment" flow that opens `kal-booking-flow.liquid`.

### 3b. Booking popup changes: consume the stored facility

- On open, `kal-booking-flow.js` reads the stored facility info from `localStorage`.
- Every step's location line (`.kal-step-entry__location-text`) gets populated from that stored
  facility instead of the hardcoded string — one shared render function, since the same markup
  pattern repeats across Entry/Doctor Select/Slot Picker/Patient Details/Confirmation.
- Slot Picker's `data-kal-facility-id` gets set from the stored value instead of the hardcoded
  UUID, so the real availability slots returned actually belong to the clinic the visitor picked.
- If no facility was ever selected (e.g. someone opens the popup directly, bypassing the new
  page), fall back to today's hardcoded Kormangala default — so nothing breaks for existing entry
  points while this is being tested.

## 4. Explicitly out of scope for this task

- **Doctor Select does not become dynamic here.** It still shows the same static hardcoded
  doctor cards. Filtering doctors by the selected facility depends on the
  `GET /api/public/doctors?facility_id=` endpoint from the earlier architecture discussion, which
  doesn't exist yet — that's a separate, later task.
- **No changes to the real production theme.** Everything above happens in this demo repo only.
- **No Shopify Admin API / metaobject work.** Facilities stay as plain theme-editor blocks here,
  matching the real site's existing pattern (see architecture doc for why we're not trying to
  auto-sync this yet).

## 5. What we need before building

3–4 real facility records (name + UUID) from the Supabase `facilities` table. One is already
known from existing demo code:

| Facility name | facility_id | Source |
|---|---|---|
| Kerala Ayurveda, Koramangala | `185b85d7-fad2-405d-b8ea-13dc683fbde8` | already hardcoded in `kal-booking-flow-step-slot-picker.liquid` |
| ? | ? | need 2–3 more |

I don't currently have live access to query Supabase directly (the Supabase MCP connection
isn't authenticated in this session), so the remaining facility IDs need to come from you —
either paste them here, or authorize the Supabase connector so I can pull them directly.

## 6. End-to-end test plan (once built)

1. Open the new "Find a Clinic" page.
2. Click Facility A → confirm the popup opens with Facility A's name/address on every step
   (Entry through Confirmation), and that Slot Picker's real slots request uses Facility A's ID
   (check via Network tab / the same `getBoundingClientRect`-style console checks used earlier
   in this project for verifying live behavior).
3. Close everything, reload, click Facility B instead → confirm it now shows Facility B
   everywhere, proving the selection isn't stuck/cached from the first run.
4. Directly open the popup without visiting the Find a Clinic page first (e.g. via a
   "Request Appointment" button elsewhere on the site) → confirm it falls back to the existing
   Kormangala default rather than erroring.

## 7. Handoff notes (for whoever integrates this into the live store later)

- The real site's `clinic-list.liquid` blocks would need the same `facility_id` field added to
  make this pattern reusable there directly, rather than rebuilding it from scratch.
- The real site currently has a *separate* clinic picker inside
  `custom-clinic-consultation-form.liquid` (a `<select>` dropdown, independently hand-entered per
  page) — integrating this properly would mean deciding whether that dropdown gets replaced by
  this same `facility_id`-carrying mechanism, or left alone. Flagging this now so it isn't
  missed later; not a decision for this demo-store task.
