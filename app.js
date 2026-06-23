const DAY_MS = 86400000;
let backendAvailable = false;
let deferredInstallPrompt = null;
let supabaseClient = null;
let currentProfile = { role: "viewer", member_id: null, team_id: null, full_name: "" };
let activityLogs = [];
let activityLogError = null;
let managedAccounts = [];
let syncPollTimer = null;
let reloadingForUpdate = false;
let people = [];
let teamGroups = [];
let events = [];
let days = window.matchMedia("(max-width: 760px)").matches ? 7 : 14;
let rangeStart = startOfDay(new Date());
let enabledStatuses = new Set(["confirmed", "pending", "progress", "draft"]);
let dragState = null;
let currentView = "overview";
let currentUserId = null;

const els = Object.fromEntries([
  "scheduleGrid","rangeTitle","visibleEventCount","progressCount","pendingCount","conflictCount",
  "navConflictCount","searchInput","departmentFilter","rangeSelector","eventModal","eventForm",
  "eventId","eventTitle","eventOwner","eventStatus","eventStart","eventEnd","eventCity","eventType",
  "eventVenue","eventNotes","modalTitle","deleteEvent","toast","lastSync","scheduleScroll"
  ,"pageTitle","projectListCard","projectTableBody","projectListCount"
  ,"teamModal","membersPanel","groupsPanel","memberForm","memberId","memberName","memberRole"
  ,"memberGroup","memberList","groupForm","groupOriginalName","groupName","groupList"
  ,"saveMemberButton","cancelMemberEdit","saveGroupButton","cancelGroupEdit"
  ,"memberEditorModal","groupEditorModal","memberEditorTitle","groupEditorTitle"
  ,"memberCountLabel","groupCountLabel"
  ,"authScreen","loginForm","loginEmail","loginPassword","authError","accountButton"
  ,"activityCard","activityList","activityCount","expandSchedule","closeExpandedSchedule"
  ,"accountsPanel","accountList","accountCountLabel","refreshAccounts"
  ,"mobileSyncStatus","loginButton"
].map(id => [id, document.getElementById(id)]));

function setSyncStatus(text, state = "connecting") {
  els.lastSync.textContent = text;
  els.mobileSyncStatus.textContent = text;
  els.mobileSyncStatus.dataset.state = state;
}

function canEditEvents() { return backendAvailable && ["admin", "editor"].includes(currentProfile.role); }
function canManageTeam() { return backendAvailable && currentProfile.role === "admin"; }

async function saveEvents(message = "排期已实时同步", changedEvent) {
  if (!canEditEvents()) return showToast("当前账号为只读权限");
  try {
    const { data, error } = await supabaseClient.rpc("save_schedule", {
      p_assignment_id: changedEvent.id || null,
      p_project_id: changedEvent.projectId || null,
      p_member_id: changedEvent.ownerId,
      p_title: changedEvent.title,
      p_start_at: changedEvent.start,
      p_end_at: changedEvent.end,
      p_status: changedEvent.status,
      p_city: changedEvent.city || "",
      p_business_type: changedEvent.type || "未分类",
      p_venue: changedEvent.venue || "",
      p_notes: changedEvent.notes || "",
    });
    if (error) throw error;
    if (!changedEvent.id && data?.[0]) {
      changedEvent.id = data[0].assignment_id;
      changedEvent.projectId = data[0].project_id;
    }
  } catch (error) {
    setSyncStatus("云端写入失败", "error");
    showToast(error.message || "同步失败");
    await loadCloudData();
    return false;
  }
  await loadCloudData();
  setSyncStatus("云端已同步", "online");
  showToast(message);
  return true;
}

async function saveTeamGroups(message = "小组设置已同步") {
  if (!canManageTeam()) return showToast("只有管理员可以修改团队设置");
  const { error } = await supabaseClient.from("teams").update({ groups: groups() }).eq("id", currentProfile.team_id);
  if (error) {
    await loadCloudData();
    return showToast(error.message || "小组设置同步失败");
  }
  showToast(message);
  refreshPeopleControls();
  renderTeamSettings();
  render();
}
function fromPersonRow(row) {
  return { id: row.id, name: row.name, role: row.role, dept: row.group_name, color: row.color };
}

