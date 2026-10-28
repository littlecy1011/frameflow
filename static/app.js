const state = {
  candidates: [],
  stats: {},
  filter: "all",
  sort: "default",
  query: "",
  view: "topics",
  stageFilter: null,
  selectedId: null,
  selectedMode: null,
  busy: new Set(),
  handoffs: {},
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const labels = {
  pending: "待判断",
  approved: "已入选",
  later: "稍后",
  rejected: "已淘汰",
  candidate: "候选",
  analyzing: "拆解中",
  ready_for_generation: "待生成",
  generating: "生成中",
  review: "待审片",
  completed: "已完成",
  failed: "失败",
  running: "运行中",
  queued: "排队中",
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "日期未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

function platformMark(platform = "") {
  const normalized = platform.toLowerCase();
  if (normalized.includes("instagram")) return "IG";
  if (normalized.includes("youtube")) return "YT";
  if (normalized.includes("tiktok")) return "TT";
  if (normalized.includes("小红书")) return "RED";
  if (normalized.includes("抖音")) return "DY";
  return normalized.slice(0, 3).toUpperCase() || "WEB";
}

function metricValue(value) {
  const raw = String(value || "").trim().toUpperCase().replaceAll(",", "");
  if (!raw || raw === "未知") return Number.NEGATIVE_INFINITY;
  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)\s*(K|M|B|万|亿)?$/);
  if (!match) return Number.NEGATIVE_INFINITY;
  const multipliers = { K: 1e3, M: 1e6, B: 1e9, "万": 1e4, "亿": 1e8 };
  return Number(match[1]) * (multipliers[match[2]] || 1);
}

function publishedValue(value) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

function statusFor(candidate) {
  if (candidate.codex_status === "in_progress") return ["analyzing", "Codex 拆解中"];
  if (candidate.workflow_stage === "ready_for_generation") return ["ready", "待生成"];
  if (candidate.codex_status === "blocked" || candidate.job?.status === "failed") return ["failed", "需要处理"];
  return [candidate.decision, labels[candidate.decision] || candidate.decision];
}

function renderCard(candidate) {
  const [statusClass, statusText] = statusFor(candidate);
  const busy = state.busy.has(candidate.id);
  const job = candidate.job;
  const progress = job && ["queued", "running"].includes(job.status) ? Number(job.progress || 0) : 0;
  const actions = candidate.decision === "pending"
    ? `<button class="button primary small" data-action="approve" data-id="${candidate.id}" ${busy ? "disabled" : ""}>入选并拆解</button>
       <button class="button ghost small" data-action="later" data-id="${candidate.id}">稍后</button>
       <button class="button text small" data-action="reject" data-id="${candidate.id}">淘汰</button>`
    : candidate.codex_status === "blocked"
      ? `<button class="button primary small" data-action="retry" data-id="${candidate.id}">重试拆解</button>`
      : candidate.project_link
        ? `<button class="button primary small" data-action="project" data-id="${candidate.id}">查看制作包</button>`
        : `<button class="button ghost small" data-action="detail" data-id="${candidate.id}">查看进度</button>`;

  return `
    <article class="candidate-card" data-id="${candidate.id}">
      <div class="card-content">
        <div class="card-meta">
          <span class="status ${statusClass}"><i></i>${escapeHtml(statusText)}</span>
          <span class="platform-pill">${escapeHtml(platformMark(candidate.source_platform))}</span>
        </div>
        <h2>${escapeHtml(candidate.title)}</h2>
        <dl class="metrics-grid">
          <div><dt>平台</dt><dd>${escapeHtml(candidate.source_platform || "未知")}</dd></div>
          <div><dt>发布日期</dt><dd>${escapeHtml(candidate.source_published_at || "未知")}</dd></div>
          <div><dt>点赞</dt><dd>${escapeHtml(candidate.likes || "未知")}</dd></div>
          <div><dt>评论</dt><dd>${escapeHtml(candidate.comments || "未知")}</dd></div>
        </dl>
        ${progress ? `
          <div class="progress-wrap">
            <div class="progress-label"><span>${escapeHtml(job.message || "自动处理中")}</span><b>${progress}%</b></div>
            <div class="progress"><span style="width:${progress}%"></span></div>
          </div>` : ""}
        <div class="card-actions">${actions}<button class="icon-button card-more" data-action="detail" data-id="${candidate.id}" aria-label="查看详情">···</button></div>
      </div>
    </article>`;
}

