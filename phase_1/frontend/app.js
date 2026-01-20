/* global window */
/* global fetch */
/*global localStorage*/
(() => {
  const cfg = window.APP_CONFIG || {};
  const apiBaseUrl = (cfg.apiBaseUrl || "").replace(/\/$/, "");
  const endpoints = {
    slots: `${apiBaseUrl}/appointment-slot`,
    book: `${apiBaseUrl}/book-appointment`,
  };

  const els = {
    envPill: document.getElementById("envPill"),
    refreshBtn: document.getElementById("refreshBtn"),

    patientName: document.getElementById("patientName"),
    patientEmail: document.getElementById("patientEmail"),
    patientHint: document.getElementById("patientHint"),

    dateFilter: document.getElementById("dateFilter"),
    timeFilter: document.getElementById("timeFilter"),
    resetFiltersBtn: document.getElementById("resetFiltersBtn"),
    lastUpdated: document.getElementById("lastUpdated"),
    statusText: document.getElementById("statusText"),
    slotsCount: document.getElementById("slotsCount"),
    slots: document.getElementById("slots"),

    debugBtn: document.getElementById("debugBtn"),
    debugPanel: document.getElementById("debugPanel"),
    debugShowIds: document.getElementById("debugShowIds"),
    debugShowCache: document.getElementById("debugShowCache"),
    cacheStatus: document.getElementById("cacheStatus"),

    toastHost: document.getElementById("toastHost"),
  };

  

  /** ---------- helpers ---------- */
  function fmtLocal(ts = new Date()) {
    const d = ts instanceof Date ? ts : new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function todayISO() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function isDateInPast(dateStr) {
    if (!dateStr) return false;
    return dateStr < todayISO();
  }

  function toast(title, detail) {
    const node = document.createElement("div");
    node.className = "toast";
    node.innerHTML = `<div>${escapeHtml(title)}</div>${detail ? `<div class="muted">${escapeHtml(detail)}</div>` : ""}`;
    els.toastHost.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function saveLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
  }
  function loadLocal(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch { return fallback; }
  }

  function isValidEmail(email) {
    // Simple but practical email check for a student project UI
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
  }

  function getPatient() {
    return {
      name: (els.patientName.value || "").trim(),
      email: (els.patientEmail.value || "").trim(),
    };
  }

  function updatePatientHint() {
    const { name, email } = getPatient();
    if (!name && !email) {
      els.patientHint.textContent = "";
      return;
    }
    if (!name) {
      els.patientHint.textContent = "Please enter your full name to book an appointment.";
      return;
    }
    if (!isValidEmail(email)) {
      els.patientHint.textContent = "Please enter a valid email address to book an appointment.";
      return;
    }
    els.patientHint.textContent = "";
  }

  function canBook() {
    const { name, email } = getPatient();
    return Boolean(name) && isValidEmail(email);
  }

  function setStatus(msg) {
    els.statusText.textContent = msg;
  }

  function setLoading(isLoading) {
  state.loading = isLoading;

  els.refreshBtn.disabled = isLoading;
  els.resetFiltersBtn.disabled = isLoading;

  // Optional UI feedback
  els.refreshBtn.textContent = isLoading ? "Loading…" : "Refresh";
}

  /** ---------- state ---------- */
const state = {
  allSlots: [],
  xCache: null,
  debugOpen: false,
  loading: false,
};

  /** ---------- debug panel ---------- */
  function setDebugPanel(open) {
    state.debugOpen = open;
    els.debugPanel.hidden = !open;
    els.debugBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) {
      // keep cache status hidden if toggle is off
      if (!els.debugShowCache.checked) els.cacheStatus.hidden = true;
    } else {
      if (els.debugShowCache.checked) els.cacheStatus.hidden = false;
    }
  }

  function updateCacheUI() {
    // Cache UI should ONLY appear when "Show cache status" is enabled.
    if (els.debugShowCache.checked) {
      els.cacheStatus.hidden = false;
      els.cacheStatus.textContent = `Cache: ${state.xCache || "—"}`;
    } else {
      els.cacheStatus.hidden = true;
    }
  }

  /** ---------- rendering ---------- */
  function timeToMinutes(t) {
    // expects formats like "09:00 AM", "12:00 PM"
    const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return Number.POSITIVE_INFINITY; // push unknown formats to the end

    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ampm = m[3].toUpperCase();

    // 12 AM = 0, 12 PM = 12
    if (ampm === "AM") {
      if (hh === 12) hh = 0;
    } else { // PM
      if (hh !== 12) hh += 12;
    }
    return hh * 60 + mm;
  }

  function uniqueTimes(slots) {
    const set = new Set();
    for (const s of slots) if (s.appointmentTime) set.add(s.appointmentTime);

    return Array.from(set).sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
  }

  function renderTimeOptions(slotsForTime) {
    const current = els.timeFilter.value;
    const times = uniqueTimes(slotsForTime);

    // Keep first option, rebuild rest
    els.timeFilter.innerHTML = `<option value="">Any time</option>` +
      times.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");

    // restore current if possible
    if (current && times.includes(current)) els.timeFilter.value = current;
    else els.timeFilter.value = "";
  }

  function applyFilters(slots) {
    const date = els.dateFilter.value; // yyyy-mm-dd
    const time = els.timeFilter.value;

    return slots.filter((s) => {
      // Always filter out past dates
      if (isDateInPast(s.appointmentDate)) return false;
      if (date && s.appointmentDate !== date) return false;
      if (time && s.appointmentTime !== time) return false;
      return true;
    });
  }

  function renderSlots() {
    const filtered = applyFilters(state.allSlots);
    els.slotsCount.textContent = `Showing ${filtered.length} slot${filtered.length === 1 ? "" : "s"}`;

    if (!state.allSlots.length) {
      els.slots.innerHTML = "";
      setStatus("No slots returned from the API.");
      return;
    }

    if (!filtered.length) {
      els.slots.innerHTML = "";
      setStatus("No slots match the selected filters.");
      return;
    }

    setStatus("Loaded.");
    const showIds = Boolean(els.debugShowIds.checked);
    const bookEnabled = canBook();

    els.slots.innerHTML = filtered.map((s) => {
      const dt = `${s.appointmentDate} • ${s.appointmentTime}`;
      const idLine = showIds ? `<div class="slot-meta"><div>appointmentId</div><code>${escapeHtml(s.appointmentId || "")}</code></div>` : "";
      return `
        <div class="slot">
          <div class="slot-top">
            <div>
              <div class="slot-dt">${escapeHtml(dt)}</div>
              <div class="slot-meta">AVAILABLE</div>
            </div>
            <div class="badge">Available</div>
          </div>

          ${idLine}

          <button class="btn btn-primary" data-appointment-id="${escapeHtml(s.appointmentId || "")}" ${bookEnabled ? "" : "disabled"}>
            Book
          </button>
        </div>
      `;
    }).join("");

    // attach listeners
    els.slots.querySelectorAll("button[data-appointment-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const apptId = btn.getAttribute("data-appointment-id");
        if (!apptId) return;

        if (!canBook()) {
          toast("Missing patient details", "Please enter a valid name and email.");
          updatePatientHint();
          return;
        }

        btn.disabled = true;
        btn.textContent = "Booking…";
        try {
          await bookAppointment(apptId);
          toast("Booking submitted", "Refreshing available slots…");
          await fetchSlots();
        } catch (err) {
          toast("Booking failed", err?.message || "Unexpected error");
          btn.disabled = false;
          btn.textContent = "Book";
        }
      });
    });
  }

  /** ---------- network ---------- */