async function connectBackend(sessionOverride = null) {
  const config = window.APP_CONFIG || {};
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
    backendAvailable = false;
    els.authScreen.classList.remove("hidden");
    els.authError.textContent = "云端配置缺失：请在 Cloudflare Pages 设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY";
    els.loginForm.querySelector("button[type='submit']").disabled = true;
    setSyncStatus("云端配置缺失 · 系统已停止加载", "error");
    throw new Error("Supabase environment variables are missing");
  }
  if (!window.supabase?.createClient) {
    backendAvailable = false;
    els.authScreen.classList.remove("hidden");
    els.authError.textContent = "Supabase客户端加载失败，请刷新页面或检查网络";
    els.loginForm.querySelector("button[type='submit']").disabled = true;
    setSyncStatus("云端客户端加载失败", "error");
    throw new Error("Supabase browser client failed to load");
  }
  supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  const session = sessionOverride || (await supabaseClient.auth.getSession()).data.session;
  if (!session) {
    els.authScreen.classList.remove("hidden");
    setSyncStatus("等待登录云端账号", "connecting");
    return false;
  }
  try {
    els.authScreen.classList.add("hidden");
    const user = session.user;
    if (!user?.id) throw new Error("登录会话中缺少用户信息");
    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("id,full_name,role,team_id,member_id")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;
    if (!profile.team_id) throw new Error("当前账号尚未绑定团队，请联系管理员");
    currentProfile = profile;
    currentUserId = profile.member_id;
    backendAvailable = true;
    await loadCloudData();
    els.accountButton.title = `${profile.full_name || user.email || "团队账号"} · 点击退出`;
    document.getElementById("teamSettingsButton").classList.toggle("hidden", !canManageTeam());
    document.getElementById("addEventButton").classList.toggle("hidden", !canEditEvents());
    if (!canEditEvents() && !document.querySelector(".read-only-banner")) {
      document.body.insertAdjacentHTML("beforeend", '<div class="read-only-banner">当前账号为只读权限</div>');
    }
    setSyncStatus("云端已连接", "online");
    connectRealtimeStream();
    await checkSystemStatus();
    startSyncFallback();
    return true;
  } catch (error) {
    backendAvailable = false;
    els.authScreen.classList.remove("hidden");
    els.authError.textContent = `登录成功，但云端数据初始化失败：${error.message || "未知错误"}`;
    setSyncStatus("云端数据层不可用", "error");
    return false;
  }
}

function bindLoginForm() {
  els.loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    els.authError.textContent = "";
    els.loginButton.disabled = true;
    els.loginButton.textContent = "登录中…";
    try {
      const config = window.APP_CONFIG || {};
      if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
        throw new Error("云端配置缺失，请联系管理员");
      }
      if (!window.supabase?.createClient) throw new Error("Supabase客户端加载失败，请刷新页面");
      supabaseClient ||= window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: els.loginEmail.value.trim(),
        password: els.loginPassword.value,
      });
      if (error) throw error;
      if (!data.session) throw new Error("认证成功，但Supabase没有返回会话");
      els.loginButton.textContent = "登录成功，正在加载数据…";
      const connected = await connectBackend(data.session);
      if (!connected) {
        els.loginButton.disabled = false;
        els.loginButton.textContent = "重试进入";
        return;
      }
      render();
    } catch (error) {
      els.authError.textContent = error.message || "登录失败，请重试";
      els.loginButton.disabled = false;
      els.loginButton.textContent = "登录";
    }
  });
}

function connectRealtimeStream() {
  supabaseClient.channel("schedule-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, loadCloudData)
    .on("postgres_changes", { event: "*", schema: "public", table: "members" }, loadCloudData)
    .on("postgres_changes", { event: "*", schema: "public", table: "assignments" }, loadCloudData)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "event_audit_logs" }, loadActivityLogs)
    .subscribe(status => {
      const statusText = {
        SUBSCRIBED: "Supabase实时连接",
        CHANNEL_ERROR: "实时连接异常 · 自动轮询",
        TIMED_OUT: "实时连接超时 · 自动轮询",
        CLOSED: "实时连接已断开 · 自动轮询"
      };
      setSyncStatus(
        statusText[status] || "正在连接云端…",
        status === "SUBSCRIBED" ? "online" : status === "CHANNEL_ERROR" ? "error" : "connecting"
      );
    });
}
async function loadEventsFromSupabase() {
  await loadCloudData();
}
async function loadTeamFromSupabase() {
  await loadCloudData();
}
async function loadCloudData() {
  if (!backendAvailable || !currentProfile.team_id) return;
  const [{ data: team, error: teamError }, { data: memberRows, error: memberError }, { data: projectRows, error: projectError }, { data: assignmentRows, error: assignmentError }] = await Promise.all([
    supabaseClient.from("teams").select("id,name,groups").eq("id", currentProfile.team_id).single(),
    supabaseClient.from("members").select("*").order("name"),
    supabaseClient.from("projects").select("*"),
    supabaseClient.from("assignments").select("*").order("start_at"),
  ]);
  const error = teamError || memberError || projectError || assignmentError;
  if (error) {
    setSyncStatus("云端数据读取失败", "error");
    throw error;
  }
  people = (memberRows || []).map(fromPersonRow);
  teamGroups = Array.isArray(team.groups) ? team.groups : [];
  const projectsById = new Map((projectRows || []).map(project => [project.id, project]));
  events = (assignmentRows || []).map(assignment => {
    const project = projectsById.get(assignment.project_id);
    return {
      id: assignment.id,
      projectId: assignment.project_id,
      title: project?.title || "未命名项目",
      ownerId: assignment.member_id,
      start: String(assignment.start_at).slice(0,16),
      end: String(assignment.end_at).slice(0,16),
      status: assignment.status,
      city: project?.city || "",
      type: project?.business_type || "未分类",
      venue: project?.venue || "",
      notes: project?.notes || "",
    };
  });
  refreshPeopleControls(); renderTeamSettings(); render();
}
async function loadActivityLogs() {
  if (!backendAvailable) return;
  const { data, error } = await supabaseClient
    .from("event_audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    activityLogs = [];
    activityLogError = error;
    if (currentView === "activity") renderActivityLog(error);
    return;
  }
  activityLogError = null;
  activityLogs = data || [];
  if (currentView === "activity") renderActivityLog();
}

