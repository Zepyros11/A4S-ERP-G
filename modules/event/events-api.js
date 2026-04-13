/* ============================================================
   events-api.js — API layer for Event Module
============================================================ */

const SB_URL_DEFAULT = "https://dtiynydgkcqausqktreg.supabase.co";
const SB_KEY_DEFAULT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE";

function getSB() {
  const storedKey = localStorage.getItem("sb_key") || "";
  const isValidKey = storedKey.startsWith("eyJ") && storedKey.length > 100;
  return {
    url: localStorage.getItem("sb_url") || SB_URL_DEFAULT,
    key: isValidKey ? storedKey : SB_KEY_DEFAULT,
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

/* ── PLACE TYPES ── */
export async function fetchPlaceTypes() {
  return sbFetch("place_types", "?select=*&order=sort_order.asc") || [];
}

export async function createPlaceType(data) {
  const res = await sbFetch("place_types", "", { method: "POST", body: data });
  return res?.[0];
}

export async function updatePlaceType(id, data) {
  return sbFetch("place_types", `?type_id=eq.${id}`, { method: "PATCH", body: data });
}

export async function removePlaceType(id) {
  return sbFetch("place_types", `?type_id=eq.${id}`, { method: "DELETE" });
}

/* ── PLACE ROOM TYPES (accommodation) ── */
export async function fetchPlaceRoomTypes(placeId) {
  return sbFetch("place_room_types", `?place_id=eq.${placeId}&select=*&order=sort_order.asc`) || [];
}

export async function upsertPlaceRoomTypes(placeId, items) {
  await sbFetch("place_room_types", `?place_id=eq.${placeId}`, { method: "DELETE" });
  if (!items || items.length === 0) return [];
  const payload = items.map((r, i) => ({ ...r, place_id: placeId, sort_order: i }));
  return sbFetch("place_room_types", "", { method: "POST", body: payload }) || [];
}

/* ── PLACE ROOMS ── */
export async function fetchPlaceRooms(placeId) {
  return sbFetch("place_rooms", `?place_id=eq.${placeId}&select=*&order=room_name.asc`) || [];
}

export async function fetchAllPlaceRooms() {
  return sbFetch("place_rooms", "?select=*&order=room_name.asc") || [];
}

export async function upsertPlaceRooms(placeId, rooms) {
  // ลบห้องเดิมทั้งหมดแล้ว insert ใหม่
  await sbFetch("place_rooms", `?place_id=eq.${placeId}`, { method: "DELETE" });
  if (!rooms || rooms.length === 0) return [];
  const payload = rooms.map((r) => ({ ...r, place_id: placeId }));
  return sbFetch("place_rooms", "", { method: "POST", body: payload }) || [];
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
