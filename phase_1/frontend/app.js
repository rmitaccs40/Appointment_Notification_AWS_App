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
  // Performance optimizations: cache current time and shared parsing
  let currentTime = new Date();
  let lastTimeUpdate = Date.now();
  let filteredSlotsCache = null;
  let lastFilterState = null;
  const activeToasts = new Set();
  let globalListenersAttached = false;

  function getCurrentTime() {
    const now = Date.now();
    if (now - lastTimeUpdate > 1000) { // Update every second
      currentTime = new Date(now);
      lastTimeUpdate = now;
    }
    return currentTime;
  }

  function parseTimeString(timeStr) {
    const match = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return null;
    
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();
    
    if (ampm === "AM") {
      if (hours === 12) hours = 0;
    } else {
      if (hours !== 12) hours += 12;
    }
    
    return { hours, minutes };
  }

  function debounce(func, delay) {
    let timeoutId;
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  }

  function clearFilterCache() {
    filteredSlotsCache = null;
    lastFilterState = null;
  }

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

  function isAppointmentInPast(dateStr, timeStr) {
    if (!dateStr || !timeStr) return false;
    
    const parsed = parseTimeString(timeStr);
    if (!parsed) return false;
    
    // Parse date string manually to avoid UTC interpretation issues
    const dateParts = dateStr.split('-');
    if (dateParts.length !== 3) return false;
    
    const year = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1; // month is 0-indexed
    const day = parseInt(dateParts[2], 10);
    
    // Create appointment date object in LOCAL time
    const appointmentDateTime = new Date(year, month, day, parsed.hours, parsed.minutes, 0, 0);
    const now = getCurrentTime();
    
    // Inclusive comparison: appointments at current time are considered past
    const isPast = appointmentDateTime.getTime() <= now.getTime();
    
    // Debug logging when debug panel is open
    if (state.debugOpen) {
      console.log(`[Debug] Appointment ${dateStr} ${timeStr}:`, {
        localNow: now.toISOString(),
        appointmentLocal: appointmentDateTime.toISOString(),
        filteredOut: isPast
      });
    }
    
    return isPast;
  }

  function toast(title, detail) {
    const node = document.createElement("div");
    node.className = "toast";
    node.innerHTML = `<div>${escapeHtml(title)}</div>${detail ? `<div class="muted">${escapeHtml(detail)}</div>` : ""}`;
    
    els.toastHost.appendChild(node);
    activeToasts.add(node);
    
    const cleanup = () => {
      if (activeToasts.has(node)) {
        activeToasts.delete(node);
        node.remove();
      }
    };
    
    setTimeout(cleanup, 4200);
    
    // Allow manual dismissal
    node.addEventListener('click', cleanup);
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
    const parsed = parseTimeString(t);
    return parsed ? parsed.hours * 60 + parsed.minutes : Number.POSITIVE_INFINITY;
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
    const currentFilterState = `${date}|${time}|${slots.length}|${getCurrentTime().getTime()}`;
    
    // Return cached result if filters haven't changed
    if (filteredSlotsCache && lastFilterState === currentFilterState) {
      return filteredSlotsCache;
    }
    
    filteredSlotsCache = slots.filter((s) => {
      // Always filter out past appointments (date + time)
      if (isAppointmentInPast(s.appointmentDate, s.appointmentTime)) return false;
      if (date && s.appointmentDate !== date) return false;
      if (time && s.appointmentTime !== time) return false;
      return true;
    });
    
    lastFilterState = currentFilterState;
    return filteredSlotsCache;
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
  async function safeFetch(url, options, context = 'API call') {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      console.error(`${context} failed:`, error);
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Network error. Please check your connection.');
      }
      throw error;
    }
  }

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

    const res = await safeFetch(endpoints.slots, {
      method: "GET",
      cache: "no-store",
      headers: { "Accept": "application/json" },
    }, 'Fetch slots');

    clearFilterCache(); // Clear cache when new data arrives

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

    const res = await safeFetch(endpoints.book, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload),
    }, 'Book appointment');

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
    clearFilterCache(); // Clear cache when date filter changes
    renderTimeOptions(base);
    renderSlots();
  }

  function onTimeChange() {
    clearFilterCache(); // Clear cache when time filter changes
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

  const debouncedPersistPatient = debounce(persistPatient, 300);

  function persistDebug() {
    saveLocal("debug", {
      showIds: !!els.debugShowIds.checked,
      showCache: !!els.debugShowCache.checked,
    });
    updateCacheUI();
    clearFilterCache(); // Clear cache when debug settings change
    renderSlots();
  }

  function attachGlobalClickClose() {
    if (globalListenersAttached) return;
    
    const handleClick = (e) => {
      if (!state.debugOpen) return;
      const target = e.target;
      const inside = els.debugPanel.contains(target) || els.debugBtn.contains(target);
      if (!inside) setDebugPanel(false);
    };
    
    const handleKeydown = (e) => {
      if (e.key === "Escape") setDebugPanel(false);
    };
    
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeydown);
    globalListenersAttached = true;
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

    els.patientName.addEventListener("input", debouncedPersistPatient);
    els.patientEmail.addEventListener("input", debouncedPersistPatient);

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
