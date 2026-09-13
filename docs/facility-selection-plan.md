# Plan: Facility Selection → Booking Flow (Demo Store)

*Status: BUILT on branch `feature/facility-selection` (commit 4a01111) — not yet merged to `main`.*

## 1. Why this exists

The booking popup currently assumes one fixed clinic everywhere — "Kerala Ayurveda Wellness
Center, Indiranagar" is hardcoded as plain text in two separate places on every step:
`.kal-step-entry__location-text` (the full-sentence desktop info-column line, across
`snippets/kal-booking-flow-step-*.liquid`) and `.kal-step-header__location-text` (a shorter
mobile badge in the newer shared `kal-booking-flow-step-header.liquid`, currently used by
Concern Select and Doctor Select). Slot Picker also has a real facility wired in, but as a
hardcoded HTML attribute (`data-kal-facility-id="185b85d7-fad2-405d-b8ea-13dc683fbde8"` in
`kal-booking-flow-step-slot-picker.liquid`), not something a visitor actually chose.

Goal: build the missing first step — **let a visitor pick their real clinic before the booking
popup opens, and have that choice flow through the whole popup** — entirely in this demo store,
so it's a complete, working reference a senior developer can port into the real
`keralaayurveda.com` theme later. This is being built and tested end-to-end here first, not
directly in the live store.

## 2. Key decision: reuse the real site's exact schema, don't invent a parallel one

The real site already has a "Find a Clinic" page for this exact purpose
(`templates/page.clinic-list.json` → `sections/clinic-list.liquid`), a plain
state-grouped list of clinic name links, each one a repeatable Shopify block of type
`clinics_list` with fields: `location_name` (text), `clinic_address` (richtext),
`location_url_clnk` (url, "Get Directions"), `url_get_directions_clnk` (text, button label),
`link_clinic_url` (url, link to that clinic's own page), `link_clinic_label` (text, button
label).

**To make this as easy as possible for your senior to port over, the demo will use the
identical section filename, identical block type name, and identical field names as the real
site** — not a differently-named parallel schema that would need translating later. The only
change is **adding one new field to that same block: `facility_id`** (the real UUID from the
CMS `facilities` table — the join key the architecture discussion identified as missing).
Everything else about the block stays exactly as the real site already has it.

Practically, this means porting this feature to the real theme later should be: *add one field
to the real `clinics_list` block schema, copy over the JS that reads it* — not reconciling two
different data shapes.

Other differences from the real page, both intentional and low-risk to reconcile later:
- **Scaling down to 3–4 test facilities**, not the real site's ~27 — testing the mechanism, not
  building a production directory.
- **Clicking a facility opens the booking popup instead of navigating to that clinic's own
  page** — `link_clinic_url` still exists on the block (kept for schema parity) but isn't used
  for navigation here; the click handler is new behavior layered on top of the same data.

## 3. The two pieces being built

### 3a. New page: "Find a Clinic" (outside the popup)

- A real Shopify page (own template/section), separate from `kal-booking-flow.liquid` — sits
  *outside* the popup, exactly like the real site's page.
- New section file **`sections/clinic-list.liquid`** (same name as the real site's file), block
  type **`clinics_list`** (same name), with the real site's existing fields plus one addition:
  - `location_name` (text) — clinic name
  - `clinic_address` (richtext) — full address
  - `location_url_clnk` (url) — Google Maps link ("Get Directions")
  - `link_clinic_url` (url) — kept for schema parity with the real site, unused by the click
    handler here
  - **`facility_id` (text) — NEW, the real UUID from Supabase `facilities`**
- 3–4 test blocks added via the Shopify Theme Editor (no separate data file — same
  merchant-editable pattern the real site already uses).
- Each facility renders as a plain link/list item (matching the screenshot's style), carrying
  `data-facility-id="{{ block.settings.facility_id }}"`,
  `data-location-name="{{ block.settings.location_name }}"`, and
  `data-clinic-address="{{ block.settings.clinic_address | strip_html }}"` — field names on the
  markup match the schema field names, so nothing needs renaming when this moves to the real
  theme.
- Clicking a facility:
  1. Stores the chosen `facility_id`/`location_name`/`clinic_address` — plan is `localStorage`,
     scoped to this browser only, no backend call needed for this step.
  2. Triggers the existing "Request Appointment" flow that opens `kal-booking-flow.liquid`.

### 3b. Booking popup changes: consume the stored facility

- On open, `kal-booking-flow.js` reads the stored facility info from `localStorage`.
- Every step's location line (`.kal-step-entry__location-text`) gets populated from that stored
  `location_name`/`clinic_address` instead of the hardcoded string — one shared render function,
  since the same markup pattern repeats across Entry/Doctor Select/Slot Picker/Patient
  Details/Confirmation. No fabricated "Opens 8 AM" text — the real block doesn't have an hours
  field today, so the popup only shows what real data actually provides (name + address).
- Slot Picker's `data-kal-facility-id` gets set from the stored `facility_id` instead of the
  hardcoded UUID, so the real availability slots returned actually belong to the clinic the
  visitor picked.
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
| Kerala Ayurveda, Indiranagar | `185b85d7-fad2-405d-b8ea-13dc683fbde8` | already hardcoded in `kal-booking-flow-step-slot-picker.liquid` |
| ? | ? | need 2–3 more |

I don't currently have live access to query Supabase directly (the Supabase MCP connection
isn't authenticated in this session), so the remaining facility IDs need to come from you —
either paste them here, or authorize the Supabase connector so I can pull them directly. Until
then, `templates/page.find-a-clinic.json` ships with two clearly-marked
`(PLACEHOLDER — replace facility_id)` clinics alongside the one real one.

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

## 7. Handoff checklist (for whoever integrates this into the live store later)

Because the demo reuses the real site's exact section filename, block type, and field names,
porting this over should be close to a copy-paste, not a rewrite:

1. **Add one field to the real block schema** — open `sections/clinic-list.liquid` in the real
   theme, find the `clinics_list` block's `{% schema %}`, add the same `facility_id` (text)
   setting used in the demo.
2. **Fill in `facility_id` on every existing real clinic block** — go through the ~27 already
   -configured clinics in the Theme Editor and paste in each one's real UUID from Supabase
   `facilities`. (The demo only had 3–4 to fill in; the real site has all of them already
   authored, just missing this one new field.)
3. **Copy the click-handler JS** (storing `facility_id`/`location_name`/`clinic_address` to
   `localStorage` and opening the booking popup) from this demo's `kal-booking-flow.js` — no
   translation needed since the field names already match.
4. **Copy the popup-side changes** (reading the stored facility, populating the location line,
   setting Slot Picker's `data-kal-facility-id`) the same way.
5. **Decide what happens to the existing separate clinic picker** inside
   `custom-clinic-consultation-form.liquid` (a `<select>` dropdown, independently hand-entered
   per page, unrelated to `clinic-list.liquid`'s blocks) — integrating this properly means
   deciding whether that dropdown gets replaced by this same `facility_id`-carrying mechanism, or
   left alone. Flagging this now so it isn't missed later; not a decision for this demo-store
   task.
6. **Decide whether `link_clinic_url`** (link to a clinic's own detail page) should still fire
   on click alongside opening the popup, or be fully replaced by it — the real site uses that
   field today to navigate away from this page entirely, which conflicts with also opening a
   popup from the same click.
