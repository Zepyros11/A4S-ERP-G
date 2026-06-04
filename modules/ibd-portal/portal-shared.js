/* ============================================================
   portal-shared.js — IBD Portal: shared utilities
     • i18n (EN/FR with language toggle)
     • member auth via MLM password_hash (sha-256, ERPCrypto)
     • Supabase REST helpers (anon key)
     • Storage upload helper
     • Topbar/lang toggle render
   ============================================================ */

(function () {
  const cfg = window.PORTAL_CONFIG || {};
  const SB_URL = cfg.sb_url || '';
  const SB_KEY = cfg.sb_key || '';
  const BUCKET = cfg.storage_bucket || 'ibd-attachments';
  const PROXY  = (cfg.proxy_url || '').replace(/\/+$/, '');
  const LANG_LS_KEY = 'ibd_portal_lang';
  const SESSION_LS_KEY = 'ibd_portal_session';

  /* ── i18n strings ── */
  const I18N = {
    en: {
      brand: 'A4S — IBD Portal',
      brand_sub: 'International Business Development',
      logout: 'Logout',
      login_title: 'Member Login',
      login_sub: 'Please enter your A4S Member ID and password to continue',
      member_id: 'A4S Member ID',
      password: 'Password',
      login_btn: 'Sign In',
      login_err_no_member: 'Member ID not found',
      login_err_no_pass: 'Member has no password set — please contact admin',
      login_err_wrong: 'Incorrect password',
      home_title: 'How can we help you today?',
      home_sub: 'Choose a request type below',
      home_complaint_title: 'Service Progress & Complaints',
      home_complaint_sub: 'Follow up on pending requests or report a service issue',
      home_ewallet_title: 'Commission to E-Wallet',
      home_ewallet_sub: 'Request your commission payment into your personal E-wallet',
      home_relocation_title: 'Change Location Base',
      home_relocation_sub: 'Request to change your registered country base',
      home_my_requests_title: 'My Requests',
      home_my_requests_sub: 'Track the status of your submitted requests',
      my_title: 'My Requests',
      my_sub: 'All requests you have submitted, sorted by most recent',
      my_empty: 'You haven\'t submitted any requests yet',
      my_kind_complaint: 'Complaint',
      my_kind_ewallet: 'E-Wallet',
      my_kind_relocation: 'Relocation',
      my_status_new: 'New',
      my_status_in_progress: 'In Progress',
      my_status_resolved: 'Resolved',
      my_status_closed: 'Closed',
      my_status_pending: 'Pending',
      my_status_approved: 'Approved',
      my_status_paid: 'Paid',
      my_status_rejected: 'Rejected',
      my_submitted: 'Submitted',
      back: 'Back',
      submit: 'Submit',
      submitting: 'Submitting...',
      cancel: 'Cancel',
      required: 'This field is required',
      success_title: 'Request Submitted!',
      success_msg_complaint: 'We have received your complaint. Some cases may take 5–7 days to process; kindly be patient during this time. Thank you.',
      success_msg_ewallet: 'It will take 3–7 days to verify and approve. If it takes more than 2 weeks, kindly contact WhatsApp +66 625 684 476.',
      success_msg_relocation: 'Relocation will be processed within 7 days after submission.',
      success_ref: 'Reference',
      back_to_home: 'Back to Home',
      file_drop: 'Click to add files',
      file_hint_complaint: 'PDF, image, document, audio, video — up to 10 files, max 10 MB each',
      file_hint_id_doc: 'NIN / National ID / Passport — up to 5 files, max 10 MB each',
      file_hint_holding_photo: 'Photo holding the requested form — 1 file, max 10 MB',
      upload_too_big: 'File is larger than 10 MB',
      upload_too_many: 'Too many files',
      uploading: 'Uploading attachments...',
      submit_failed: 'Submission failed: ',
      // Form 1
      complaint_title: 'Service Progress & Customer Complaints',
      complaint_sub: 'This form helps you follow up on requests that have been delayed or unanswered (Product Orders, Delivery, Member Registration, Info Changes, Team Placement, Commission, Backoffice, Service Improvement).',
      f1_name: 'Name',
      f1_member_id: 'A4S Member ID',
      f1_whatsapp_used: 'Which WhatsApp number did you use to contact us?',
      f1_topic: 'Topic',
      f1_branch: 'Which A4S branch did you contact?',
      f1_cs_whatsapp: 'A4S Customer Service WhatsApp number you contacted',
      f1_details: 'Please write the details',
      f1_attach: 'Kindly attach a screenshot as supporting evidence',
      f1_others: 'Others (optional)',
      f1_other: 'Other',
      // Topics
      tp_product_order:  'Product Order follow up',
      tp_info_change:    'Member Information Change',
      tp_password:       'Member Login Password',
      tp_commission:     'Commission Checking and Payment Request',
      tp_service:        'Service Complaint',
      tp_wrong_sponsor:  'Wrong Sponsor or Team Placement',
      tp_ethics:         'Ethics',
      tp_other:          'Other',
      // Form 2
      ewallet_title: 'Commission Payment to E-Wallet Requisition',
      ewallet_sub: 'This form serves IBOs in case of A4S commission payment into IBO personal E-wallet in A4S backoffice.',
      f2_a4s_id: 'A4S ID',
      f2_full_name: 'Name and Surname when applied membership',
      f2_whatsapp: 'WhatsApp contact number',
      f2_email: 'E-mail',
      f2_confirm: 'Please click to confirm if you would like to receive your commission in your E-wallet',
      f2_confirm_text: 'Dear A4S, I would like to receive my commission in my E-wallet.',
      f2_confirm_yes: 'Confirmed',
      f2_id_doc: 'Herewith please attach your NIN or National ID card or Passport photo',
      f2_id_doc_example: 'Example — your ID document',
      f2_holding: 'Herewith please snap and attach your photo holding the requested form',
      f2_holding_example: 'Example — selfie holding your ID',
      f2_accept: 'Thank you for your completed process regarding commission payment to E-wallet. It will take 3–7 days to verify and approve. If it takes more than 2 weeks and you did not receive your E-wallet, kindly contact WhatsApp +66 625 684 476.',
      f2_accept_yes: 'I confirm and accept',
      // Form 3
      relocation_title: 'Changing Location Base Requisition',
      relocation_sub: 'This form supports A4S IBO members for location base changing purpose only. Please fill in the required information.',
      f3_member_id: 'Member ID',
      f3_member_name: 'Member Name',
      f3_from: 'From base location',
      f3_to: 'New base location',
      f3_whatsapp: 'WhatsApp',
      f3_email: 'E-Mail',
      f3_ack: 'Relocation will be processed within 7 days after submission.',
      f3_ack_yes: 'Noted',
    },
    fr: {
      brand: 'A4S — Portail IBD',
      brand_sub: 'Développement Commercial International',
      logout: 'Déconnexion',
      login_title: 'Connexion Membre',
      login_sub: 'Veuillez saisir votre ID Membre A4S et votre mot de passe pour continuer',
      member_id: 'ID Membre A4S',
      password: 'Mot de passe',
      login_btn: 'Se Connecter',
      login_err_no_member: 'ID Membre introuvable',
      login_err_no_pass: 'Aucun mot de passe défini — veuillez contacter l\'administrateur',
      login_err_wrong: 'Mot de passe incorrect',
      home_title: 'Comment pouvons-nous vous aider ?',
      home_sub: 'Choisissez un type de demande ci-dessous',
      home_complaint_title: 'Suivi & Réclamations',
      home_complaint_sub: 'Suivez vos demandes en attente ou signalez un problème de service',
      home_ewallet_title: 'Commission vers E-Wallet',
      home_ewallet_sub: 'Demandez le paiement de votre commission sur votre E-wallet personnel',
      home_relocation_title: 'Changer de Pays de Base',
      home_relocation_sub: 'Demandez à changer votre pays d\'enregistrement',
      home_my_requests_title: 'Mes Demandes',
      home_my_requests_sub: 'Suivez l\'état de vos demandes soumises',
      my_title: 'Mes Demandes',
      my_sub: 'Toutes les demandes que vous avez soumises, triées par date',
      my_empty: 'Vous n\'avez encore soumis aucune demande',
      my_kind_complaint: 'Réclamation',
      my_kind_ewallet: 'E-Wallet',
      my_kind_relocation: 'Changement',
      my_status_new: 'Nouveau',
      my_status_in_progress: 'En cours',
      my_status_resolved: 'Résolu',
      my_status_closed: 'Fermé',
      my_status_pending: 'En attente',
      my_status_approved: 'Approuvé',
      my_status_paid: 'Payé',
      my_status_rejected: 'Refusé',
      my_submitted: 'Soumis',
      back: 'Retour',
      submit: 'Envoyer',
      submitting: 'Envoi en cours...',
      cancel: 'Annuler',
      required: 'Ce champ est requis',
      success_title: 'Demande Envoyée !',
      success_msg_complaint: 'Nous avons bien reçu votre réclamation. Certains cas peuvent prendre 5–7 jours à traiter ; merci de votre patience.',
      success_msg_ewallet: 'Il faudra 3–7 jours pour vérifier et approuver. Si cela prend plus de 2 semaines, veuillez contacter WhatsApp +66 625 684 476.',
      success_msg_relocation: 'Le changement sera traité dans les 7 jours suivant la soumission.',
      success_ref: 'Référence',
      back_to_home: 'Retour à l\'Accueil',
      file_drop: 'Cliquer pour ajouter des fichiers',
      file_hint_complaint: 'PDF, image, document, audio, vidéo — jusqu\'à 10 fichiers, max 10 Mo chacun',
      file_hint_id_doc: 'NIN / Carte d\'identité / Passeport — jusqu\'à 5 fichiers, max 10 Mo chacun',
      file_hint_holding_photo: 'Photo tenant le formulaire — 1 fichier, max 10 Mo',
      upload_too_big: 'Le fichier dépasse 10 Mo',
      upload_too_many: 'Trop de fichiers',
      uploading: 'Téléchargement des pièces jointes...',
      submit_failed: 'Échec de l\'envoi : ',
      // Form 1
      complaint_title: 'Suivi du Service & Réclamations Clients',
      complaint_sub: 'Ce formulaire vous aide à suivre les demandes retardées ou sans réponse (commandes produits, livraison, inscription, modifications, placement d\'équipe, commission, back-office, amélioration du service).',
      f1_name: 'Nom',
      f1_member_id: 'ID Membre A4S',
      f1_whatsapp_used: 'Quel numéro WhatsApp avez-vous utilisé pour nous contacter ?',
      f1_topic: 'Sujet',
      f1_branch: 'Quelle agence A4S avez-vous contactée ?',
      f1_cs_whatsapp: 'Numéro WhatsApp du Service Client A4S contacté',
      f1_details: 'Veuillez décrire les détails',
      f1_attach: 'Veuillez joindre une capture d\'écran comme preuve',
      f1_others: 'Autres (facultatif)',
      f1_other: 'Autre',
      tp_product_order:  'Suivi de commande produit',
      tp_info_change:    'Modification d\'informations membre',
      tp_password:       'Mot de passe membre',
      tp_commission:     'Vérification et paiement de commission',
      tp_service:        'Réclamation de service',
      tp_wrong_sponsor:  'Mauvais parrain ou placement d\'équipe',
      tp_ethics:         'Éthique',
      tp_other:          'Autre',
      // Form 2
      ewallet_title: 'Demande de Paiement de Commission vers E-Wallet',
      ewallet_sub: 'Ce formulaire est destiné aux IBOs pour le paiement de la commission A4S sur leur E-wallet personnel.',
      f2_a4s_id: 'ID A4S',
      f2_full_name: 'Nom et prénom lors de l\'inscription',
      f2_whatsapp: 'Numéro WhatsApp',
      f2_email: 'E-mail',
      f2_confirm: 'Veuillez confirmer si vous souhaitez recevoir votre commission sur votre E-wallet',
      f2_confirm_text: 'Cher A4S, je souhaite recevoir ma commission sur mon E-wallet.',
      f2_confirm_yes: 'Confirmé',
      f2_id_doc: 'Veuillez joindre votre NIN, carte d\'identité ou passeport',
      f2_id_doc_example: 'Exemple — votre document d\'identité',
      f2_holding: 'Veuillez prendre et joindre une photo de vous tenant le formulaire',
      f2_holding_example: 'Exemple — selfie tenant votre carte',
      f2_accept: 'Merci pour votre démarche concernant le paiement de commission. Il faudra 3–7 jours pour vérifier et approuver. Si cela prend plus de 2 semaines, veuillez contacter WhatsApp +66 625 684 476.',
      f2_accept_yes: 'Je confirme et accepte',
      // Form 3
      relocation_title: 'Demande de Changement de Pays de Base',
      relocation_sub: 'Ce formulaire est destiné aux membres A4S IBO pour changer de pays de base. Veuillez remplir les informations requises.',
      f3_member_id: 'ID Membre',
      f3_member_name: 'Nom du Membre',
      f3_from: 'Pays de base actuel',
      f3_to: 'Nouveau pays de base',
      f3_whatsapp: 'WhatsApp',
      f3_email: 'E-Mail',
      f3_ack: 'Le changement sera traité dans les 7 jours suivant la soumission.',
      f3_ack_yes: 'Compris',
    },
  };

  /* ── Language helpers ── */
  function getLang() {
    const ls = localStorage.getItem(LANG_LS_KEY);
    return I18N[ls] ? ls : 'en';
  }
  function setLang(lang) {
    if (!I18N[lang]) return;
    localStorage.setItem(LANG_LS_KEY, lang);
    location.reload();
  }
  function t(key) {
    const lang = getLang();
    return I18N[lang][key] || I18N.en[key] || key;
  }

  /* ── Session helpers ── */
  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_LS_KEY) || localStorage.getItem(SESSION_LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function setSession(member, persist = false) {
    const data = JSON.stringify(member);
    if (persist) localStorage.setItem(SESSION_LS_KEY, data);
    else sessionStorage.setItem(SESSION_LS_KEY, data);
  }
  function clearSession() {
    localStorage.removeItem(SESSION_LS_KEY);
    sessionStorage.removeItem(SESSION_LS_KEY);
  }
  function logout() {
    clearSession();
    location.href = './login.html';
  }
  function requireAuth() {
    const s = getSession();
    if (!s || !s.member_code) { location.replace('./login.html'); return null; }
    return s;
  }

  /* ── Supabase REST helpers ── */
  async function sbGet(path) {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  async function sbPost(path, body, prefer = 'return=representation') {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: prefer,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json().catch(() => null);
  }

  /* ── Storage upload — anon role uploads private file ──
     ถ้าเป็นรูปจะ compress ก่อน (resize 1600px + JPEG q0.82) ลด egress ~90%
     ถ้าเป็น PDF/อื่น ๆ upload ดิบ ๆ ตามเดิม */
  async function uploadFile(file, pathPrefix) {
    const isImage = (file.type || '').startsWith('image/');
    let body = file;
    let contentType = file.type || 'application/octet-stream';
    let fileExt;
    if (isImage && window.ImageCompressor) {
      try {
        body = await window.ImageCompressor.compress(file);
        contentType = 'image/jpeg';
        fileExt = 'jpg';
      } catch (e) {
        console.warn('compress failed, using original:', e.message);
      }
    }
    const origName = file.name.replace(/[^\w.\-]+/g, '_');
    const safeName = fileExt
      ? origName.replace(/\.[^.]+$/, '') + '.' + fileExt
      : origName;
    const key = `${pathPrefix}/${Date.now()}_${safeName}`;
    const url = `${SB_URL}/storage/v1/object/${BUCKET}/${key}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'false',
      },
      body,
    });
    if (!res.ok) throw new Error(`Upload ${safeName} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    // Return storage object key — staff will create signed URL when viewing
    return key;
  }
  async function uploadFiles(files, pathPrefix, onProgress) {
    const keys = [];
    let i = 0;
    for (const f of files) {
      i++;
      if (onProgress) onProgress(i, files.length, f.name);
      const k = await uploadFile(f, pathPrefix);
      keys.push(k);
    }
    return keys;
  }

  /* ── LINE notification trigger (fire-and-forget, never blocks UI) ── */
  async function notifyTrigger(triggerKey, payload) {
    if (!PROXY) return; // notifications disabled
    try {
      await fetch(`${PROXY}/ibd/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger_key: triggerKey, payload: payload || {} }),
      });
    } catch (e) {
      // silent — never block the user on notification failure
      console.warn('[IBDPortal] notify failed', e.message);
    }
  }

  /* ── Member auth — verify password against members.password_hash ── */
  async function loginMember(memberCode, password) {
    const code = String(memberCode || '').trim();
    if (!code || !password) throw new Error(t('login_err_no_member'));
    const rows = await sbGet(`members?member_code=eq.${encodeURIComponent(code)}&select=member_code,member_name,full_name,phone,password_hash&limit=1`);
    const member = rows[0];
    if (!member) throw new Error(t('login_err_no_member'));
    if (!member.password_hash) throw new Error(t('login_err_no_pass'));
    if (!window.ERPCrypto?.hash) throw new Error('Crypto module not loaded');
    const inputHash = await ERPCrypto.hash(password);
    if (inputHash !== member.password_hash) throw new Error(t('login_err_wrong'));
    return {
      member_code: member.member_code,
      member_name: member.member_name,
      full_name: member.full_name,
      phone: member.phone,
      logged_in_at: new Date().toISOString(),
    };
  }

  /* ── Toast ── */
  function ensureToast() {
    let el = document.getElementById('ppToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ppToast';
      el.className = 'pp-toast';
      document.body.appendChild(el);
    }
    return el;
  }
  function toast(msg, type = '') {
    const el = ensureToast();
    el.textContent = msg;
    el.className = 'pp-toast show ' + (type || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 3500);
  }

  /* ── Loading overlay ── */
  function ensureLoading() {
    let el = document.getElementById('ppLoading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ppLoading';
      el.className = 'pp-loading';
      el.innerHTML = '<div class="pp-spinner"></div>';
      document.body.appendChild(el);
    }
    return el;
  }
  function showLoading(on) {
    const el = ensureLoading();
    el.classList.toggle('show', !!on);
  }

  /* ── Render topbar (with lang toggle + optional user chip) ── */
  function renderTopbar(opts = {}) {
    const { showUser = true } = opts;
    const session = getSession();
    const lang = getLang();
    const userHtml = (showUser && session)
      ? `<div class="pp-user"><span class="pp-user-icon">👤</span><span>${escapeHtml(session.member_name || session.member_code)}</span></div>
         <button class="pp-logout" onclick="IBDPortal.logout()" title="${t('logout')}">⏻</button>`
      : '';
    const html = `
      <div class="pp-topbar">
        <div class="pp-brand">
          <img class="pp-brand-logo js-company-logo" id="ppBrandLogo" src="${(function(){try{return (localStorage.getItem('company_logo_url')||'').trim()||'../../assets/logo/logo-a4s.png';}catch(e){return '../../assets/logo/logo-a4s.png';}})()}" alt="logo" onerror="this.onerror=null;this.src='../../assets/logo/logo-a4s.png'" />
          <div class="pp-brand-text">
            <div>${t('brand')}</div>
            <div class="pp-brand-sub">${t('brand_sub')}</div>
          </div>
        </div>
        <div class="pp-spacer"></div>
        <div class="pp-lang">
          <button class="pp-lang-btn ${lang==='en'?'active':''}" onclick="IBDPortal.setLang('en')">EN</button>
          <button class="pp-lang-btn ${lang==='fr'?'active':''}" onclick="IBDPortal.setLang('fr')">FR</button>
        </div>
        ${userHtml}
      </div>`;
    document.body.insertAdjacentHTML('afterbegin', html);
    // Pull company logo from app_settings (members never visit settings → no cache)
    if (SB_URL && SB_KEY) {
      fetch(`${SB_URL}/rest/v1/app_settings?select=value&key=eq.company_logo_url`, {
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      })
        .then(r => r.ok ? r.json() : [])
        .then(rows => {
          const url = rows && rows[0] ? rows[0].value : '';
          if (url && typeof url === 'string' && url.trim()) {
            try { localStorage.setItem('company_logo_url', url); } catch (e) {}
            // Update every company-logo image on the page (topbar + card)
            document.querySelectorAll('.js-company-logo').forEach(img => { img.src = url; });
          }
        })
        .catch(() => {});
    }
  }

  /* ── Misc ── */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function fmtFileSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }

  /* ── File-input helper: render thumbnails + handle remove ── */
  function attachFileInput(opts) {
    const { wrapId, inputId, listId, max = 10, maxSize = 10 * 1024 * 1024, onChange } = opts;
    const wrap = document.getElementById(wrapId);
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    let files = [];

    const render = () => {
      list.innerHTML = files.map((f, i) => `
        <div class="pp-file-item">
          <span style="font-size:16px">📎</span>
          <span class="pp-file-name">${escapeHtml(f.name)}</span>
          <span class="pp-file-size">${fmtFileSize(f.size)}</span>
          <button class="pp-file-remove" onclick="IBDPortal._fileRemove('${wrapId}', ${i})">×</button>
        </div>`).join('');
      wrap.classList.toggle('has-files', files.length > 0);
      if (onChange) onChange(files);
    };

    wrap.onclick = (e) => {
      if (e.target.closest('.pp-file-item')) return;
      input.click();
    };
    input.onchange = () => {
      const newFiles = Array.from(input.files || []);
      for (const f of newFiles) {
        if (f.size > maxSize) { toast(t('upload_too_big') + ' (' + f.name + ')', 'error'); continue; }
        if (files.length >= max) { toast(t('upload_too_many'), 'error'); break; }
        files.push(f);
      }
      input.value = '';
      render();
    };

    // expose state via wrap dataset for cross-call removal
    wrap._files = files;
    wrap._render = render;
    return {
      getFiles: () => files,
      reset: () => { files.length = 0; render(); },
    };
  }
  function _fileRemove(wrapId, idx) {
    const wrap = document.getElementById(wrapId);
    if (!wrap || !wrap._files) return;
    wrap._files.splice(idx, 1);
    wrap._render();
  }

  /* ── Public API ── */
  window.IBDPortal = {
    SB_URL, SB_KEY, BUCKET,
    t, getLang, setLang,
    getSession, setSession, clearSession, logout, requireAuth,
    sbGet, sbPost,
    uploadFile, uploadFiles,
    notifyTrigger,
    loginMember,
    toast, showLoading,
    renderTopbar,
    escapeHtml, fmtFileSize,
    attachFileInput,
    _fileRemove,
  };
})();
