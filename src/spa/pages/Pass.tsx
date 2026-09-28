import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  ApiHttpError,
  DEMO_STUDIO,
  getAvailability,
  getBooking,
  getStudio,
  passAction,
  type StudioInfo,
} from "../lib/api";
import {
  addDays,
  buildSessionIcs,
  chicagoDateKey,
  downloadIcs,
  formatLongDate,
  formatShortDate,
  isSlotElapsed,
} from "../lib/time";

interface PassSummary {
  booking_id: string;
  date: string;
  time_slot: string;
  client_name: string;
}

function loadCached(token: string): PassSummary | null {
  try {
    const raw = sessionStorage.getItem(`freshink:pass:${token}`) ?? sessionStorage.getItem(`freshink:hold:${token}`);
    if (!raw) return null;
    return JSON.parse(raw) as PassSummary;
  } catch {
    return null;
  }
}

/**
 * /pass/$token — session pass: details, attendance confirm, reschedule,
 * client-generated .ics. Email is mocked; the pass URL is the source of truth.
 */
export function PassPage({ token }: { token: string }): ReactElement {
  const [studio, setStudio] = useState<StudioInfo>(DEMO_STUDIO);
  const [summary, setSummary] = useState<PassSummary | null>(() => loadCached(token));
  const [lookupId, setLookupId] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);

  const [confirmed, setConfirmed] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [reschedDate, setReschedDate] = useState("");
  const [reschedTime, setReschedTime] = useState("");
  const [reschedBusy, setReschedBusy] = useState(false);
  const [reschedError, setReschedError] = useState<string | null>(null);
  const [reschedDone, setReschedDone] = useState(false);

  const [openDays, setOpenDays] = useState<{ date: string; times: string[] }[]>([]);

  useEffect(() => {
    void getStudio().then(setStudio);
  }, []);

  useEffect(() => {
    const from = chicagoDateKey(new Date());
    const to = chicagoDateKey(addDays(new Date(), 13));
    void getAvailability(from, to)
      .then((a) => setOpenDays(a.open))
      .catch(() => {});
  }, []);

  const dayMap = useMemo(() => new Map(openDays.map((d) => [d.date, d.times])), [openDays]);
  const reschedTimes = useMemo(() => {
    if (!reschedDate) return [];
    return (dayMap.get(reschedDate) ?? []).filter((t) => !isSlotElapsed(reschedDate, t));
  }, [reschedDate, dayMap]);

  const doLookup = () => {
    const id = lookupId.trim();
    if (!id) return;
    setLookingUp(true);
    setLookupError(null);
    void getBooking(id)
      .then((b) => {
        if (!b.booking_date || !b.time_slot) throw new Error("Booking details unavailable");
        setSummary({
          booking_id: b.booking_id,
          date: b.booking_date,
          time_slot: b.time_slot,
          client_name: b.client_name ?? "Guest",
        });
        setLookingUp(false);
      })
      .catch((err: unknown) => {
        setLookupError(err instanceof ApiHttpError ? (err.body?.error ?? err.message) : "Booking not found.");
        setLookingUp(false);
      });
  };

  const attend = () => {
    setConfirmBusy(true);
    setConfirmError(null);
    void passAction({ action: "confirm", access_token: token }).then((r) => {
      setConfirmBusy(false);
      if (r.ok) setConfirmed(true);
      else setConfirmError(r.error ?? "Could not confirm attendance.");
    });
  };

  const reschedule = () => {
    if (!reschedDate || !reschedTime) return;
    setReschedBusy(true);
    setReschedError(null);
    void passAction({
      action: "reschedule",
      access_token: token,
      new_date: reschedDate,
      new_time_slot: reschedTime,
    }).then((r) => {
      setReschedBusy(false);
      if (r.ok) {
        setReschedDone(true);
        setSummary((s) => (s ? { ...s, date: reschedDate, time_slot: reschedTime } : s));
      } else {
        setReschedError(r.error ?? "Could not reschedule.");
      }
    });
  };

  const addToCalendar = () => {
    if (!summary) return;
    const ics = buildSessionIcs({
      dateKey: summary.date,
      timeSlot: summary.time_slot,
      clientName: summary.client_name,
      address: studio.address,
      passUrl: window.location.href,
    });
    downloadIcs("fresh-ink-session.ics", ics);
  };

  if (!summary) {
    return (
      <div style={{ maxWidth: "34rem", margin: "0 auto" }}>
        <p className="kicker">Session pass</p>
        <h1>Find your pass</h1>
        <p className="lede">
          We could not load your pass on this device. Enter your booking reference to pull it up —
          your pass link already carries your access token.
        </p>
        <div className="card">
          <div className="field">
            <label htmlFor="lookup-id">Booking reference</label>
            <input
              id="lookup-id"
              type="text"
              className="mono"
              value={lookupId}
              placeholder="e.g. 3fa85f64-…"
              onChange={(e) => setLookupId(e.target.value)}
            />
          </div>
          {lookupError && <div className="alert-error">{lookupError}</div>}
          <button type="button" className="btn btn-primary" disabled={lookingUp || !lookupId.trim()} onClick={doLookup}>
            {lookingUp ? "Looking up…" : "Load my pass"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "34rem", margin: "0 auto" }}>
      <p className="kicker">Session pass</p>
      <h1>{formatLongDate(summary.date)}</h1>
      <p className="lede">
        {summary.time_slot} (Chicago) · about 90 minutes · {summary.client_name}
      </p>

      <div className="card tint">
        <h3 style={{ marginTop: 0 }}>
          {studio.name}
          <span className="demo-badge">Demo</span>
        </h3>
        <p className="small" style={{ marginBottom: "0.4rem" }}>{studio.address}</p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Booking reference <span className="mono">{summary.booking_id}</span>
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Are you coming?</h3>
        {confirmed ? (
          <div className="notice ok" style={{ margin: 0 }}>
            <h3>Confirmed — see you there</h3>
            <p>Your attendance is recorded. SMS reminders are simulated in this preview.</p>
          </div>
        ) : (
          <>
            {confirmError && <div className="alert-error">{confirmError}</div>}
            <button type="button" className="btn btn-ok" disabled={confirmBusy} onClick={attend} style={{ width: "100%" }}>
              {confirmBusy ? "Confirming…" : "I am coming"}
            </button>
          </>
        )}
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={addToCalendar}>
            Add to calendar (.ics)
          </button>
        </div>
        <p className="hint" style={{ marginTop: "0.8rem" }}>
          Email is mocked in this preview — your pass URL is shown on screen, so keep this link handy.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Reschedule</h3>
        <p className="small muted">
          Up to 3 reschedules, and no changes within 24 hours of your session.
        </p>
        {reschedDone && (
          <div className="notice ok">
            <h3>Moved</h3>
            <p>
              Your session is now {formatLongDate(summary.date)} at {summary.time_slot}.
            </p>
          </div>
        )}
        {reschedError && <div className="alert-error">{reschedError}</div>}
        <div className="field">
          <label htmlFor="rs-date">New date</label>
          <select
            id="rs-date"
            value={reschedDate}
            onChange={(e) => {
              setReschedDate(e.target.value);
              setReschedTime("");
              setReschedDone(false);
            }}
          >
            <option value="">Choose a day…</option>
            {openDays.map((d) => (
              <option key={d.date} value={d.date}>
                {formatShortDate(d.date)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rs-time">New time</label>
          <select id="rs-time" value={reschedTime} onChange={(e) => setReschedTime(e.target.value)} disabled={!reschedDate}>
            <option value="">Choose a time…</option>
            {reschedTimes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={reschedBusy || !reschedDate || !reschedTime}
          onClick={reschedule}
        >
          {reschedBusy ? "Rescheduling…" : "Move my session"}
        </button>
      </div>
    </div>
  );
}
