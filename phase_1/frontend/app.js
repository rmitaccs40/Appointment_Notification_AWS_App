// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);

function setStatus(el, type, msg) {
  el.className = `status ${type || "muted"}`;
  el.textContent = msg;
}

function safeText(v) {
  return (v === null || v === undefined) ? "" : String(v);
}

function normalizeSlot(raw) {
  // Try to handle different lambda response shapes
  // Expected attributes in your report: appointmentId, appointmentDate, appointmentTime, status
  return {
    appointmentId: raw.appointmentId ?? raw.id ?? raw.slotId ?? raw.pk ?? "",
    appointmentDate: raw.appointmentDate ?? raw.date ?? "",
    appointmentTime: raw.appointmentTime ?? raw.time ?? "",
    status: raw.status ?? raw.slotStatus ?? "UNKNOWN",
  };
}

function matchesFilters(slot, dateValue, searchValue) {
  if (dateValue) {
    if (slot.appointmentDate !== dateValue) return false;
  }
  if (searchValue) {
    const hay = `${slot.appointmentDate} ${slot.appointmentTime} ${slot.appointmentId} ${slot.status}`.toLowerCase();
    if (!hay.includes(searchValue.toLowerCase())) return false;
  }
  return true;
}

function badgeClass(status) {
  const s = (status || "").toUpperCase();
  if (s === "AVAILABLE") return "available";
  if (s === "PENDING") return "pending";
  return "na";
}

// ---------- API ----------
const apiBaseUrl = window.APP_CONFIG?.apiBaseUrl?.replace(/\/$/, "");
if (!apiBaseUrl || apiBaseUrl.includes("REPLACE_WITH")) {
  console.warn("Set your API base URL in config.js");
}

async function apiGetSlots() {
  const url = `${apiBaseUrl}/appointment-slot`;
  const res = await fetch(url, { method: "GET" });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`GET /appointment-slot failed (${res.status}). ${t}`);
  }

  // Lambda might return { slots: [...] } or just [...]
  const data = await res.json();
  const arr = Array.isArray(data) ? data : (data.slots ?? data.items ?? []);
  return arr.map(normalizeSlot);
}

async function apiBookAppointment(payload) {
  const url = `${apiBaseUrl}/book-appointment`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`POST /book-appointment failed (${res.status}). ${t}`);
  }
  return await res.json().catch(() => ({}));
}

// ---------- UI State ----------
let allSlots = [];
let selected = null;

function renderSlots() {
  const wrap = $("slotsWrap");
  wrap.innerHTML = "";

  const dateVal = $("dateFilter").value;
  const searchVal = $("searchFilter").value.trim();

  const filtered = allSlots
    .filter(s => matchesFilters(s, dateVal, searchVal))
    // show AVAILABLE first, then by date/time
    .sort((a, b) => {
      const rank = (x) => (String(x.status).toUpperCase() === "AVAILABLE" ? 0 : 1);
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      const ad = `${a.appointmentDate} ${a.appointmentTime}`;
      const bd = `${b.appointmentDate} ${b.appointmentTime}`;
      return ad.localeCompare(bd);
    });

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "status muted";
    empty.textContent = "No slots match your filter.";
    wrap.appendChild(empty);
    return;
  }

  for (const slot of filtered) {
    const row = document.createElement("div");
    row.className = "slot";

    const meta = document.createElement("div");
    meta.className = "meta";

    const date = document.createElement("div");
    date.className = "date";
    date.textContent = `${safeText(slot.appointmentDate)} ${safeText(slot.appointmentTime)}`;

    const id = document.createElement("div");
    id.className = "id";
    id.textContent = `ID: ${safeText(slot.appointmentId)}`;

    meta.appendChild(date);
    meta.appendChild(id);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "10px";
    right.style.alignItems = "center";

    const badge = document.createElement("span");
    badge.className = `badge ${badgeClass(slot.status)}`;
    badge.textContent = safeText(slot.status).toUpperCase();

    const btn = document.createElement("button");
    btn.className = "btn secondary";
    btn.textContent = "Select";
    btn.disabled = String(slot.status).toUpperCase() !== "AVAILABLE";
    btn.addEventListener("click", () => selectSlot(slot));

    right.appendChild(badge);
    right.appendChild(btn);

    row.appendChild(meta);
    row.appendChild(right);

    wrap.appendChild(row);
  }
}

function selectSlot(slot) {
  selected = slot;
  $("selectedSlot").value = `${slot.appointmentDate} ${slot.appointmentTime} (ID: ${slot.appointmentId})`;
  $("bookBtn").disabled = false;
  setStatus($("formMsg"), "muted", "Ready to submit booking.");
}

// ---------- Actions ----------
async function loadSlots() {
  const bar = $("statusBar");
  setStatus(bar, "muted", "Loading slots…");

  try {
    if (!apiBaseUrl || apiBaseUrl.includes("REPLACE_WITH")) {
      throw new Error("API base URL not set. Edit config.js and set apiBaseUrl.");
    }

    allSlots = await apiGetSlots();

    // Optional: if your lambda returns all slots, we can still show only AVAILABLE as selectable
    const availableCount = allSlots.filter(s => String(s.status).toUpperCase() === "AVAILABLE").length;

    setStatus(bar, "ok", `Loaded ${allSlots.length} slots (${availableCount} available).`);
    renderSlots();
  } catch (err) {
    console.error(err);
    setStatus(bar, "err", err.message || "Failed to load slots.");
    allSlots = [];
    renderSlots();
  }
}

async function submitBooking(e) {
  e.preventDefault();

  const msg = $("formMsg");
  if (!selected) {
    setStatus(msg, "warn", "Please select an AVAILABLE slot first.");
    return;
  }

  const patientName = $("patientName").value.trim();
  const patientEmail = $("patientEmail").value.trim();
  const notes = $("notes").value.trim();

  if (!patientName || !patientEmail) {
    setStatus(msg, "warn", "Name and Email are required.");
    return;
  }

  // Payload aligned with report’s DynamoDB attributes:
  // - appointmentId identifies the slot
  // - patientEmail is stored later upon booking
  // - status becomes PENDING in the backend
  const payload = {
    appointmentId: selected.appointmentId,
    appointmentDate: selected.appointmentDate,
    appointmentTime: selected.appointmentTime,
    patientName,
    patientEmail,
    notes
  };

  setStatus(msg, "muted", "Submitting booking…");
  $("bookBtn").disabled = true;

  try {
    const result = await apiBookAppointment(payload);

    // Best effort display based on possible responses
    const bookingStatus = (result.status || result.bookingStatus || "PENDING").toUpperCase();
    const message =
      result.message ||
      `Booking submitted. Current status: ${bookingStatus}.`;

    setStatus(msg, "ok", message);

    // Refresh slots after booking (backend should mark slot as PENDING / not AVAILABLE)
    selected = null;
    $("selectedSlot").value = "";
    $("bookingForm").reset();
    $("bookBtn").disabled = true;

    await loadSlots();
  } catch (err) {
    console.error(err);
    setStatus(msg, "err", err.message || "Booking failed.");
    $("bookBtn").disabled = false;
  }
}

// ---------- Wire up ----------
window.addEventListener("DOMContentLoaded", () => {
  $("refreshBtn").addEventListener("click", loadSlots);
  $("dateFilter").addEventListener("input", renderSlots);
  $("searchFilter").addEventListener("input", renderSlots);
  $("bookingForm").addEventListener("submit", submitBooking);

  loadSlots();
});