/* ============================================================
   CONTRALABOS — APP SHELL RENDERER
   Injects the sidebar + topnav into every authenticated page.
   Each page just needs: <div id="sidebar-mount"></div>,
   <div id="topnav-mount"></div>, and body[data-page="..."] to
   mark the active nav item.
   ============================================================ */

const NAV_ICONS = {
  dashboard:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
  projects:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 21V9l6-4 6 4v12"/><path d="M10 21V5l6 3v13"/></svg>',
  workers:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="7" r="3.2"/><path d="M5 20c0-3.6 3.1-6.4 7-6.4s7 2.8 7 6.4"/></svg>',
  attendance:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="17" rx="1"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>',
  payments:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="6" width="20" height="13" rx="1"/><path d="M2 10h20"/></svg>',
  materials:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/></svg>',
  expenses:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4v16h16"/><path d="M8 15l3-3 3 3 5-6"/></svg>',
  budget:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  progress:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="1"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
  requests:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h11"/></svg>',
  documents:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>',
  notifications:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>',
  profile:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.6 3.1-6.4 7-6.4s7 2.8 7 6.4"/></svg>',
  support:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 015.7 1.2c0 2-2.8 1.8-2.8 4"/><path d="M12 17h.01"/></svg>',
  admin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V5z"/></svg>',
  reports:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 19h16"/><rect x="6" y="10" width="3" height="6"/><rect x="11" y="6" width="3" height="10"/><rect x="16" y="13" width="3" height="3"/></svg>'
};

/* Which pages each role is allowed to open. Used for route guarding. */
const ALLOWED_PAGES_BY_ROLE = {
  contractor: ["dashboard","projects","workers","attendance","payments","materials","expenses","budget","progress","requests","documents","notifications","profile","support","reports"],
  supervisor: ["dashboard","attendance","progress","materials","requests","documents","notifications","profile","support","projects"],
  worker: ["dashboard","attendance","payments","notifications","profile","support"],
  accountant: ["dashboard","payments","expenses","budget","requests","documents","notifications","profile","support","reports"],
  admin: ["dashboard","admin","documents","notifications","profile","support"]
};
const NAV_BY_ROLE = {
  contractor: [
    { group:"Overview", items:[["dashboard","Dashboard","dashboard.html"]] },
    { group:"Operations", items:[
      ["projects","Projects","projects.html"], ["workers","Workers","workers.html"],
      ["attendance","Attendance","attendance.html"], ["payments","Wages & Payments","payments.html"],
      ["materials","Materials & Inventory","materials.html"], ["expenses","Expenses","expenses.html"],
      ["budget","Budget","budget.html"], ["progress","Progress Reports","progress.html"]
    ]},
    { group:"Workflow", items:[["requests","Requests & Status","requests.html"], ["documents","Documents","documents.html"]] },
    { group:"Analytics", items:[["reports","Reports","reports.html"]] },
    { group:"Account", items:[["notifications","Notifications","notifications.html"], ["profile","Profile","profile.html"], ["support","Support","support.html"]] }
  ],
  supervisor: [
    { group:"Overview", items:[["dashboard","Dashboard","dashboard-supervisor.html"]] },
    { group:"Site Operations", items:[
      ["attendance","Attendance","attendance.html"], ["progress","Progress Reports","progress.html"],
      ["materials","Materials & Inventory","materials.html"]
    ]},
    { group:"Workflow", items:[["requests","Requests & Status","requests.html"], ["documents","Documents","documents.html"]] },
    { group:"Account", items:[["notifications","Notifications","notifications.html"], ["profile","Profile","profile.html"], ["support","Support","support.html"]] }
  ],
  worker: [
    { group:"Overview", items:[["dashboard","Dashboard","dashboard-worker.html"]] },
    { group:"My Records", items:[["attendance","My Attendance","attendance.html"], ["payments","My Payments","payments.html"]] },
    { group:"Account", items:[["notifications","Notifications","notifications.html"], ["profile","Profile","profile.html"], ["support","Support","support.html"]] }
  ],
  accountant: [
    { group:"Overview", items:[["dashboard","Dashboard","dashboard-accountant.html"]] },
    { group:"Finance", items:[["payments","Wages & Payments","payments.html"], ["expenses","Expenses","expenses.html"], ["budget","Budget","budget.html"]] },
    { group:"Workflow", items:[["requests","Requests & Status","requests.html"], ["documents","Documents","documents.html"]] },
    { group:"Analytics", items:[["reports","Reports","reports.html"]] },
    { group:"Account", items:[["notifications","Notifications","notifications.html"], ["profile","Profile","profile.html"], ["support","Support","support.html"]] }
  ],
  admin: [
    { group:"Overview", items:[["dashboard","Dashboard","dashboard-admin.html"]] },
    { group:"Administration", items:[["admin","Users & Roles","admin.html"], ["documents","Documents","documents.html"]] },
    { group:"Account", items:[["notifications","Notifications","notifications.html"], ["profile","Profile","profile.html"], ["support","Support","support.html"]] }
  ]
};