function visibleCandidates() {
  const query = state.query.trim().toLowerCase();
  const items = state.candidates.filter((candidate) => {
    let matchesView = true;
    if (state.view === "production") {
      matchesView = ["analyzing", "ready_for_generation", "generating"].includes(candidate.workflow_stage);
    } else if (state.view === "review") {
      matchesView = candidate.workflow_stage === "review";
    } else if (state.view === "archive") {
      matchesView = ["ready_to_publish", "published", "archived"].includes(candidate.workflow_stage);
    }
    if (state.stageFilter === "pending") matchesView = candidate.decision === "pending";
    if (state.stageFilter === "analyzing") matchesView = candidate.workflow_stage === "analyzing";
    if (state.stageFilter === "ready_for_generation") matchesView = candidate.workflow_stage === "ready_for_generation";
    if (state.stageFilter === "review") matchesView = candidate.workflow_stage === "review";
    const matchesFilter = state.view !== "topics" || state.filter === "all" || candidate.decision === state.filter;
    const haystack = `${candidate.title} ${candidate.source_creator} ${candidate.source_platform}`.toLowerCase();
    return matchesView && matchesFilter && (!query || haystack.includes(query));
  });
  const selectors = {
    likes: (candidate) => metricValue(candidate.likes),
    comments: (candidate) => metricValue(candidate.comments),
    published: (candidate) => publishedValue(candidate.source_published_at),
  };
  const selector = selectors[state.sort];
  return selector ? items.sort((left, right) => selector(right) - selector(left)) : items;
}

function render() {
  const items = visibleCandidates();
  $("#candidateGrid").innerHTML = items.map(renderCard).join("");
  $("#emptyState").classList.toggle("hidden", items.length > 0);

  const stats = state.stats || {};
  $("#statPending").textContent = stats.pending || 0;
  $("#statAnalyzing").textContent = stats.analyzing || 0;
  $("#statReady").textContent = stats.ready || 0;
  $("#statReview").textContent = stats.review || 0;
  $("#navPending").textContent = stats.pending || 0;
  $("#navReady").textContent = stats.ready || 0;

  const viewTitles = { topics: "选题池", production: "制作队列", review: "审片中心", archive: "发布复盘" };
  $("#viewTitle").textContent = viewTitles[state.view] || "选题池";
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === state.view));
  $(".toolbar").classList.toggle("view-toolbar-hidden", state.view !== "topics");
  $$(".stat-card").forEach((item) => item.classList.toggle("active", item.dataset.stage === state.stageFilter));

  if (state.selectedId) {
    const candidate = state.candidates.find((item) => item.id === state.selectedId);
    if (candidate && state.selectedMode === "candidate") renderDetail(candidate);
  }
}

function analysisHtml(candidate) {
  const job = candidate.job;
  if (!job) return `<div class="detail-callout"><strong>尚未开始拆解</strong><p>点击“入选并拆解”后，Codex 会在后台自动处理。</p></div>`;
  if (["queued", "running"].includes(job.status)) {
    return `<div class="detail-callout violet"><strong>${escapeHtml(job.message || "Codex 正在处理")}</strong><p>可以关闭此面板，任务仍会继续。</p><div class="progress"><span style="width:${job.progress || 0}%"></span></div></div>`;
  }
  if (job.status === "failed") {
    return `<div class="detail-callout danger"><strong>拆解失败</strong><p>${escapeHtml(job.error || "未知错误")}</p><button class="button primary small" data-action="retry" data-id="${candidate.id}">重新拆解</button></div>`;
  }
  const result = job.result;
  if (!result) return "";
  const list = (items = []) => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  return `
    <div class="analysis-result">
      <div class="verdict-row"><span class="verdict">${escapeHtml(result.verdict)}</span><span>置信度 ${escapeHtml(result.confidence)}</span></div>
      <p class="result-summary">${escapeHtml(result.summary)}</p>
      <h3>爆点机制假设</h3>
      <dl class="mechanics">
        <div><dt>钩子</dt><dd>${escapeHtml(result.viral_mechanics?.hook)}</dd></div>
        <div><dt>情绪</dt><dd>${escapeHtml(result.viral_mechanics?.emotion)}</dd></div>
        <div><dt>视觉</dt><dd>${escapeHtml(result.viral_mechanics?.visual)}</dd></div>
      </dl>
      <h3>原创迁移策略</h3><p>${escapeHtml(result.adaptation_strategy)}</p>
      <h3>仍需核验</h3>${list(result.unverified_items)}
      <h3>风险</h3>${list(result.risks)}
      <div class="detail-callout mint"><strong>制作包已写回 Obsidian</strong><p>${escapeHtml(candidate.project_link || "项目链接已生成")}</p></div>
      <div class="production-readiness" data-readiness-for="${candidate.id}"></div>
      <button class="button primary full" data-action="readiness" data-id="${candidate.id}">查看 Hypit 制作准备状态</button>
    </div>`;
}