function startSyncFallback() {
  clearInterval(syncPollTimer);
  syncPollTimer = setInterval(() => {
    if (document.visibilityState === "visible") loadEventsFromSupabase();
  }, 15000);
}

async function checkSystemStatus() {
  const { data, error } = await supabaseClient.rpc("get_schedule_system_status");
  if (error || !data?.[0]) {
    activityLogError = new Error("操作日志数据库功能尚未安装");
    return;
  }
  const status = data[0];
  if (!status.audit_trigger_enabled) activityLogError = new Error("操作日志触发器未启用");
  if (!status.assignments_realtime_enabled || !status.projects_realtime_enabled || !status.members_realtime_enabled) {
    setSyncStatus("云端轮询同步 · Realtime未完整启用", "warning");
  }
}

async function loadManagedAccounts() {
  if (!backendAvailable || !canManageTeam()) return;
  els.accountList.innerHTML = `<div class="empty-settings">正在读取账号…</div>`;
  const { data, error } = await supabaseClient.rpc("admin_list_accounts");
  if (error) {
    managedAccounts = [];
    els.accountCountLabel.textContent = "账号管理功能尚未安装";
    els.accountList.innerHTML = `<div class="empty-settings">请先执行最新的账号权限增量 SQL。</div>`;
    return;
  }
  managedAccounts = data || [];
  renderManagedAccounts();
}

function renderManagedAccounts() {
  els.accountCountLabel.textContent = `共 ${managedAccounts.length} 个登录账号`;
  els.accountList.innerHTML = managedAccounts.length ? managedAccounts.map(account => `
    <div class="account-setting-row" data-user="${account.user_id}">
      <div class="setting-main account-email">
        <strong>${escapeHtml(account.email)}</strong>
        <span>${account.member_name ? `已绑定：${escapeHtml(account.member_name)}` : "尚未绑定成员"}</span>
      </div>
      <label>对应成员
        <select class="account-person">
          <option value="">不绑定</option>
          ${people.map(person => `<option value="${person.id}" ${person.id === account.member_id ? "selected" : ""}>${escapeHtml(person.name)} · ${escapeHtml(person.dept)}</option>`).join("")}
        </select>
      </label>
      <label>权限
        <select class="account-role">
          <option value="viewer" ${account.role === "viewer" ? "selected" : ""}>只读 viewer</option>
          <option value="editor" ${account.role === "editor" ? "selected" : ""}>可编辑 editor</option>
          <option value="admin" ${account.role === "admin" ? "selected" : ""}>管理员 admin</option>
        </select>
      </label>
      <button type="button" class="primary-button save-account-binding">保存</button>
    </div>`).join("") : `<div class="empty-settings">尚未创建登录账号。</div>`;
  document.querySelectorAll(".save-account-binding").forEach(button => button.addEventListener("click", () => {
    saveAccountBinding(button.closest(".account-setting-row"));
  }));
}

async function saveAccountBinding(row) {
  const targetUserId = row.dataset.user;
  const personId = row.querySelector(".account-person").value || null;
  const role = row.querySelector(".account-role").value;
  const { error } = await supabaseClient.rpc("admin_update_account", {
    target_user_id: targetUserId,
    target_member_id: personId,
    target_role: role,
  });
  if (error) return showToast(error.message || "账号权限保存失败");
  showToast("账号、成员和权限已绑定");
  await loadManagedAccounts();
}
function startOfDay(date) { const d = new Date(date); d.setHours(0,0,0,0); return d; }
function addDays(date, amount) { return new Date(startOfDay(date).getTime() + amount * DAY_MS); }
function isoDate(date) {
  const y = date.getFullYear(), m = String(date.getMonth()+1).padStart(2,"0"), d = String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}
function dateLabel(date) { return `${date.getMonth()+1}月${date.getDate()}日`; }
function weekday(date) { return "日一二三四五六"[date.getDay()]; }
function personById(id) { return people.find(p => p.id === id); }
function eventDates(event) { return [new Date(event.start), new Date(event.end)]; }
function dayOffset(date) { return Math.floor((startOfDay(date) - rangeStart) / DAY_MS); }
function overlap(a, b) {
  const [as, ae] = eventDates(a), [bs, be] = eventDates(b);
  return a.ownerId === b.ownerId && as < be && bs < ae;
}
function conflictIds() {
  const ids = new Set();
  for (let i=0;i<events.length;i++) for (let j=i+1;j<events.length;j++) {
    if (overlap(events[i], events[j])) { ids.add(events[i].id); ids.add(events[j].id); }
  }
  return ids;
}
function visiblePeople() {
  const q = els.searchInput.value.trim().toLowerCase();
  const dept = els.departmentFilter.value;
  return people.filter(p => {
    const related = events.some(e => e.ownerId === p.id && [e.title,e.city,e.type].join(" ").toLowerCase().includes(q));
    const viewMatch = currentView === "mine" ? currentUserId && p.id === currentUserId
      : currentView === "conflicts" ? conflictOwnerIds().has(p.id)
      : true;
    return viewMatch && (!dept || p.dept === dept) && (!q || `${p.name} ${p.role} ${p.dept}`.toLowerCase().includes(q) || related);
  });
}
function filteredEvents() {
  const q = els.searchInput.value.trim().toLowerCase();
  const conflicts = conflictIds();
  return events.filter(e => {
    const viewMatch = currentView === "mine" ? currentUserId && e.ownerId === currentUserId
      : currentView === "conflicts" ? conflicts.has(e.id)
      : true;
    return viewMatch && enabledStatuses.has(e.status) && (!q || `${e.title} ${e.city} ${e.type} ${personById(e.ownerId)?.name}`.toLowerCase().includes(q));
  });
}
function conflictOwnerIds() {
  const ids = conflictIds();
  return new Set(events.filter(e => ids.has(e.id)).map(e => e.ownerId));
}

