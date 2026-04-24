/* ============================================================
   A4S-ERP — Staff notification helper (LINE)
   --------------------------------------------------------------
   Reads notification_rules → resolves staff targets → sends via
   LineAPI.multicast → logs to notification_log.

   Usage:
     window.Notify.evaluateRules('event.request.approved', {
       event_name: '...', event_date: '...', requester: '...',
       request_id: 123,
     });

   Fire-and-forget (won't throw) — errors get logged, never block caller.
   ============================================================ */

(function () {
  const SB = () => ({
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  });

  async function _sbGet(path) {
    const { url, key } = SB();
    if (!url || !key) throw new Error("sb_url/sb_key missing");
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`sb ${res.status}: ${await res.text().catch(() => "")}`);
    return res.json();
  }

  async function _sbPost(path, body) {
    const { url, key } = SB();
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`sb ${res.status}: ${await res.text().catch(() => "")}`);
    return true;
  }

  /* ── Template render: {{key}} → payload[key], missing → '' ── */
  function renderTemplate(template, payload) {
    if (!template) return "";
    return String(template).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
      const v = payload?.[key];
      return v == null ? "" : String(v);
    });
  }

  /* ── Resolve rule target → list of users ({user_id, line_user_id, full_name}) ── */
  async function resolveTargets(rule) {
    const type = rule.target_type;
    const values = Array.isArray(rule.target_value) ? rule.target_value : [];
    if (!values.length) return [];

    let filter = "";
    if (type === "role") {
      const list = values.map((v) => encodeURIComponent(v)).join(",");
      filter = `role=in.(${list})`;
    } else if (type === "dept") {
      // reserved: users table doesn't have dept_id yet — skip for now (return [])
      return [];
    } else if (type === "group") {
      // users.notification_groups is TEXT[] — use overlap (&&) via 'ov' op
      // PostgREST array overlap: notification_groups=ov.{val1,val2}
      const list = values.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(",");
      filter = `notification_groups=ov.{${list}}`;
    } else if (type === "user") {
      const ids = values.filter((v) => v != null).join(",");
      if (!ids) return [];
      filter = `user_id=in.(${ids})`;
    } else {
      return [];
    }

    const rows = await _sbGet(
      `users?select=user_id,full_name,line_user_id,is_active&is_active=eq.true&line_user_id=not.is.null&${filter}`,
    );
    return rows || [];
  }

  /* ── Log a delivery attempt (1 row per recipient) ── */
  async function _log(entries) {
    if (!entries || !entries.length) return;
    try {
      await _sbPost("notification_log", entries);
    } catch (e) {
      console.warn("[Notify] log insert failed", e.message);
    }
  }

  /* ── Main: evaluate all active rules for a trigger ── */
  async function evaluateRules(triggerKey, payload) {
    try {
      if (!triggerKey) return;
      const rules = await _sbGet(
        `notification_rules?select=*&is_active=eq.true&trigger_key=eq.${encodeURIComponent(triggerKey)}`,
      );
      if (!rules?.length) return;

      for (const rule of rules) {
        await _runRule(rule, triggerKey, payload || {});
      }
    } catch (e) {
      console.warn("[Notify] evaluateRules error", e.message);
    }
  }

  async function _runRule(rule, triggerKey, payload) {
    const logBase = {
      rule_id: rule.id,
      trigger_key: triggerKey,
      payload_ref: payload,
    };

    // 1) Resolve channel
    let channel;
    try {
      if (rule.channel_id) {
        channel = await window.LineAPI.getChannel(rule.channel_id);
      }
      if (!channel) {
        channel = await window.LineAPI.getDefaultChannel("announcement");
      }
      if (!channel) {
        await _log([{ ...logBase, status: "skipped", error: "no channel" }]);
        return;
      }
    } catch (e) {
      await _log([{ ...logBase, status: "failed", error: "channel: " + e.message }]);
      return;
    }

    // 2) Resolve recipients
    let targets;
    try {
      targets = await resolveTargets(rule);
    } catch (e) {
      await _log([{ ...logBase, status: "failed", error: "resolve: " + e.message }]);
      return;
    }
    if (!targets.length) {
      await _log([{ ...logBase, status: "skipped", error: "no recipients" }]);
      return;
    }

    const lineIds = targets.map((t) => t.line_user_id).filter(Boolean);
    if (!lineIds.length) {
      await _log([{ ...logBase, status: "skipped", error: "no line_user_id on targets" }]);
      return;
    }

    // 3) Render + send (multicast up to 500)
    const text = renderTemplate(rule.message_template, payload);
    try {
      // chunk at 500
      for (let i = 0; i < lineIds.length; i += 500) {
        const chunk = lineIds.slice(i, i + 500);
        await window.LineAPI.multicast({ channel, to: chunk, message: text });
      }
      const logs = targets.map((t) => ({
        ...logBase,
        recipient_user_id: t.user_id,
        recipient_line_id: t.line_user_id,
        channel_id: channel.id,
        status: t.line_user_id ? "sent" : "skipped",
      }));
      await _log(logs);
    } catch (e) {
      const logs = targets.map((t) => ({
        ...logBase,
        recipient_user_id: t.user_id,
        recipient_line_id: t.line_user_id,
        channel_id: channel.id,
        status: "failed",
        error: e.message,
      }));
      await _log(logs);
    }
  }

  /* ── Manual test helper (callable from console) ── */
  async function previewTargets(rule) {
    return resolveTargets(rule);
  }

  window.Notify = {
    evaluateRules,
    renderTemplate,
    resolveTargets,
    previewTargets,
  };
})();
