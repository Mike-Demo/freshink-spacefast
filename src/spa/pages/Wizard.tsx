import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  ApiHttpError,
  createHold,
  DEMO_STUDIO,
  getAvailability,
  getStudio,
  type AvailabilityResponse,
  type HoldResponse,
  type StudioInfo,
} from "../lib/api";
import {
  addDays,
  chicagoDateKey,
  formatLongDate,
  formatPhone,
  formatShortDate,
  isSlotElapsed,
  isValidEmail,
  isWeekend,
} from "../lib/time";
import { Countdown, StudioCard } from "../components/chrome";
import { useNavigate } from "../router";

const STEPS = ["Name", "Pronouns", "Day preference", "Date & time", "Phone", "Email", "Idea", "Review"] as const;

const PRONOUN_OPTIONS = ["they / them", "she / her", "he / him", "she / they", "he / they"] as const;

const DAY_PREFS = [
  { value: "weekday", label: "Weekday", sub: "Monday–Friday sessions" },
  { value: "weekend", label: "Weekend", sub: "Saturday sessions" },
  { value: "any", label: "No preference", sub: "Show me everything" },
] as const;

type DayPref = (typeof DAY_PREFS)[number]["value"];

export function WizardPage(): ReactElement {
  const navigate = useNavigate();
  const [studio, setStudio] = useState<StudioInfo>(DEMO_STUDIO);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [pronouns, setPronouns] = useState("");
  const [customPronouns, setCustomPronouns] = useState("");
  const [dayPref, setDayPref] = useState<DayPref | "">("");
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [idea, setIdea] = useState("");
  const [touched, setTouched] = useState(false);
  const [avail, setAvail] = useState<AvailabilityResponse | null>(null);
  const [availError, setAvailError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hold, setHold] = useState<HoldResponse | null>(null);

  useEffect(() => {
    void getStudio().then(setStudio);
  }, []);

  // Fetch a 14-day availability window once the wizard opens (cheap; reused by step 4).
  useEffect(() => {
    const from = chicagoDateKey(new Date());
    const to = chicagoDateKey(addDays(new Date(), 13));
    let cancelled = false;
    void getAvailability(from, to)
      .then((a) => {
        if (!cancelled) {
          setAvail(a);
          setAvailError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setAvailError(err instanceof ApiHttpError ? err.message : "Could not load open times. Please try again.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dayMap = useMemo(() => new Map((avail?.open ?? []).map((d) => [d.date, d.times])), [avail]);

  const pronounValue = pronouns === "custom" ? customPronouns.trim() : pronouns === "private" ? "" : pronouns;
  const pronounLabel = pronouns === "private" ? "Prefer not to say" : pronounValue;

  const nameValid = name.trim().length >= 2;
  const pronounsValid = pronouns !== "" && (pronouns !== "custom" || customPronouns.trim().length > 0);
  const prefValid = dayPref !== "";
  const slotValid = date !== "" && slot !== "" && !isSlotElapsed(date, slot);
  const phoneValid = phone.replace(/\D/g, "").length === 10;
  const emailValid = isValidEmail(email);

  const stepValid = [nameValid, pronounsValid, prefValid, slotValid, phoneValid, emailValid, true, true][step] ?? false;

  const selectedTimes = useMemo(() => {
    if (!date) return [];
    return (dayMap.get(date) ?? []).filter((t) => !isSlotElapsed(date, t));
  }, [date, dayMap]);

  const days = useMemo(() => {
    const keys = [...dayMap.keys()].sort();
    return keys.map((k) => {
      const open = (dayMap.get(k) ?? []).filter((t) => !isSlotElapsed(k, t));
      const weekend = isWeekend(k);
      const matches = dayPref === "any" || dayPref === "" || (dayPref === "weekend") === weekend;
      return { key: k, open, matches };
    });
  }, [dayMap, dayPref]);

  const go = (delta: number) => {
    const next = step + delta;
    if (next < 0 || next >= STEPS.length) return;
    setTouched(false);
    setStep(next);
    window.scrollTo(0, 0);
  };

  const nextDisabled = !stepValid && !(step === 6);

  const submit = () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    void createHold({
      date,
      time_slot: slot,
      name: name.trim(),
      email: email.trim(),
      phone: phone.replace(/\D/g, ""),
      pronouns: pronounValue || undefined,
      idea: idea.trim() || undefined,
    })
      .then((h) => {
        setHold(h);
        // Cache a pass summary for the pass page (same-device flow).
        try {
          sessionStorage.setItem(
            `freshink:hold:${h.booking_id}`,
            JSON.stringify({ booking_id: h.booking_id, date, time_slot: slot, client_name: name.trim() }),
          );
        } catch {
          /* storage unavailable — pass page has a lookup fallback */
        }
        setSubmitting(false);
        window.scrollTo(0, 0);
      })
      .catch((err: unknown) => {
        setSubmitError(
          err instanceof ApiHttpError
            ? err.body?.error ?? err.message
            : "Something went wrong creating your hold. Please try again.",
        );
        setSubmitting(false);
      });
  };

  if (hold) {
    const checkoutPath = hold.checkout_url.startsWith("/") ? hold.checkout_url : `/checkout/${hold.booking_id}`;
    return (
      <div className="narrow" style={{ margin: "0 auto" }}>
        <p className="kicker">Hold placed</p>
        <h1>Your slot is held.</h1>
        <p className="lede">
          {formatLongDate(date)} at {slot} is reserved for you. Lock it in before the timer runs out.
        </p>
        <div className="card tint center">
          <p className="small muted" style={{ marginBottom: "0.3rem" }}>Hold expires in</p>
          <Countdown expiresAt={hold.hold_expires_at} />
          <div className="spacer" />
          <button type="button" className="btn btn-primary" onClick={() => navigate(checkoutPath)} style={{ width: "100%" }}>
            Continue to lock-in
          </button>
          <p className="small muted" style={{ marginTop: "0.8rem", marginBottom: 0 }}>
            Booking reference <span className="mono">{hold.booking_id}</span>
          </p>
        </div>
        <div className="notice warn">
          <h3>Heads up</h3>
          <p>
            Holds expire after {hold.hold_expires_in_minutes} minutes if not locked in. No payment is
            needed — locking in is free in this preview.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "34rem", margin: "0 auto" }}>
      <p className="kicker">Book a session — preview</p>
      <h1>Book your session</h1>
      <p className="lede">
        Eight quick steps. Synthetic demo data only — nothing here is real, and locking in is free.
      </p>

      <div className="step-progress" aria-hidden="true">
        {STEPS.map((s, i) => (
          <span key={s} className={`seg${i <= step ? " done" : ""}`} />
        ))}
      </div>
      <p className="step-label">
        Step {step + 1} of {STEPS.length} — {STEPS[step]}
      </p>

      <div className="card">
        {step === 0 && (
          <div className="field">
            <label htmlFor="w-name">Your name</label>
            <input
              id="w-name"
              type="text"
              value={name}
              autoComplete="name"
              placeholder="Alex Rivera"
              onChange={(e) => setName(e.target.value)}
            />
            {touched && !nameValid && <p className="error-text">Please enter your name (2+ characters).</p>}
          </div>
        )}

        {step === 1 && (
          <div className="field">
            <label>Your pronouns</label>
            <div className="option-grid">
              {PRONOUN_OPTIONS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`option-card${pronouns === p ? " selected" : ""}`}
                  onClick={() => setPronouns(p)}
                >
                  <span className="radio" aria-hidden="true" />
                  <span>{p}</span>
                </button>
              ))}
              <button
                type="button"
                className={`option-card${pronouns === "private" ? " selected" : ""}`}
                onClick={() => setPronouns("private")}
              >
                <span className="radio" aria-hidden="true" />
                <span>Prefer not to say</span>
              </button>
              <button
                type="button"
                className={`option-card${pronouns === "custom" ? " selected" : ""}`}
                onClick={() => setPronouns("custom")}
              >
                <span className="radio" aria-hidden="true" />
                <span>Something else</span>
              </button>
            </div>
            {pronouns === "custom" && (
              <div style={{ marginTop: "0.8rem" }}>
                <input
                  type="text"
                  value={customPronouns}
                  placeholder="e.g. xe / xem"
                  aria-label="Custom pronouns"
                  onChange={(e) => setCustomPronouns(e.target.value)}
                />
              </div>
            )}
            {touched && !pronounsValid && <p className="error-text">Pick an option (or choose “Prefer not to say”).</p>}
          </div>
        )}

        {step === 2 && (
          <div className="field">
            <label>When do you usually prefer?</label>
            <div className="option-grid">
              {DAY_PREFS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  className={`option-card${dayPref === d.value ? " selected" : ""}`}
                  onClick={() => setDayPref(d.value)}
                >
                  <span className="radio" aria-hidden="true" />
                  <span>
                    {d.label}
                    <span className="sub">{d.sub}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="hint">This just highlights matching days on the next step — every open day stays available.</p>
            {touched && !prefValid && <p className="error-text">Pick one to continue.</p>}
          </div>
        )}

        {step === 3 && (
          <div className="field">
            <label>Pick a day and time</label>
            {availError && <div className="alert-error">{availError}</div>}
            {!avail && !availError && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.45rem" }}>
                {Array.from({ length: 14 }).map((_, i) => (
                  <div key={i} className="skeleton" />
                ))}
              </div>
            )}
            {avail && (
              <>
                <div className="day-strip" role="group" aria-label="Available days">
                  {days.map((d) => {
                    const hasOpen = d.open.length > 0;
                    return (
                      <button
                        key={d.key}
                        type="button"
                        className={`day-chip${date === d.key ? " selected" : ""}`}
                        disabled={!hasOpen}
                        onClick={() => {
                          setDate(d.key);
                          setSlot("");
                        }}
                        aria-pressed={date === d.key}
                      >
                        <span className="dow">{formatShortDate(d.key).split(" ")[0]}</span>
                        <span className="dnum">{d.key.slice(8)}</span>
                        {d.matches && hasOpen && <span className="pref">match</span>}
                      </button>
                    );
                  })}
                </div>
                {date && (
                  <>
                    <p className="small muted" style={{ margin: "0.6rem 0 0" }}>
                      {formatLongDate(date)} — {selectedTimes.length} open
                    </p>
                    <div className="slot-grid" role="group" aria-label="Available times">
                      {selectedTimes.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={`slot-chip${slot === t ? " selected" : ""}`}
                          onClick={() => setSlot(t)}
                          aria-pressed={slot === t}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {touched && !slotValid && (
                  <p className="error-text">Pick a day and an available time to continue.</p>
                )}
                <p className="hint">All times are America/Chicago. Elapsed slots are hidden automatically.</p>
              </>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="field">
            <label htmlFor="w-phone">Phone number</label>
            <input
              id="w-phone"
              type="tel"
              value={phone}
              autoComplete="tel"
              inputMode="tel"
              placeholder="(555) 019-2834"
              onChange={(e) => setPhone(formatPhone(e.target.value))}
            />
            <p className="hint">Demo only — use a placeholder number. SMS reminders are simulated in this preview.</p>
            {touched && !phoneValid && <p className="error-text">Enter a 10-digit phone number.</p>}
          </div>
        )}

        {step === 5 && (
          <div className="field">
            <label htmlFor="w-email">Email</label>
            <input
              id="w-email"
              type="email"
              value={email}
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="hint">Email is mocked in this preview — nothing is actually sent.</p>
            {touched && !emailValid && <p className="error-text">Enter a valid email address.</p>}
          </div>
        )}

        {step === 6 && (
          <div className="field">
            <label htmlFor="w-idea">Your tattoo idea <span className="muted small">(optional)</span></label>
            <textarea
              id="w-idea"
              value={idea}
              placeholder="Describe the piece — placement, size, style, references…"
              onChange={(e) => setIdea(e.target.value)}
            />
            <p className="hint">Reference photos and AI sketches are disabled in this preview — words only.</p>
          </div>
        )}

        {step === 7 && (
          <>
            <h3 style={{ marginTop: 0 }}>Review your booking</h3>
            <ul className="review-list">
              <li><span className="k">Name</span><span className="v">{name.trim()}</span></li>
              <li><span className="k">Pronouns</span><span className="v">{pronounLabel || "—"}</span></li>
              <li><span className="k">Date</span><span className="v">{formatLongDate(date)}</span></li>
              <li><span className="k">Time</span><span className="v">{slot} (Chicago)</span></li>
              <li><span className="k">Phone</span><span className="v">{phone}</span></li>
              <li><span className="k">Email</span><span className="v">{email.trim()}</span></li>
              {idea.trim() && <li><span className="k">Idea</span><span className="v">{idea.trim()}</span></li>}
            </ul>
            {submitError && <div className="alert-error">{submitError}</div>}
            <div className="notice warn">
              <h3>Free demo hold</h3>
              <p>
                Submitting places a 15-minute hold. Locking in is free in this preview — no charge, no card.
              </p>
            </div>
          </>
        )}

        <div className="btn-row">
          {step > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => go(-1)}>
              Back
            </button>
          )}
          {step < STEPS.length - 1 && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={nextDisabled}
              onClick={() => {
                if (!stepValid) {
                  setTouched(true);
                  return;
                }
                go(1);
              }}
            >
              Continue
            </button>
          )}
          {step === STEPS.length - 1 && (
            <button type="button" className="btn btn-primary" disabled={submitting} onClick={submit}>
              {submitting ? "Placing hold…" : "Place my 15-minute hold"}
            </button>
          )}
        </div>
      </div>

      <StudioCard name={studio.name} address={studio.address} />
      <p className="small muted center">
        Sessions run about 90 minutes. Studio hours: {studio.hours}
      </p>
    </div>
  );
}