function renderDetail(candidate) {
  $("#detailKicker").textContent = "CANDIDATE DETAIL";
  $("#detailTitle").textContent = candidate.title;
  const [statusClass, statusText] = statusFor(candidate);
  $("#detailBody").innerHTML = `
    <div class="detail-meta">
      <span class="status ${statusClass}"><i></i>${escapeHtml(statusText)}</span>
      <span>${escapeHtml(candidate.source_platform || "平台未知")}</span>
      <span>${escapeHtml(candidate.source_published_at || "日期未知")}</span>
      <span>点赞 ${escapeHtml(candidate.likes || "未知")}</span>
      <span>评论 ${escapeHtml(candidate.comments || "未知")}</span>
    </div>
    <div class="detail-source">
      <span>参考来源</span>
      ${candidate.source_url ? `<a href="${escapeHtml(candidate.source_url)}" target="_blank" rel="noreferrer">打开原视频 ↗</a>` : "<b>未提供链接</b>"}
    </div>
    <article class="markdown-preview">${renderMarkdownPreview(candidate.content)}</article>
    <section class="detail-analysis"><p class="eyebrow">CODEX ANALYSIS</p>${analysisHtml(candidate)}</section>`;
}

function renderMarkdownDocument(markdown = "") {
  const lines = markdown.split("\n");
  const output = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line || line.startsWith("# ")) { index += 1; continue; }
    if (line.startsWith("|")) {
      const tableLines = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      const rows = tableLines
        .filter((row) => !/^\|?[\s|:-]+\|?$/.test(row))
        .map((row) => row.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
      if (rows.length) {
        const head = rows[0];
        output.push(`<div class="package-table-wrap"><table><thead><tr>${head.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      }
      continue;
    }
    if (line.startsWith("## ")) output.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    else if (line.startsWith("### ")) output.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
    else if (line.startsWith("- [ ] ")) output.push(`<div class="check-row"><span>□</span><span>${escapeHtml(line.slice(6))}</span></div>`);
    else if (line.startsWith("- [x] ")) output.push(`<div class="check-row done"><span>✓</span><span>${escapeHtml(line.slice(6))}</span></div>`);
    else if (line.startsWith("- ")) output.push(`<div class="bullet-row"><span>•</span><span>${escapeHtml(line.slice(2))}</span></div>`);
    else if (/^\d+\.\s/.test(line)) output.push(`<div class="number-row"><span>${escapeHtml(line.match(/^\d+/)[0])}</span><span>${escapeHtml(line.replace(/^\d+\.\s*/, ""))}</span></div>`);
    else output.push(`<p>${escapeHtml(line)}</p>`);
    index += 1;
  }
  return output.join("");
}

function renderHandoff(id, handoff = {}) {
  const promptButtons = (handoff.video_prompts || []).map((item, index) => `
    <button class="handoff-prompt-button" data-action="copy-video-prompt" data-id="${id}" data-index="${index}">
      <span>${escapeHtml(item.label || `镜头 ${index + 1}`)}</span><b>复制提示词</b>
    </button>`).join("");
  return `
    <section class="handoff-card">
      <p class="eyebrow">FINAL INPUT KIT</p>
      <h2>你最终带走什么</h2>
      <div class="handoff-mode">${escapeHtml(handoff.recommended_mode || "待确认")}</div>
      <div class="handoff-list">
        <div><span>参考视频</span><strong>${handoff.reference_video_required ? "需要作为模型输入" : "不需要上传"}</strong><p>${escapeHtml(handoff.reference_video_role || "")}</p></div>
        <div><span>定妆照</span><strong>${handoff.image_required ? "需要" : "不需要"}</strong><p>${escapeHtml(handoff.image_requirement || "")}</p></div>
        <div><span>视频提示词</span><strong>${escapeHtml(handoff.video_prompt_count || 0)} 段</strong><p>按镜头复制到你选择的视频生成网站。</p></div>
      </div>
      <div class="handoff-image-box">
        <div><strong>定妆照怎么生成</strong><p>${escapeHtml(handoff.image_generation_location || "")}</p></div>
        <button class="button ghost small" data-action="copy-image-prompt" data-id="${id}">复制定妆照提示词</button>
      </div>
      <div class="handoff-prompts">${promptButtons}</div>
      <button class="button primary full" data-action="copy-all-inputs" data-id="${id}">复制全部制作输入</button>
    </section>`;
}

async function openProject(id) {
  const candidate = state.candidates.find((item) => item.id === id);
  state.selectedId = id;
  state.selectedMode = "project";
  $("#detailKicker").textContent = "PRODUCTION INPUT KIT";
  $("#detailTitle").textContent = candidate?.title || "制作包";
  $("#detailBody").innerHTML = `<div class="detail-callout violet"><strong>正在读取制作包</strong><p>内容来自 Obsidian 中的最新文件。</p></div>`;
  $("#detailPanel").classList.add("open");
  $("#detailPanel").setAttribute("aria-hidden", "false");
  try {
    const project = await api(`/api/candidates/${id}/project`);
    state.handoffs[id] = project.handoff || {};
    $("#detailTitle").textContent = project.title || candidate?.title || "制作包";
    $("#detailBody").innerHTML = `
      <div class="package-status"><span class="status ready"><i></i>待生成</span><span>更新于 ${escapeHtml(project.updated || "未知")}</span></div>
      ${renderHandoff(id, project.handoff)}
      <details class="full-package-details">
        <summary>查看完整拆解与判断依据</summary>
        <article class="package-document">${renderMarkdownDocument(project.content)}</article>
      </details>`;
  } catch (error) {
    $("#detailBody").innerHTML = `<div class="detail-callout danger"><strong>制作包读取失败</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function switchView(view, stage = null) {
  state.view = view;
  state.stageFilter = stage;
  state.filter = "all";
  $$(".filter").forEach((item) => item.classList.toggle("active", item.dataset.filter === "all"));
  render();
}

function renderMarkdownPreview(markdown = "") {
  return markdown
    .split("\n")
    .filter((line) => !line.startsWith("# "))
    .slice(0, 36)
    .map((line) => {
      if (line.startsWith("## ")) return `<h3>${escapeHtml(line.slice(3))}</h3>`;
      if (line.startsWith("- [ ] ")) return `<div class="check-row"><span>□</span>${escapeHtml(line.slice(6))}</div>`;
      if (line.startsWith("- ")) return `<div class="bullet-row"><span>•</span>${escapeHtml(line.slice(2))}</div>`;
      if (!line.trim()) return "";
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("");
}

function openDetail(id) {
  state.selectedId = id;
  state.selectedMode = "candidate";
  const candidate = state.candidates.find((item) => item.id === id);
  if (candidate) renderDetail(candidate);
  $("#detailPanel").classList.add("open");
  $("#detailPanel").setAttribute("aria-hidden", "false");
}

function closeDetail() {
  state.selectedId = null;
  state.selectedMode = null;
  $("#detailPanel").classList.remove("open");
  $("#detailPanel").setAttribute("aria-hidden", "true");
}

function toast(message, tone = "success") {
  const item = document.createElement("div");
  item.className = `toast ${tone}`;
  item.innerHTML = `<span>${tone === "success" ? "✓" : "!"}</span><p>${escapeHtml(message)}</p>`;
  $("#toastStack").appendChild(item);
  setTimeout(() => item.remove(), 4200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || "请求失败"), { payload });
  return payload;
}

async function load({ silent = false } = {}) {
  if (!silent) $("#syncStatus").innerHTML = "<span></span>正在同步";
  try {
    const payload = await api("/api/candidates");
    state.candidates = payload.items || [];
    state.stats = payload.stats || {};
    render();
    $("#syncStatus").innerHTML = `<span></span>已同步 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  } catch (error) {
    $("#syncStatus").innerHTML = "<span class='error-dot'></span>同步失败";
    if (!silent) toast(error.message, "error");
  }
}

async function setDecision(id, decision) {
  state.busy.add(id);
  render();
  try {
    const payload = await api(`/api/candidates/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
    const messages = {
      approved: "已入选，Codex 正在后台拆解",
      rejected: "已淘汰并写回 Obsidian",
      later: "已放入稍后队列",
      pending: "已恢复为待判断",
    };
    toast(messages[decision]);
    if (payload.job_id) openDetail(id);
  } catch (error) {
    toast(error.message, "error");
  } finally {
    state.busy.delete(id);
    await load({ silent: true });
  }
}

async function confirmApproval(id) {
  const dialog = $("#confirmDialog");
  dialog.showModal();
  const result = await new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true });
  });
  if (result === "confirm") await setDecision(id, "approved");
}

async function retry(id) {
  try {
    await api(`/api/candidates/${id}/retry`, { method: "POST", body: "{}" });
    toast("已重新提交 Codex 拆解");
    await load({ silent: true });
    openDetail(id);
  } catch (error) {
    toast(error.message, "error");
  }
}

async function showReadiness(id) {
  const target = document.querySelector(`[data-readiness-for="${id}"]`);
  if (target) target.innerHTML = `<div class="detail-callout violet"><strong>正在检查制作准备状态</strong></div>`;
  try {
    const result = await api(`/api/candidates/${id}/production-readiness`);
    const checks = [
      [result.brief_ready, "Brief"],
      [result.treatment_ready, "Treatment"],
      [result.prompt_pack_ready, "逐镜头提示词包"],
      [result.executable_ready, "Hypit executable"],
      [result.runtime_connected, "Runtime 与模型 Provider"],
      [result.quote_available, "实时报价"],
    ];
    if (target) target.innerHTML = `
      <div class="readiness-card">
        <div class="readiness-head"><strong>${escapeHtml(result.message)}</strong><span>不会自动扣费</span></div>
        <div class="readiness-checks">${checks.map(([ready, label]) => `<div class="${ready ? "ready" : "pending"}"><b>${ready ? "✓" : "○"}</b><span>${escapeHtml(label)}</span><em>${ready ? "已就绪" : "未连接"}</em></div>`).join("")}</div>
        <h4>接下来需要</h4>
        <ol>${(result.next_steps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
      </div>`;
  } catch (error) {
    if (target) target.innerHTML = `<div class="detail-callout danger"><strong>状态读取失败</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value || "");
    toast(successMessage);
  } catch (error) {
    toast("复制失败，请在完整制作包中手动复制", "error");
  }
}

function copyHandoff(id, kind, index = 0) {
  const handoff = state.handoffs[id] || {};
  if (kind === "image") return copyText(handoff.image_prompt, "已复制定妆照提示词");
  if (kind === "video") {
    const item = (handoff.video_prompts || [])[Number(index)];
    const text = item ? `${item.prompt}\n\n负面提示词：${item.negative_prompt || ""}` : "";
    return copyText(text, `已复制${item?.label || "视频"}提示词`);
  }
  const all = [
    `推荐组合：${handoff.recommended_mode || ""}`,
    `参考视频：${handoff.reference_video_role || ""}`,
    `定妆照要求：${handoff.image_requirement || ""}`,
    `定妆照提示词：\n${handoff.image_prompt || ""}`,
    ...(handoff.video_prompts || []).map((item) => `${item.label}\n${item.prompt}\n负面提示词：${item.negative_prompt || ""}`),
  ].join("\n\n");
  return copyText(all, "已复制全部制作输入");
}

document.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-action]");
  if (!action) return;
  const { id } = action.dataset;
  if (action.dataset.action === "approve") return confirmApproval(id);
  if (action.dataset.action === "later") return setDecision(id, "later");
  if (action.dataset.action === "reject") return setDecision(id, "rejected");
  if (action.dataset.action === "detail") return openDetail(id);
  if (action.dataset.action === "project") return openProject(id);
  if (action.dataset.action === "retry") return retry(id);
  if (action.dataset.action === "readiness") return showReadiness(id);
  if (action.dataset.action === "copy-image-prompt") return copyHandoff(id, "image");
  if (action.dataset.action === "copy-video-prompt") return copyHandoff(id, "video", action.dataset.index);
  if (action.dataset.action === "copy-all-inputs") return copyHandoff(id, "all");
});

$$('.nav-item').forEach((button) => button.addEventListener("click", () => {
  switchView(button.dataset.view);
}));

$$('.stat-card').forEach((button) => button.addEventListener("click", () => {
  const stage = button.dataset.stage;
  if (stage === "pending") return switchView("topics", "pending");
  if (stage === "review") return switchView("review", "review");
  return switchView("production", stage);
}));

$$('.filter').forEach((button) => button.addEventListener("click", () => {
  $$('.filter').forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  state.stageFilter = null;
  state.filter = button.dataset.filter;
  render();
}));

$("#searchInput").addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

$("#sortSelect").addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});

$("#refreshButton").addEventListener("click", () => load());
$("#closeDetail").addEventListener("click", closeDetail);
$("#detailPanel").addEventListener("click", (event) => {
  if (event.target === $("#detailPanel")) closeDetail();
});

load();
setInterval(() => load({ silent: true }), 4000);