async function fetchSlots() {
  if (state.loading) return;

  if (!apiBaseUrl) {
    setStatus("Missing API base URL. Please update config.js.");
    return;
  }

  setLoading(true);
  try {
    setStatus("Loading…");
    els.slots.innerHTML = "";

    const res = await fetch(endpoints.slots, {
      method: "GET",
      cache: "no-store",
      headers: { "Accept": "application/json" },
    });

    state.xCache = res.headers.get("x-cache") || res.headers.get("X-Cache");
    // fallback so UI is clearer when CORS expose is missing:
    if (!state.xCache) state.xCache = "NOT_EXPOSED_BY_CORS";

    updateCacheUI();

    if (els.debugShowCache.checked) {
      toast("Slots refreshed", `Cache: ${state.xCache || "—"}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Slots API error: ${res.status} ${res.statusText}${text ? " - " + text : ""}`);
    }

    const data = await res.json();
    state.allSlots = Array.isArray(data) ? data : [];

    state.allSlots.sort((a, b) => {
      const d = String(a.appointmentDate || "").localeCompare(String(b.appointmentDate || ""));
      if (d !== 0) return d;
      return timeToMinutes(a.appointmentTime) - timeToMinutes(b.appointmentTime);
    });

    els.envPill.textContent = apiBaseUrl.includes("/prod") ? "PROD" : "DEV";
    els.lastUpdated.textContent = `Last updated: ${fmtLocal(new Date())}`;

    const date = els.dateFilter.value;
    const baseForTimes = date ? state.allSlots.filter(s => s.appointmentDate === date) : state.allSlots;
    renderTimeOptions(baseForTimes);

    renderSlots();
  } finally {
    setLoading(false);
  }
}

  async function bookAppointment(appointmentId) {
    const { name, email } = getPatient();

    const payload = {
      appointmentId,
      patientName: name,
      patientEmail: email,
    };

    const res = await fetch(endpoints.book, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Book API error: ${res.status} ${res.statusText}${text ? " - " + text : ""}`);
    }

    // Some setups return no body; treat ok as success
    await res.text().catch(() => "");
  }

  /** ---------- events ---------- */
  function onDateChange() {
    // rebuild time options based on date
    const date = els.dateFilter.value;
    const base = date ? state.allSlots.filter(s => s.appointmentDate === date) : state.allSlots;
    renderTimeOptions(base);
    renderSlots();
  }

  function onTimeChange() {
    renderSlots();
  }

  async function onResetFilters() {
    els.resetFiltersBtn.disabled = true;

    els.dateFilter.value = "";
    els.timeFilter.value = "";

    await fetchSlots(); // ONE refresh, includes toast + cache info

    els.resetFiltersBtn.disabled = false;
  }

  function persistPatient() {
    const { name, email } = getPatient();
    saveLocal("patientDetails", { name, email });
    updatePatientHint();
    // refresh button states
    els.slots.querySelectorAll("button[data-appointment-id]").forEach((btn) => {
      btn.disabled = !canBook();
    });
  }

  function persistDebug() {
    saveLocal("debug", {
      showIds: !!els.debugShowIds.checked,
      showCache: !!els.debugShowCache.checked,
    });
    updateCacheUI();
    renderSlots();
  }

  function attachGlobalClickClose() {
    document.addEventListener("click", (e) => {
      if (!state.debugOpen) return;
      const target = e.target;
      const inside = els.debugPanel.contains(target) || els.debugBtn.contains(target);
      if (!inside) setDebugPanel(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setDebugPanel(false);
    });
  }

  /** ---------- init ---------- */
  function init() {
    // restore patient
    const saved = loadLocal("patientDetails", null);
    if (saved?.name) els.patientName.value = saved.name;
    if (saved?.email) els.patientEmail.value = saved.email;

    // restore debug
    const debug = loadLocal("debug", { showIds: false, showCache: false });
    els.debugShowIds.checked = !!debug.showIds;
    els.debugShowCache.checked = !!debug.showCache;

    // Set date filter to today by default
    els.dateFilter.value = todayISO();

    updatePatientHint();
    updateCacheUI();

    els.refreshBtn.addEventListener("click", () => fetchSlots().catch((e) => toast("Refresh failed", e.message)));
    els.dateFilter.addEventListener("change", onDateChange);
    els.timeFilter.addEventListener("change", onTimeChange);
    els.resetFiltersBtn.addEventListener("click", onResetFilters);

    els.patientName.addEventListener("input", persistPatient);
    els.patientEmail.addEventListener("input", persistPatient);

    els.debugBtn.addEventListener("click", () => setDebugPanel(!state.debugOpen));
    els.debugShowIds.addEventListener("change", persistDebug);
    els.debugShowCache.addEventListener("change", persistDebug);

    attachGlobalClickClose();

    fetchSlots().catch((e) => {
      setStatus("Failed to load slots.");
      toast("Slots load failed", e.message);
    });
  }

  init();
})();