const PROJECT_SELECT_IDS = new Set(["fProject", "projSelect", "rProject", "eProject", "upProject", "pProject", "rqProject", "nwProject"]);
const ProjectContext = {
  storageKey: "contralabos.selectedProjectId",
  get(){
    try{ return localStorage.getItem(this.storageKey) || ""; }catch(_err){ return ""; }
  },
  set(projectId){
    try{
      if(projectId) localStorage.setItem(this.storageKey, projectId);
      else localStorage.removeItem(this.storageKey);
    }catch(_err){}
    document.dispatchEvent(new CustomEvent("projectchange:contralabos", { detail: { projectId: projectId || "" } }));
  }
};

function syncProjectSelect(select){
  const projectId = ProjectContext.get();
  if(!projectId || !Array.from(select.options).some(option => option.value === projectId)) return;
  if(select.value === projectId) return;
  select.value = projectId;
  select.dispatchEvent(new Event("change", { bubbles:true }));
}

function initProjectContext(){
  document.addEventListener("change", (event) => {
    const select = event.target;
    if(select instanceof HTMLSelectElement && PROJECT_SELECT_IDS.has(select.id)) ProjectContext.set(select.value);
  });
  const syncAll = () => document.querySelectorAll("select").forEach(select => {
    if(PROJECT_SELECT_IDS.has(select.id)) syncProjectSelect(select);
  });
  syncAll();
  new MutationObserver(syncAll).observe(document.body, { childList:true, subtree:true });
}