function render() {
  renderViewChrome();
  if (currentView === "projects") {
    renderProjectList();
    return;
  }
  if (currentView === "activity") {
    renderActivityLog(activityLogError);
    return;
  }
  const end = addDays(rangeStart, days - 1);
  els.rangeTitle.textContent = `${rangeStart.getFullYear()}年 ${dateLabel(rangeStart)} — ${dateLabel(end)}`;
  document.documentElement.style.setProperty("--days", days);
  document.documentElement.style.setProperty("--day-width", days === 30 ? "72px" : days === 7 ? "118px" : "96px");

  const list = filteredEvents();
  const conflicts = conflictIds();
  const peopleList = visiblePeople();
  const visible = list.filter(e => {
    const [s, endDate] = eventDates(e);
    return startOfDay(s) <= end && startOfDay(endDate) >= rangeStart && peopleList.some(p => p.id === e.ownerId);
  });
  els.visibleEventCount.textContent = visible.length;
  els.progressCount.textContent = visible.filter(e => e.status === "progress").length;
  els.pendingCount.textContent = visible.filter(e => e.status === "pending").length;
  els.conflictCount.textContent = conflicts.size;
  els.navConflictCount.textContent = conflicts.size;

  const headerDays = Array.from({length: days}, (_,i) => addDays(rangeStart, i));
  let html = `<div class="grid-row header-row"><div class="person-cell"><div class="person-meta"><strong>成员 / 日期</strong><span>${peopleList.length} 位成员</span></div></div>`;
  const today = startOfDay(new Date());
  for (const d of headerDays) {
    const isToday = +d === +today;
    html += `<div class="day-header ${isToday ? "today":""}"><span>周${weekday(d)}</span><strong>${d.getMonth()+1}/${d.getDate()}</strong></div>`;
  }
  html += `</div>`;

  if (!peopleList.length) html += `<div class="empty-state">没有符合筛选条件的成员</div>`;
  for (const p of peopleList) {
    html += `<div class="grid-row person-row" data-person="${p.id}">
      <div class="person-cell"><div class="person-avatar" style="background:${p.color}">${p.name.slice(-2)}</div>
      <div class="person-meta"><strong>${p.name}</strong><span>${p.role} · ${p.dept}</span></div></div>`;
    for (const d of headerDays) {
      const weekend = [0,6].includes(d.getDay());
      html += `<div class="day-cell ${weekend?"weekend":""} ${+d===+today?"today":""}" data-date="${isoDate(d)}" data-person="${p.id}"></div>`;
    }
    html += `<div class="events-layer">${renderPersonEvents(p.id, visible, conflicts)}</div></div>`;
  }
  els.scheduleGrid.innerHTML = html;
  bindEventBlocks();
}

function renderViewChrome() {
  const titles = {
    overview: "团队实时排期",
    mine: `我的日程 · ${currentProfile.full_name || personById(currentUserId)?.name || "未绑定成员"}`,
    conflicts: "排期冲突中心",
    projects: "项目列表",
    activity: "日程操作日志",
  };
  els.pageTitle.textContent = titles[currentView];
  document.querySelectorAll(".nav-item[data-view]").forEach(button => {
    button.classList.toggle("active", button.dataset.view === currentView);
  });
  const nonScheduleView = ["projects", "activity"].includes(currentView);
  document.querySelector(".schedule-card").classList.toggle("hidden", nonScheduleView);
  document.querySelector(".toolbar-panel").classList.toggle("hidden", nonScheduleView);
  els.projectListCard.classList.toggle("hidden", currentView !== "projects");
  els.activityCard.classList.toggle("hidden", currentView !== "activity");
}

function renderProjectList() {
  const q = els.searchInput.value.trim().toLowerCase();
  const conflicts = conflictIds();
  const statusText = { confirmed:"已确认", pending:"待确认", progress:"进行中", draft:"草稿" };
  const sorted = [...events]
    .filter(e => !q || `${e.title} ${e.city} ${e.type} ${personById(e.ownerId)?.name}`.toLowerCase().includes(q))
    .sort((a,b) => new Date(a.start) - new Date(b.start));
  els.projectListCount.textContent = `共 ${sorted.length} 条日程 · 点击任意一行可编辑`;
  els.projectTableBody.innerHTML = sorted.map(e => {
    const owner = personById(e.ownerId);
    const start = new Date(e.start), end = new Date(e.end);
    return `<tr class="project-row" data-event="${e.id}">
      <td class="project-name"><strong>${e.title}</strong><span>${e.notes || "暂无备注"}</span></td>
      <td>${owner?.name || "未分配"}<br><small>${owner?.dept || ""}</small></td>
      <td>${formatDateTime(start)}<br>至 ${formatDateTime(end)}</td>
      <td>${e.city || "未填写"}<br><small>${e.venue || "未填写场地"}</small></td>
      <td>${e.type}</td>
      <td><span class="status-pill ${e.status}">${statusText[e.status]}</span></td>
      <td><span class="risk-pill ${conflicts.has(e.id)?"conflict":"normal"}">${conflicts.has(e.id)?"人员撞期":"正常"}</span></td>
    </tr>`;
  }).join("");
  document.querySelectorAll(".project-row").forEach(row => row.addEventListener("click", () => {
    openModal(events.find(e => e.id === row.dataset.event));
  }));
  const visible = sorted;
  els.visibleEventCount.textContent = visible.length;
  els.progressCount.textContent = visible.filter(e => e.status === "progress").length;
  els.pendingCount.textContent = visible.filter(e => e.status === "pending").length;
  els.conflictCount.textContent = conflicts.size;
}

