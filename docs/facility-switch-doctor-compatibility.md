# How the facility-switcher's "Change Clinic" warning works

*Status: BUILT, MOCK DATA ONLY — see "What's mocked" below before reading too much into any
specific clinic/doctor pairing.*

## 1. What this is

Concern Select, Doctor Select, and Slot Picker (steps 1–3 of 5) all have a real, working
facility-switcher dropdown behind the location badge in the header — pick a different clinic
mid-flow, same idea as picking one up front on the "Find a Clinic" page. Once a doctor is
already on screen (Doctor Select onward), switching to a clinic that doctor isn't available at
pops up a warning:

> **Dr. X** is available in person only at the **Y** Clinic. Are you sure you want to switch
> clinics?
>
> **[ Change Clinic ]**  **[ Book an online slot ]**

Both buttons apply the switch and send the visitor back to Doctor Select to pick a doctor
again — "Change Clinic" lands there in In-Clinic mode, "Book an online slot" lands there in
Video Consult mode. The corner **×** is the only true cancel — no switch, no navigation.

## 2. When the warning shows vs. when it doesn't

The warning is a straight comparison: *is the newly-picked clinic the currently-selected
doctor's home clinic?*

- **Same clinic as current** (you picked the one you're already on) → always a silent no-op,
  no warning, nothing changes. Nothing to confirm.
- **Different clinic, and it's *not* the selected doctor's home** → warning shows.
- **Different clinic, but it *is* the selected doctor's home** → switches immediately, no
  warning. There's nothing to warn about — that doctor genuinely is available there.
- **On Concern Select (step 1)** → never warns, regardless of clinic. No doctor is on screen
  yet at that point, so there's nothing to check compatibility against.

## 3. The mock doctor → home-clinic map

Doctor Select currently shows 3 static mock doctor cards (see that step's own liquid comment
for why they're hardcoded, not real API data). Each one has exactly one clinic it's "available"
at, for the purpose of this warning:

| Doctor                     | Home clinic  |
|-----------------------------|--------------|
| Dr. Neethu Jayachandran     | Koramangala  |
| Dr. Arjun Menon             | Indiranagar  |
| Dr. Priya Nair              | Whitefield   |

The other 3 clinics in the dropdown (HSR layout, Jayanagar, Sarjapur) aren't anyone's home —
switching to any of those always triggers the warning, no matter which doctor is selected.

## 4. Two cases to check it yourself

**Case A — warning shows:** Doctor Select, Dr. Neethu Jayachandran selected (the default) →
open the location dropdown → pick **Whitefield** (or anything except Koramangala) → modal
appears.

**Case B — warning doesn't show:** same starting point → pick **Koramangala** instead → badge
updates immediately, no modal — that's Neethu's own clinic.

Switching which doctor card is selected first changes which single clinic is the "safe" one —
Arjun's is Indiranagar, Priya's is Whitefield.

## 5. What's mocked (i.e. what a real integration replaces)

- The 6-clinic list itself (`kal-booking-flow-step-header.liquid`'s facility dropdown) is a
  static list, not fetched from anywhere.
- `MOCK_DOCTOR_HOME_FACILITY` in `kal-booking-flow.js` is the entire "doctor is available at
  clinic X" data source — a plain `{ doctorName: clinicId }` object, keyed by the doctor's
  display name (matching Doctor Select's `data-kal-doctor-name` on each mock card).
- Real integration replaces that map with an actual facility↔doctor relationship (once Doctor
  Select is wired to real per-clinic doctor data instead of 3 static cards) — everything else
  here (the dropdown, the modal, the button wiring, routing back to Doctor Select) stays as-is.
