/**
 * Static studio info + session copy for the FreshInk SpaceFast preview.
 *
 * All data is synthetic: "Fresh Ink Preview Studio" with a fictional
 * Saint Paul, MN address, clearly marked DEMO. Nothing here is a real
 * business listing. The preview URL is a placeholder until publish.
 */

/** The six real session slots per day (matches the source TIME_SLOTS). */
export const TIME_SLOTS = [
  "10:00 AM",
  "11:30 AM",
  "1:00 PM",
  "2:30 PM",
  "4:00 PM",
  "6:30 PM",
] as const;

export type TimeSlot = (typeof TIME_SLOTS)[number];

export const STUDIO_TIMEZONE = "America/Chicago";

/** Placeholder until the coordinator publishes the preview space. */
export const PREVIEW_BASE_URL = "https://freshink-preview.view.fast/";

export const STUDIO_INFO = {
  name: "Fresh Ink Preview Studio",
  demo: true,
  demo_notice:
    "DEMO — this is a synthetic preview studio. The address, bookings, and staff below are fictional.",
  address: {
    street: "1234 Demo Avenue, Suite 100",
    city: "Saint Paul",
    state: "MN",
    zip: "55101",
    note: "DEMO — fictional address, not a real business location.",
  },
  hours: "Appointment only",
  timezone: STUDIO_TIMEZONE,
  session_minutes: 90,
  deposit_copy: "Free demo bookings — payments are disabled in this preview.",
  how_it_works: [
    "Check open times with list_open_times (or GET /api/public/availability).",
    "Create a 15-minute hold with hold_slot (or POST /api/public/holds) — free in this preview.",
    "Lock in the hold with the checkout URL — no payment, no card.",
    "Receive a session pass link to confirm attendance or reschedule (max 3, 24h cutoff).",
  ],
  website: PREVIEW_BASE_URL,
  session_times: [...TIME_SLOTS],
} as const;
