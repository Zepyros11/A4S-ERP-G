/* ============================================================
   events-api.js — API layer for Event Module
============================================================ */

function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

async function sbFetch(table, query = "", opts = {}) {
  const { url, key } = getSB();
  const { method = "GET", body } = opts;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer:
        method === "POST" || method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "API Error");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

/* ── EVENTS ── */
export async function fetchEvents() {
  return sbFetch("events", "?select=*&order=event_date.desc") || [];
}

export async function fetchEventById(id) {
  const res = await sbFetch("events", `?event_id=eq.${id}&select=*`);
  return res?.[0] || null;
}

export async function createEvent(data) {
  const res = await sbFetch("events", "", { method: "POST", body: data });
  return res?.[0];
}

export async function updateEvent(id, data) {
  return sbFetch("events", `?event_id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
}

export async function removeEvent(id) {
  return sbFetch("events", `?event_id=eq.${id}`, { method: "DELETE" });
}

/* ── USERS ── */
export async function fetchUsers() {
  return (
    sbFetch(
      "users",
      "?select=user_id,full_name,username&is_active=eq.true&order=full_name",
    ) || []
  );
}

/* ── EVENT LOGS ── */
export async function fetchEventLogs(eventId) {
  return (
    sbFetch(
      "event_logs",
      `?event_id=eq.${eventId}&select=*,users(full_name)&order=created_at.desc`,
    ) || []
  );
}

export async function createEventLog(data) {
  const res = await sbFetch("event_logs", "", { method: "POST", body: data });
  return res?.[0];
}

/* ── UPLOAD POSTER ── */
export async function uploadEventPoster(eventId, file) {
  const { url, key } = getSB();
  const ext = file.name.split(".").pop().toLowerCase();
  const fileName = `${eventId}_poster_${Date.now()}.${ext}`;
  const uploadPath = `posters/${fileName}`;

  const uploadRes = await fetch(
    `${url}/storage/v1/object/event-files/${uploadPath}`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": file.type,
        "x-upsert": "true",
      },
      body: file,
    },
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.message || "Upload failed");
  }

  return `${url}/storage/v1/object/public/event-files/${uploadPath}`;
}

/* ── NOTIFICATIONS ── */
export async function createNotification(data) {
  return sbFetch("notifications", "", { method: "POST", body: data });
}

export async function fetchNotifications(userId) {
  return (
    sbFetch(
      "notifications",
      `?user_id=eq.${userId}&order=created_at.desc&limit=20`,
    ) || []
  );
}

export async function markNotifRead(notifId) {
  return sbFetch("notifications", `?notif_id=eq.${notifId}`, {
    method: "PATCH",
    body: { is_read: true },
  });
}

export async function markAllNotifsRead(userId) {
  return sbFetch("notifications", `?user_id=eq.${userId}&is_read=eq.false`, {
    method: "PATCH",
    body: { is_read: true },
  });
}

/* ── PLACES ── */
export async function fetchPlaces() {
  return sbFetch("places", "?select=*&order=place_name.asc") || [];
}

export async function fetchPlaceById(id) {
  const res = await sbFetch("places", `?place_id=eq.${id}&select=*`);
  return res?.[0] || null;
}

export async function createPlace(data) {
  const res = await sbFetch("places", "", { method: "POST", body: data });
  return res?.[0];
}

export async function updatePlace(id, data) {
  return sbFetch("places", `?place_id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
}

export async function removePlace(id) {
  return sbFetch("places", `?place_id=eq.${id}`, { method: "DELETE" });
}

/* ── EVENT CATEGORIES ── */
export async function fetchEventCategories() {
  return (
    sbFetch(
      "event_categories",
      "?select=*&order=sort_order.asc,category_name.asc",
    ) || []
  );
}