function formatDateTime(date) {
  return `${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
}

function renderActivityLog(error = null) {
  if (error) {
    els.activityCount.textContent = "尚未启用";
    els.activityList.innerHTML = `<div class="empty-state">请先在 Supabase SQL Editor 执行操作日志增量 SQL。</div>`;
    return;
  }
  els.activityCount.textContent = `最近 ${activityLogs.length} 条`;
  if (!activityLogs.length) {
    els.activityList.innerHTML = `<div class="empty-state">还没有日程创建、修改或删除记录。</div>`;
    return;
  }
  const actionText = { insert: "创建", update: "修改", delete: "删除" };
  els.activityList.innerHTML = activityLogs.map(log => {
    const details = describeAuditChange(log);
    return `<article class="activity-row">
      <div class="activity-icon ${log.action}">${actionText[log.action]?.slice(0,1) || "记"}</div>
      <div class="activity-main">
        <div><strong>${escapeHtml(log.actor_name || "团队成员")}</strong> ${actionText[log.action] || "操作"}了
          <b>${escapeHtml(log.event_title || "未命名日程")}</b>
        </div>
        <span>${escapeHtml(details)}</span>
      </div>
      <time>${formatAuditTime(log.created_at)}</time>
    </article>`;
  }).join("");
}

function describeAuditChange(log) {
  if (log.action === "insert") return "新增日程并同步给团队";
  if (log.action === "delete") return "删除了该日程";
  const oldData = log.old_data || {}, newData = log.new_data || {};
  const fields = [
    ["title","项目名称"], ["owner_id","负责人"], ["start_at","开始时间"], ["end_at","结束时间"],
    ["status","状态"], ["city","城市"], ["business_type","业务类型"], ["venue","场地"], ["notes","备注"]
  ];
  const changed = fields.filter(([key]) => String(oldData[key] ?? "") !== String(newData[key] ?? "")).map(([,label]) => label);
  return changed.length ? `修改：${changed.join("、")}` : "更新了日程内容";
}

function formatAuditTime(value) {
  const date = new Date(value);
  return `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
}

function renderPersonEvents(personId, visible, conflicts) {
  return visible.filter(e => e.ownerId === personId).map(e => {
    const [start, end] = eventDates(e);
    const startIndex = Math.max(0, dayOffset(start));
    const endIndex = Math.min(days, dayOffset(end) + 1);
    const widthDays = Math.max(1, endIndex - startIndex);
    const left = `calc(${startIndex} * var(--day-width) + 5px)`;
    const width = `calc(${widthDays} * var(--day-width) - 10px)`;
    const conflict = conflicts.has(e.id);
    return `<article class="event-block ${e.status} ${conflict?"has-conflict":""}" data-event="${e.id}" style="left:${left};width:${width}" title="${e.title}｜${e.city}｜${e.venue}">
      <strong>${e.title}</strong><span>${e.city || "未填写"} · ${e.type}</span>${conflict?'<b class="conflict-badge">!</b>':""}
    </article>`;
  }).join("");
}