const Shell = {
  currentUser: null,

  async guard(){
    const user = await Contralabos.auth.getCurrentUser();
    if(!user){
      window.location.href = "login.html";
      return null;
    }
    if(!user.profileComplete && document.body.dataset.page !== "onboarding"){
      window.location.href = "onboarding.html";
      return null;
    }
    const page = document.body.dataset.page;
    const allowed = ALLOWED_PAGES_BY_ROLE[user.role] || [];
    if(page && !allowed.includes(page)){
      const roleDashboard = {
        contractor:"dashboard.html", supervisor:"dashboard-supervisor.html",
        worker:"dashboard-worker.html", accountant:"dashboard-accountant.html", admin:"dashboard-admin.html"
      };
      window.location.href = roleDashboard[user.role] || "login.html";
      return null;
    }
    this.currentUser = user;
    return user;
  },

  renderSidebar(user){
    const mount = document.getElementById("sidebar-mount");
    if(!mount) return;
    const groups = NAV_BY_ROLE[user.role] || NAV_BY_ROLE.contractor;
    const activePage = document.body.dataset.page;

    let html = `
      <div class="sidebar-brand">
        <svg viewBox="0 0 40 40" fill="none"><path d="M6 34V16L14 10V34" stroke="#c9974a" stroke-width="1.6"/><path d="M14 34V6L22 2V34" stroke="#c9974a" stroke-width="1.6"/><path d="M22 34V12L34 8V34" stroke="#c9974a" stroke-width="1.6"/><path d="M3 34H37" stroke="#e3b876" stroke-width="1.8"/></svg>
        <span class="b-name">CONTRALABOS</span>
      </div>`;
    groups.forEach(g => {
      html += `<div class="nav-group-title">${g.group}</div><ul class="nav-list">`;
      g.items.forEach(([key,label,href]) => {
        const active = activePage === key ? "active" : "";
        const i18nKey = "nav_" + key;
        html += `<li class="nav-item ${active}" onclick="window.location.href='${href}'">${NAV_ICONS[key]||""}<span class="nav-label" data-i18n="${i18nKey}">${label}</span></li>`;
      });
      html += `</ul>`;
    });
    mount.innerHTML = html;
    mount.classList.add("sidebar");
    if(window.LangSwitcher) LangSwitcher.apply(LangSwitcher.current);
  },

  renderTopnav(user){
    const mount = document.getElementById("topnav-mount");
    if(!mount) return;
    mount.classList.add("topnav");
    mount.innerHTML = `
      <button class="nav-toggle" id="sidebarToggle" aria-label="Toggle sidebar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
      </button>
      <div class="nav-search" style="position:relative;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input type="text" id="globalSearchInput" data-i18n-ph="search_ph" placeholder="Search projects, workers, requests…" autocomplete="off">
        <div id="searchResults" style="display:none;position:absolute;top:110%;left:0;right:0;background:var(--c-bg-raised);border:1px solid var(--c-border);border-radius:var(--r-xs);max-height:320px;overflow-y:auto;z-index:80;box-shadow:0 8px 24px rgba(0,0,0,0.5);"></div>
      </div>
      <div class="nav-right">
        <select class="lang-select">
          <option value="en" ${LangSwitcher.current==='en'?'selected':''}>EN</option>
          <option value="hi" ${LangSwitcher.current==='hi'?'selected':''}>हिंदी</option>
          <option value="mr" ${LangSwitcher.current==='mr'?'selected':''}>मराठी</option>
        </select>
        <button class="icon-btn" onclick="window.location.href='notifications.html'" aria-label="Notifications">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>
          <span class="dot" id="notifDot"></span>
        </button>
        <div class="profile-chip" onclick="window.location.href='profile.html'">
          <span class="avatar" id="navAvatar">${user.avatarUrl ? `<img src="${user.avatarUrl}" alt="${user.name}">` : (user.avatarInitials||"U")}</span>
          <div><div class="p-name">${user.name}</div><div class="p-role">${user.role.charAt(0).toUpperCase()+user.role.slice(1)}</div></div>
        </div>
      </div>`;
    document.getElementById("sidebarToggle").addEventListener("click", () => {
      document.querySelector(".sidebar")?.classList.toggle("mobile-open");
      document.querySelector(".sidebar")?.classList.toggle("collapsed");
    });
    Contralabos.notifications.list().then(list => {
      const unread = list.filter(n=>!n.read).length;
      const dot = document.getElementById("notifDot");
      if(dot) dot.textContent = unread || "";
      if(dot && !unread) dot.style.display = "none";
    });
    this.wireSearch();
    if(window.LangSwitcher) LangSwitcher.init();
  },

  async wireSearch(){
    const input = document.getElementById("globalSearchInput");
    const resultsBox = document.getElementById("searchResults");
    if(!input) return;
    let projects, workers, requests;
    try{
      [projects, workers, requests] = await Promise.all([
        Contralabos.projects.list(), Contralabos.workers.list(), Contralabos.requests.list()
      ]);
    }catch(err){
      console.error("Global search could not load data:", err);
      resultsBox.innerHTML = '<div style="padding:12px;font-size:12px;color:var(--c-text-dim);">Search is temporarily unavailable.</div>';
      return;
    }
    const index = [
      ...projects.map(p => ({ label:p.name, sub:"Project", href:`project-detail.html?id=${p.id}` })),
      ...workers.map(w => ({ label:w.name, sub:"Worker", href:"workers.html" })),
      ...requests.map(r => ({ label:r.id + " — " + r.type, sub:"Request · " + r.status, href:`request-detail.html?id=${r.id}` }))
    ];
    function renderResults(query){
      if(!query){ resultsBox.style.display = "none"; return; }
      const matches = index.filter(item => item.label.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
      if(!matches.length){
        resultsBox.innerHTML = `<div style="padding:12px;font-size:12px;color:var(--c-text-dim);">No matches for "${query}"</div>`;
      } else {
        resultsBox.innerHTML = matches.map(m => `
          <div style="padding:9px 12px;font-size:12.5px;cursor:pointer;border-bottom:1px solid var(--c-border-soft);" onmousedown="window.location.href='${m.href}'">
            <div>${m.label}</div><div style="font-size:10.5px;color:var(--c-text-dim);">${m.sub}</div>
          </div>`).join("");
      }
      resultsBox.style.display = "block";
    }
    input.addEventListener("input", (e) => renderResults(e.target.value.trim()));
    input.addEventListener("focus", (e) => { if(e.target.value.trim()) renderResults(e.target.value.trim()); });
    input.addEventListener("blur", () => setTimeout(() => resultsBox.style.display = "none", 150));
  },

  async init(){
    const user = await this.guard();
    if(!user) return;
    initProjectContext();
    this.renderSidebar(user);
    this.renderTopnav(user);
    document.dispatchEvent(new CustomEvent("shell:ready", { detail: { user } }));
  }
};

document.addEventListener("DOMContentLoaded", () => {
  if(document.getElementById("sidebar-mount")) Shell.init();
});
