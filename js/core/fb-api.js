/* ============================================================
   A4S-ERP — Facebook Page Graph API client
   --------------------------------------------------------------
   - Fetches fb_pages from Supabase (fb_pages table)
   - Schedules / edits / cancels FB Page posts via Graph API
   - Uses native FB scheduled_publish_time (no cron on our side)

   localStorage keys used:
     sb_url / sb_key  — Supabase REST endpoint + anon key

   Use case: ขับเคลื่อนหน้า media-schedule.html (Tab "FB Schedule")
   ============================================================ */

(function () {
  const GRAPH = "https://graph.facebook.com/v25.0";

  const SB = () => ({
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  });

  /* ── Helpers ─────────────────────────────────────────────── */
  async function _sbFetch(path, opts = {}) {
    const { url, key } = SB();
    if (!url || !key) throw new Error("sb_url / sb_key ยังไม่ตั้งค่า");
    const { method = "GET", body } = opts;
    const res = await fetch(`${url}/rest/v1/${path}`, {
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
      throw new Error(e.message || `Supabase ${res.status}`);
    }
    return method === "DELETE" ? null : res.json().catch(() => null);
  }

  /* ── Page registry (cached per session) ──────────────────── */
  let _pageCache = null;
  let _pageCacheAt = 0;
  const CACHE_TTL_MS = 60_000;

  async function loadPages(force = false) {
    const now = Date.now();
    if (!force && _pageCache && now - _pageCacheAt < CACHE_TTL_MS) {
      return _pageCache;
    }
    const rows = await _sbFetch(
      "fb_pages?is_active=eq.true&order=page_name.asc",
    );
    _pageCache = rows || [];
    _pageCacheAt = now;
    return _pageCache;
  }

  async function getPage(id) {
    const all = await loadPages();
    return all.find((p) => p.id === Number(id)) || null;
  }

  function clearPageCache() {
    _pageCache = null;
    _pageCacheAt = 0;
  }

  /* ── Graph API call wrapper ──────────────────────────────── */
  async function _graphCall(path, { method = "POST", params = {}, accessToken } = {}) {
    if (!accessToken) throw new Error("missing access_token");
    const url = `${GRAPH}/${path}`;
    let body;
    let qs = "";
    const tokenParam = `access_token=${encodeURIComponent(accessToken)}`;

    if (method === "GET") {
      const sp = new URLSearchParams(params);
      sp.set("access_token", accessToken);
      qs = `?${sp.toString()}`;
    } else if (method === "DELETE") {
      qs = `?${tokenParam}`;
    } else {
      // POST / PATCH — send as form-encoded body
      const sp = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v === null || v === undefined) return;
        sp.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      });
      sp.set("access_token", accessToken);
      body = sp.toString();
    }

    const res = await fetch(`${url}${qs}`, {
      method,
      headers:
        method === "POST" || method === "PATCH"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : undefined,
      body,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      const err = json.error || {};
      throw new Error(
        `[FB ${err.code || res.status}] ${err.message || "Graph API error"}`,
      );
    }
    return json;
  }

  /* ── Post helpers ────────────────────────────────────────── */
  // Convert Date / ISO string to FB Unix timestamp (seconds)
  function _toUnix(dt) {
    const ms = dt instanceof Date ? dt.getTime() : new Date(dt).getTime();
    return Math.floor(ms / 1000);
  }

  // FB requires scheduled_publish_time to be 10min - 6mo in future
  function _validateScheduleTime(scheduledAt) {
    const t = _toUnix(scheduledAt);
    const now = Math.floor(Date.now() / 1000);
    const min = now + 600; // 10 min
    const max = now + 60 * 60 * 24 * 30 * 6; // 6 months
    if (t < min) throw new Error("scheduled_at ต้องอยู่อนาคตอย่างน้อย 10 นาที");
    if (t > max) throw new Error("scheduled_at ต้องไม่เกิน 6 เดือนข้างหน้า");
    return t;
  }

  /**
   * Upload a single photo as unpublished — returns media_fbid
   * Used for multi-photo posts (attach to feed post)
   */
  async function _uploadUnpublishedPhoto(pageIdFb, accessToken, photoUrl) {
    const json = await _graphCall(`${pageIdFb}/photos`, {
      method: "POST",
      accessToken,
      params: { url: photoUrl, published: false, temporary: false },
    });
    return json.id; // media_fbid
  }

  /**
   * Schedule a FB Page post.
   * Returns: { fb_published_id, fb_post_url? }
   *
   * @param page         row จาก fb_pages (มี page_id + access_token)
   * @param payload      { caption, mediaUrls[], linkUrl, scheduledAt }
   */
  async function schedulePostOnFb(page, { caption, mediaUrls = [], linkUrl, scheduledAt }) {
    if (!page?.page_id || !page?.access_token) throw new Error("page ไม่ถูกต้อง");
    if (!caption?.trim()) throw new Error("caption ว่างไม่ได้");
    const scheduled_publish_time = _validateScheduleTime(scheduledAt);
    const accessToken = page.access_token;
    const pageIdFb = page.page_id;
    const mediaCount = mediaUrls.filter(Boolean).length;

    // Case 1: Text only (no media, no link)
    if (mediaCount === 0 && !linkUrl) {
      const json = await _graphCall(`${pageIdFb}/feed`, {
        method: "POST",
        accessToken,
        params: { message: caption, published: false, scheduled_publish_time },
      });
      return { fb_published_id: json.id };
    }

    // Case 2: Text + link (no media)
    if (mediaCount === 0 && linkUrl) {
      const json = await _graphCall(`${pageIdFb}/feed`, {
        method: "POST",
        accessToken,
        params: { message: caption, link: linkUrl, published: false, scheduled_publish_time },
      });
      return { fb_published_id: json.id };
    }

    // Case 3: Single photo
    if (mediaCount === 1) {
      const json = await _graphCall(`${pageIdFb}/photos`, {
        method: "POST",
        accessToken,
        params: {
          url: mediaUrls[0],
          caption,
          published: false,
          scheduled_publish_time,
        },
      });
      // /photos returns { id, post_id } — we want post_id (not just photo id)
      return { fb_published_id: json.post_id || json.id };
    }

    // Case 4: Multi-photo — upload each unpublished, then create feed post with attached_media
    const mediaIds = [];
    for (const u of mediaUrls.filter(Boolean)) {
      const id = await _uploadUnpublishedPhoto(pageIdFb, accessToken, u);
      mediaIds.push(id);
    }
    const attached_media = mediaIds.map((id) => ({ media_fbid: id }));
    const json = await _graphCall(`${pageIdFb}/feed`, {
      method: "POST",
      accessToken,
      params: {
        message: caption,
        attached_media,
        published: false,
        scheduled_publish_time,
      },
    });
    return { fb_published_id: json.id };
  }

  /**
   * Edit a scheduled post (caption + scheduled_at).
   * Note: FB ไม่ให้แก้ media หลัง schedule — ถ้าต้องเปลี่ยนรูป ต้อง cancel + create ใหม่
   */
  async function editScheduledPostOnFb(fbPublishedId, accessToken, { caption, scheduledAt } = {}) {
    if (!fbPublishedId) throw new Error("fb_published_id ว่าง");
    const params = {};
    if (caption !== undefined) params.message = caption;
    if (scheduledAt) params.scheduled_publish_time = _validateScheduleTime(scheduledAt);
    if (!Object.keys(params).length) return { ok: true, noop: true };
    await _graphCall(fbPublishedId, { method: "POST", accessToken, params });
    return { ok: true };
  }

  /**
   * Cancel (delete) a scheduled post on FB.
   */
  async function cancelScheduledPostOnFb(fbPublishedId, accessToken) {
    if (!fbPublishedId) throw new Error("fb_published_id ว่าง");
    await _graphCall(fbPublishedId, { method: "DELETE", accessToken });
    return { ok: true };
  }

  /* ── DB-backed wrappers (insert/update fb_scheduled_posts) ── */

  /**
   * Schedule + persist to DB.
   * Returns the inserted fb_scheduled_posts row.
   */
  async function scheduleAndSave({
    fb_page_id,           // bigint — fb_pages.id
    event_id = null,
    source_media_id = null,
    caption,
    media_urls = [],
    link_url = null,
    scheduled_at,         // ISO string
    created_by = null,
  }) {
    const page = await getPage(fb_page_id);
    if (!page) throw new Error("ไม่พบเพจ FB ใน fb_pages");

    // 1) Call FB API
    const { fb_published_id } = await schedulePostOnFb(page, {
      caption,
      mediaUrls: media_urls,
      linkUrl: link_url,
      scheduledAt: scheduled_at,
    });

    // 2) Persist
    const rows = await _sbFetch("fb_scheduled_posts", {
      method: "POST",
      body: {
        fb_page_id,
        event_id,
        source_media_id,
        caption,
        media_urls,
        link_url,
        scheduled_at,
        status: "SCHEDULED",
        fb_published_id,
        created_by,
      },
    });
    return rows?.[0];
  }

  /**
   * Edit scheduled post in both FB and DB.
   */
  async function editAndSave(postRow, { caption, scheduled_at } = {}) {
    if (!postRow?.id) throw new Error("postRow ไม่ถูกต้อง");
    const page = await getPage(postRow.fb_page_id);
    if (!page) throw new Error("ไม่พบเพจ FB");

    if (postRow.fb_published_id && postRow.status === "SCHEDULED") {
      await editScheduledPostOnFb(
        postRow.fb_published_id,
        page.access_token,
        { caption, scheduledAt: scheduled_at },
      );
    }
    const patch = {};
    if (caption !== undefined) patch.caption = caption;
    if (scheduled_at) patch.scheduled_at = scheduled_at;
    if (Object.keys(patch).length === 0) return postRow;
    const rows = await _sbFetch(`fb_scheduled_posts?id=eq.${postRow.id}`, {
      method: "PATCH",
      body: patch,
    });
    return rows?.[0];
  }

  /**
   * Cancel scheduled post in FB + mark CANCELLED in DB.
   */
  async function cancelAndSave(postRow) {
    if (!postRow?.id) throw new Error("postRow ไม่ถูกต้อง");
    const page = await getPage(postRow.fb_page_id);
    if (!page) throw new Error("ไม่พบเพจ FB");

    if (postRow.fb_published_id && postRow.status === "SCHEDULED") {
      try {
        await cancelScheduledPostOnFb(postRow.fb_published_id, page.access_token);
      } catch (e) {
        // FB อาจ delete ไปแล้วหรือ post หาย — ดำเนินต่อ + log
        console.warn("[fb-api] cancel on FB failed:", e.message);
      }
    }
    const rows = await _sbFetch(`fb_scheduled_posts?id=eq.${postRow.id}`, {
      method: "PATCH",
      body: { status: "CANCELLED" },
    });
    return rows?.[0];
  }

  /**
   * Fetch scheduled posts for an event (or all if no event_id).
   */
  async function listScheduledPosts({ event_id = null, fb_page_id = null } = {}) {
    let q = "fb_scheduled_posts?select=*&order=scheduled_at.asc";
    if (event_id != null) q += `&event_id=eq.${event_id}`;
    if (fb_page_id != null) q += `&fb_page_id=eq.${fb_page_id}`;
    return (await _sbFetch(q)) || [];
  }

  /* ── Expose ──────────────────────────────────────────────── */
  window.FbApi = {
    // page registry
    loadPages,
    getPage,
    clearPageCache,
    // raw FB calls
    schedulePostOnFb,
    editScheduledPostOnFb,
    cancelScheduledPostOnFb,
    // DB-backed
    scheduleAndSave,
    editAndSave,
    cancelAndSave,
    listScheduledPosts,
  };
})();