function bindEventBlocks() {
  document.querySelectorAll(".event-block").forEach(block => {
    block.addEventListener("click", () => {
      if (!dragState?.moved) openModal(events.find(e => e.id === block.dataset.event));
    });
    block.addEventListener("pointerdown", e => {
      const event = events.find(item => item.id === block.dataset.event);
      dragState = { id: event.id, x: e.clientX, originalStart: event.start, originalEnd: event.end, moved: false };
      block.setPointerCapture(e.pointerId);
    });
    block.addEventListener("pointermove", e => {
      if (!dragState || dragState.id !== block.dataset.event) return;
      const delta = Math.round((e.clientX - dragState.x) / parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--day-width")));
      if (delta !== 0) {
        dragState.moved = true;
        block.style.transform = `translateX(calc(${delta} * var(--day-width)))`;
        block.dataset.delta = delta;
      }
    });
    block.addEventListener("pointerup", () => {
      if (!dragState || dragState.id !== block.dataset.event) return;
      const delta = Number(block.dataset.delta || 0);
      if (dragState.moved && delta) {
        const event = events.find(item => item.id === dragState.id);
        event.start = shiftDateTime(dragState.originalStart, delta);
        event.end = shiftDateTime(dragState.originalEnd, delta);
        saveEvents(`“${event.title}”已移动 ${Math.abs(delta)} 天`, event);
        render();
      }
      setTimeout(() => { dragState = null; }, 0);
    });
  });
  document.querySelectorAll(".day-cell").forEach(cell => {
    cell.addEventListener("dblclick", () => openModal(null, cell.dataset.person, cell.dataset.date));
  });
}
function shiftDateTime(value, deltaDays) {
  const d = new Date(value); d.setDate(d.getDate()+deltaDays); return toLocalInput(d);
}
function toLocalInput(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function openModal(event, ownerId = null, date = isoDate(new Date())) {
  if (!people.length) return showToast("请先在团队设置中添加成员");
  ownerId ||= people[0].id;
  els.eventModal.classList.remove("hidden");
  els.eventId.value = event?.id || "";
  els.modalTitle.textContent = event ? "编辑日程" : "新建日程";
  els.deleteEvent.classList.toggle("hidden", !event);
  els.eventTitle.value = event?.title || "";
  els.eventOwner.value = event?.ownerId || ownerId;
  els.eventStatus.value = event?.status || "pending";
  els.eventStart.value = event?.start || `${date}T09:00`;
  els.eventEnd.value = event?.end || `${date}T18:00`;
  els.eventCity.value = event?.city || "";
  els.eventType.value = event?.type || "";
  els.eventVenue.value = event?.venue || "";
  els.eventNotes.value = event?.notes || "";
  setTimeout(() => els.eventTitle.focus(), 30);
}
function closeModal() { els.eventModal.classList.add("hidden"); }
function openTeamModal() {
  els.teamModal.classList.remove("hidden");
  resetMemberForm();
  resetGroupForm();
  renderTeamSettings();
}
function closeTeamModal() { els.teamModal.classList.add("hidden"); }
function openMemberEditor(person = null) {
  resetMemberForm();
  if (!groups().length) {
    showToast("请先在“小组管理”中创建一个小组");
    document.querySelector('[data-team-tab="groups"]').click();
    openGroupEditor();
    return;
  }
  if (person) {
    els.memberId.value = person.id;
    els.memberName.value = person.name;
    els.memberRole.value = person.role;
    els.memberGroup.value = person.dept;
    els.memberEditorTitle.textContent = "修改成员";
    els.saveMemberButton.textContent = "保存修改";
  }
  els.memberEditorModal.classList.remove("hidden");
  setTimeout(() => els.memberName.focus(), 30);
}
function closeMemberEditor() { els.memberEditorModal.classList.add("hidden"); resetMemberForm(); }
function openGroupEditor(group = "") {
  resetGroupForm();
  if (group) {
    els.groupOriginalName.value = group;
    els.groupName.value = group;
    els.groupEditorTitle.textContent = "重命名小组";
    els.saveGroupButton.textContent = "保存名称";
  }
  els.groupEditorModal.classList.remove("hidden");
  setTimeout(() => els.groupName.focus(), 30);
}
function closeGroupEditor() { els.groupEditorModal.classList.add("hidden"); resetGroupForm(); }
function showToast(text) {
  els.toast.textContent = text; els.toast.classList.add("show");
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 1800);
}

function groups() {
  return [...new Set(teamGroups.filter(Boolean))].sort((a,b) => a.localeCompare(b, "zh-CN"));
}

function refreshPeopleControls() {
  const departments = groups();
  const selectedDepartment = els.departmentFilter.value;
  els.departmentFilter.innerHTML = `<option value="">全部小组</option>${departments.map(d => `<option>${escapeHtml(d)}</option>`).join("")}`;
  if (departments.includes(selectedDepartment)) els.departmentFilter.value = selectedDepartment;
  els.eventOwner.innerHTML = people.map(p => `<option value="${p.id}">${escapeHtml(p.name)} · ${escapeHtml(p.role)}</option>`).join("");
  els.memberGroup.innerHTML = departments.length
    ? departments.map(d => `<option>${escapeHtml(d)}</option>`).join("")
    : `<option value="">请先创建小组</option>`;
}

function renderTeamSettings() {
  const departmentNames = groups();
  els.memberCountLabel.textContent = `共 ${people.length} 位成员`;
  els.groupCountLabel.textContent = `共 ${departmentNames.length} 个小组`;
  els.memberList.innerHTML = people.length ? people.map(person => `
    <div class="setting-row">
      <div class="person-avatar" style="background:${person.color}">${escapeHtml(person.name.slice(-2))}</div>
      <div class="setting-main"><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.role)} · ${escapeHtml(person.dept)}</span></div>
      <div class="setting-actions">
        <button class="small-action edit-member" data-id="${person.id}">编辑</button>
        <button class="small-action delete delete-member" data-id="${person.id}">删除</button>
      </div>
    </div>`).join("") : `<div class="empty-settings">还没有成员，请在上方添加。</div>`;

  els.groupList.innerHTML = departmentNames.length ? departmentNames.map(group => {
    const count = people.filter(person => person.dept === group).length;
    return `<div class="setting-row">
      <div class="setting-main"><strong>${escapeHtml(group)}</strong><span>小组成员</span></div>
      <span class="group-count">${count}</span>
      <div class="setting-actions">
        <button class="small-action edit-group" data-group="${escapeAttribute(group)}">重命名</button>
        <button class="small-action delete delete-group" data-group="${escapeAttribute(group)}">删除</button>
      </div>
    </div>`;
  }).join("") : `<div class="empty-settings">还没有小组，请先创建一个小组。</div>`;

  document.querySelectorAll(".edit-member").forEach(button => button.addEventListener("click", () => editMember(button.dataset.id)));
  document.querySelectorAll(".delete-member").forEach(button => button.addEventListener("click", () => deleteMember(button.dataset.id)));
  document.querySelectorAll(".edit-group").forEach(button => button.addEventListener("click", () => editGroup(button.dataset.group)));
  document.querySelectorAll(".delete-group").forEach(button => button.addEventListener("click", () => deleteGroup(button.dataset.group)));
}

function editMember(id) {
  const person = people.find(item => item.id === id);
  if (!person) return;
  openMemberEditor(person);
}

function resetMemberForm() {
  els.memberForm.reset();
  els.memberId.value = "";
  els.memberEditorTitle.textContent = "添加成员";
  els.saveMemberButton.textContent = "确认添加";
  refreshPeopleControls();
}

async function deleteMember(id) {
  const person = people.find(item => item.id === id);
  if (!person) return;
  const assigned = events.filter(event => event.ownerId === id);
  if (assigned.length) {
    showToast(`${person.name}仍有 ${assigned.length} 条日程，请先调整负责人`);
    return;
  }
  if (!confirm(`确定删除成员“${person.name}”吗？`)) return;
  const { error } = await supabaseClient.from("members").delete().eq("id", id);
  if (error) return showToast(error.message);
  await loadCloudData();
  showToast("成员已删除");
}

function editGroup(group) {
  openGroupEditor(group);
}

function resetGroupForm() {
  els.groupForm.reset();
  els.groupOriginalName.value = "";
  els.groupEditorTitle.textContent = "创建小组";
  els.saveGroupButton.textContent = "确认创建";
}

async function deleteGroup(group) {
  const count = people.filter(person => person.dept === group).length;
  if (count) {
    showToast(`“${group}”仍有 ${count} 位成员，请先调整所属小组`);
    return;
  }
  if (!confirm(`确定删除空小组“${group}”吗？`)) return;
  teamGroups = teamGroups.filter(item => item !== group);
  await saveTeamGroups("小组已删除");
  showToast("小组已删除");
  refreshPeopleControls(); renderTeamSettings(); render();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
}
function escapeAttribute(value = "") { return escapeHtml(value); }

async function init() {
  bindLoginForm();
  refreshPeopleControls();
  els.rangeSelector.querySelectorAll("button[data-days]").forEach(button => {
    button.classList.toggle("active", Number(button.dataset.days) === days);
  });
  document.querySelectorAll(".filter-check input").forEach(input => input.addEventListener("change", () => {
    input.checked ? enabledStatuses.add(input.value) : enabledStatuses.delete(input.value); render();
  }));
  els.searchInput.addEventListener("input", render);
  els.departmentFilter.addEventListener("change", render);
  els.rangeSelector.addEventListener("click", e => {
    const button = e.target.closest("button[data-days]"); if (!button) return;
    days = Number(button.dataset.days);
    els.rangeSelector.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === button));
    render();
  });
  document.getElementById("prevRange").addEventListener("click", () => { rangeStart = addDays(rangeStart, -days); render(); });
  document.getElementById("nextRange").addEventListener("click", () => { rangeStart = addDays(rangeStart, days); render(); });
  document.getElementById("todayButton").addEventListener("click", () => { rangeStart = startOfDay(new Date()); render(); });
  document.getElementById("addEventButton").addEventListener("click", () => openModal());
  document.getElementById("teamSettingsButton").addEventListener("click", openTeamModal);
  document.getElementById("closeTeamModal").addEventListener("click", closeTeamModal);
  els.teamModal.addEventListener("click", event => { if (event.target === els.teamModal) closeTeamModal(); });
  document.getElementById("openMemberEditor").addEventListener("click", () => openMemberEditor());
  document.getElementById("openGroupEditor").addEventListener("click", () => openGroupEditor());
  document.getElementById("closeMemberEditor").addEventListener("click", closeMemberEditor);
  document.getElementById("closeGroupEditor").addEventListener("click", closeGroupEditor);
  els.memberEditorModal.addEventListener("click", event => { if (event.target === els.memberEditorModal) closeMemberEditor(); });
  els.groupEditorModal.addEventListener("click", event => { if (event.target === els.groupEditorModal) closeGroupEditor(); });
  document.querySelectorAll(".team-tab").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll(".team-tab").forEach(tab => tab.classList.toggle("active", tab === button));
    els.membersPanel.classList.toggle("hidden", button.dataset.teamTab !== "members");
    els.groupsPanel.classList.toggle("hidden", button.dataset.teamTab !== "groups");
    els.accountsPanel.classList.toggle("hidden", button.dataset.teamTab !== "accounts");
    if (button.dataset.teamTab === "accounts") loadManagedAccounts();
  }));
  els.refreshAccounts.addEventListener("click", loadManagedAccounts);
  els.memberForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!els.memberGroup.value) return showToast("请先创建一个小组");
    const id = els.memberId.value;
    if (id) {
      const { error } = await supabaseClient.from("members").update({
        name: els.memberName.value.trim(),
        role: els.memberRole.value.trim(),
        group_name: els.memberGroup.value,
      }).eq("id", id);
      if (error) return showToast(error.message);
      await loadCloudData();
      showToast("成员资料已修改");
    } else {
      const colors = ["#4778f5","#ee6a8a","#8b5cf6","#16a085","#f59e0b","#12a36d","#3b82f6","#e879f9","#64748b","#ef4444","#06b6d4"];
      const { error } = await supabaseClient.from("members").insert({
        team_id: currentProfile.team_id,
        name: els.memberName.value.trim(),
        role: els.memberRole.value.trim(),
        group_name: els.memberGroup.value,
        color: colors[people.length % colors.length],
      });
      if (error) return showToast(error.message);
      await loadCloudData();
      showToast("新成员已添加");
    }
    closeMemberEditor();
  });
  els.cancelMemberEdit.addEventListener("click", closeMemberEditor);
  els.groupForm.addEventListener("submit", async event => {
    event.preventDefault();
    const original = els.groupOriginalName.value;
    const next = els.groupName.value.trim();
    if (!next) return;
    if (groups().includes(next) && next !== original) return showToast("已存在同名小组");
    if (original) {
      const { error } = await supabaseClient.from("members").update({ group_name: next }).eq("team_id", currentProfile.team_id).eq("group_name", original);
      if (error) return showToast(error.message);
      teamGroups = teamGroups.map(group => group === original ? next : group);
      await saveTeamGroups("小组名称已修改");
      await loadCloudData();
    } else {
      teamGroups.push(next);
      await saveTeamGroups("小组已创建");
    }
    closeGroupEditor();
    renderTeamSettings();
  });
  els.cancelGroupEdit.addEventListener("click", closeGroupEditor);
  document.querySelectorAll(".nav-item[data-view]").forEach(button => {
    button.addEventListener("click", async () => {
      currentView = button.dataset.view;
      if (currentView === "conflicts" && conflictIds().size === 0) showToast("当前没有人员排期冲突");
      if (currentView === "activity") await loadActivityLogs();
      render();
    });
  });
  document.getElementById("closeModal").addEventListener("click", closeModal);
  document.getElementById("cancelModal").addEventListener("click", closeModal);
  els.eventModal.addEventListener("click", e => { if (e.target === els.eventModal) closeModal(); });
  els.eventForm.addEventListener("submit", async e => {
    e.preventDefault();
    if (new Date(els.eventEnd.value) <= new Date(els.eventStart.value)) return showToast("结束时间必须晚于开始时间");
    const payload = {
      id: els.eventId.value || null,
      projectId: events.find(item => item.id === els.eventId.value)?.projectId || null,
      title: els.eventTitle.value.trim(), ownerId: els.eventOwner.value,
      status: els.eventStatus.value, start: els.eventStart.value, end: els.eventEnd.value,
      city: els.eventCity.value.trim(), type: els.eventType.value.trim() || "未分类", venue: els.eventVenue.value.trim(), notes: els.eventNotes.value.trim()
    };
    const index = events.findIndex(item => item.id === payload.id);
    const saved = await saveEvents(index >= 0 ? "日程修改已同步" : "新日程已同步给团队", payload);
    if (saved) closeModal();
  });
  els.deleteEvent.addEventListener("click", async () => {
    const event = events.find(item => item.id === els.eventId.value);
    if (!event || !confirm(`确定删除“${event.title}”吗？`)) return;
    const { error } = await supabaseClient.rpc("delete_schedule", { p_assignment_id: event.id });
    if (error) return showToast(error.message);
    await loadCloudData();
    showToast("日程已删除"); closeModal();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      closeModal(); closeMemberEditor(); closeGroupEditor(); closeTeamModal();
      document.body.classList.remove("schedule-expanded");
    }
  });
  window.addEventListener("focus", () => {
    if (backendAvailable) {
      loadEventsFromSupabase();
      if (currentView === "activity") loadActivityLogs();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (backendAvailable && document.visibilityState === "visible") loadEventsFromSupabase();
  });
  els.expandSchedule.addEventListener("click", () => {
    document.body.classList.add("schedule-expanded");
    setTimeout(() => els.scheduleScroll.scrollTo({ left: 0, top: 0, behavior: "smooth" }), 30);
  });
  els.closeExpandedSchedule.addEventListener("click", () => document.body.classList.remove("schedule-expanded"));
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    document.getElementById("installButton").classList.remove("hidden");
  });
  document.getElementById("installButton").addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    document.getElementById("installButton").classList.add("hidden");
  });
  els.accountButton.addEventListener("click", async () => {
    if (!backendAvailable) return showToast("云端尚未连接");
    if (!confirm(`当前账号：${currentProfile.full_name || "团队成员"}。是否退出登录？`)) return;
    await supabaseClient.auth.signOut();
    location.reload();
  });
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", event => {
      if (event.data?.type === "K_LOUD_UPDATE_READY" && !reloadingForUpdate && els.authScreen.classList.contains("hidden")) {
        reloadingForUpdate = true;
        location.reload();
      }
    });
    const registration = await navigator.serviceWorker.register("/service-worker.js", { updateViaCache: "none" });
    registration.update();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") registration.update();
    });
  }
  const connected = await connectBackend();
  if (!connected) return;
  render();
}
init();
