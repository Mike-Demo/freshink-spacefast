import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  ApiHttpError,
  confirmHold,
  getBooking,
  type BookingStatus,
  type ConfirmResponse,
} from "../lib/api";
import { formatLongDate } from "../lib/time";
import { useNavigate } from "../router";

/** /checkout/$id — free lock-in. Payments are entirely disabled in this preview. */
export function CheckoutPage({ id }: { id: string }): ReactElement {
  const navigate = useNavigate();
  const [search] = useState(() => new URLSearchParams(window.location.search));
  const secret = search.get("s") ?? "";
  const [booking, setBooking] = useState<BookingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [result, setResult] = useState<ConfirmResponse | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    void getBooking(id)
      .then((b) => {
        setBooking(b);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoadError(
          err instanceof ApiHttpError
            ? (err.body?.error ?? err.message)
            : "Could not load this hold. Check the link and try again.",
        );
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const lockIn = () => {
    if (confirming || !secret) return;
    setConfirming(true);
    setConfirmError(null);
    void confirmHold(id, secret)
      .then((r) => {
        setResult(r);
        if (r.status === "confirmed" && r.access_token) {
          try {
            const cached = sessionStorage.getItem(`freshink:hold:${id}`);
            if (cached) sessionStorage.setItem(`freshink:pass:${r.access_token}`, cached);
          } catch {
            /* ignore */
          }
        }
        setConfirming(false);
      })
      .catch((err: unknown) => {
        setConfirmError(
          err instanceof ApiHttpError
            ? (err.body?.error ?? err.message)
            : "Could not lock in your slot. Please try again.",
        );
        setConfirming(false);
      });
  };

  if (result?.status === "confirmed") {
    const passPath = result.pass_url && result.pass_url.startsWith("/") ? result.pass_url : result.access_token ? `/pass/${result.access_token}` : null;
    return (
      <div style={{ maxWidth: "34rem", margin: "0 auto" }}>
        <p className="kicker">Locked in</p>
        <h1>You are booked.</h1>
        <div className="notice ok">
          <h3>Session confirmed — free</h3>
          <p>
            No charge, no card — payments are disabled in this preview. Your session pass is ready:
          </p>
        </div>
        {passPath && (
          <button type="button" className="btn btn-ok" onClick={() => navigate(passPath)} style={{ width: "100%" }}>
            Open my session pass
          </button>
        )}
        <div className="spacer" />
        <p className="small muted">
          Booking reference <span className="mono">{result.booking_id}</span>. Email is mocked in this
          preview — your pass URL is shown on screen.
        </p>
      </div>
    );
  }

  if (result?.status === "expired") {
    return (
      <div style={{ maxWidth: "34rem", margin: "0 auto" }}>
        <p className="kicker">Hold expired</p>
        <h1>This hold expired.</h1>
        <p className="lede">Holds last 15 minutes. Pick a new time and we will hold it again — still free.</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate("/")}>
          Start a new booking
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "34rem", margin: "0 auto" }}>
      <p className="kicker">Lock in your slot</p>
      <h1>Almost done</h1>

      <div className="notice">
        <h3>Payments are disabled in this preview</h3>
        <p>
          There is no checkout, no card form, and no charge. Locking in your slot is completely free —
          this is a demo booking on synthetic data.
        </p>
      </div>

      {loading && <div className="skeleton" style={{ minHeight: 120 }} />}
      {loadError && (
        <div className="alert-error">
          {loadError}
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {booking && !loading && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Your hold</h3>
          <ul className="review-list">
            <li><span className="k">Name</span><span className="v">{booking.client_name ?? "—"}</span></li>
            {booking.booking_date && (
              <li><span className="k">Date</span><span className="v">{formatLongDate(booking.booking_date)}</span></li>
            )}
            {booking.time_slot && (
              <li><span className="k">Time</span><span className="v">{booking.time_slot} (Chicago)</span></li>
            )}
            <li><span className="k">Status</span><span className="v">{booking.status}</span></li>
            <li><span className="k">Price</span><span className="v">Free (preview)</span></li>
          </ul>

          {booking.status === "pending" && (
            <>
              {confirmError && <div className="alert-error">{confirmError}</div>}
              <div className="btn-row">
                <button type="button" className="btn btn-primary" disabled={confirming || !secret} onClick={lockIn}>
                  {confirming ? "Locking in…" : "Lock In My Slot (Free)"}
                </button>
              </div>
              {!secret && (
                <p className="small muted" style={{ marginTop: "0.8rem" }}>
                  This link is missing its hold secret (<span className="mono">?s=</span>). Open the full link
                  from your booking confirmation.
                </p>
              )}
            </>
          )}
          {booking.status === "confirmed" && (
            <p className="small">This slot is already locked in.</p>
          )}
          {booking.status === "expired" && (
            <>
              <p className="small">This hold has expired.</p>
              <button type="button" className="btn btn-ghost" onClick={() => navigate("/")}>
                Book a new slot
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
