const TZ = "Asia/Shanghai";
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

const state = {
  conferences: [],
  tracked: [],
  now: new Date(),
  renderKey: ""
};

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
}

function parseDateTime(value, timezone = "AoE") {
  if (!value || value === "TBD") return null;

  const body = String(value).replace(" ", "T");
  if (timezone === "AoE") return new Date(`${body}-12:00`);
  if (timezone === "PT") return new Date(`${body}-08:00`);

  let match = String(timezone).match(/^UTC([+-]\d{1,2})$/);
  if (match) {
    const sign = match[1].startsWith("-") ? "-" : "+";
    const hour = match[1].replace(/[+-]/, "").padStart(2, "0");
    return new Date(`${body}${sign}${hour}:00`);
  }

  match = String(timezone).match(/^UTC([+-]\d{1,2}):(\d{2})$/);
  if (match) {
    const sign = match[1].startsWith("-") ? "-" : "+";
    const hour = match[1].replace(/[+-]/, "").padStart(2, "0");
    return new Date(`${body}${sign}${hour}:${match[2]}`);
  }

  return new Date(body);
}

function deadlineOf(conference) {
  return parseDateTime(conference?.deadline, conference?.timezone);
}

function abstractOf(conference) {
  return parseDateTime(conference?.abstractDeadline, conference?.timezone);
}

function timeLeft(target, now = state.now) {
  if (!target || Number.isNaN(target.getTime())) return null;
  const totalMs = target.getTime() - now.getTime();
  const totalSeconds = Math.floor(Math.max(0, totalMs) / 1000);

  return {
    totalMs,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60
  };
}

function formatUtc8(date) {
  if (!date || Number.isNaN(date.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function utc8Day(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const pick = (type) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(pick("year"), pick("month") - 1, pick("day"));
}

function dayKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function keysFor(conference) {
  return [
    conference.id,
    conference.title,
    conference.description,
    conference.dblp,
    ...(conference.aliases ?? [])
  ].filter(Boolean);
}

function pickTrackedConference(token, conferences) {
  const normalized = normalizeToken(token);
  const matches = conferences.filter((conference) =>
    keysFor(conference).some((key) => normalizeToken(key) === normalized)
  );

  return matches
    .filter((conference) => deadlineOf(conference)?.getTime() > state.now.getTime())
    .sort((a, b) => deadlineOf(a) - deadlineOf(b))[0] ?? null;
}

function activeConferences() {
  return state.tracked
    .map((token) => pickTrackedConference(token, state.conferences))
    .filter(Boolean)
    .sort((a, b) => deadlineOf(a) - deadlineOf(b));
}

function calendarTargets(conferences) {
  return conferences.flatMap((conference) => {
    const abstract = abstractOf(conference);
    const deadline = deadlineOf(conference);
    const rows = [];

    if (abstract && abstract.getTime() > state.now.getTime()) {
      rows.push({ title: conference.title, type: "abstract", day: startOfDay(utc8Day(abstract)) });
    }
    if (deadline && deadline.getTime() > state.now.getTime()) {
      rows.push({ title: conference.title, type: "deadline", day: startOfDay(utc8Day(deadline)) });
    }
    return rows;
  });
}

function renderCalendar(conferences) {
  const targets = calendarTargets(conferences);
  if (!targets.length) return "";

  const today = startOfDay(utc8Day(state.now));
  const lastTarget = targets.map((item) => item.day).sort((a, b) => b - a)[0];
  const firstDay = new Date(today);
  firstDay.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const lastDay = new Date(lastTarget.getFullYear(), lastTarget.getMonth() + 1, 0);
  const dayCount = Math.ceil((lastDay - firstDay) / 86400000) + 1;
  const targetsByDay = new Map();

  for (const target of targets) {
    const key = dayKey(target.day);
    targetsByDay.set(key, [...(targetsByDay.get(key) ?? []), target]);
  }

  const cells = WEEKDAYS.map((day) => `<span class="calendarWeekday">${day}</span>`);
  let lastWeekMonth = null;

  for (let index = 0; index < dayCount; index += 1) {
    const day = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + index);

    if (index % 7 === 0) {
      if (lastWeekMonth !== null && day.getMonth() !== lastWeekMonth) {
        cells.push(`<span class="calendarMonthBand">${day.getMonth() + 1}月</span>`);
      }
      lastWeekMonth = day.getMonth();
    }

    const items = targetsByDay.get(dayKey(day)) ?? [];
    const isToday = dayKey(day) === dayKey(today);
    const classes = ["calendarCell"];

    const label = [...new Set(items.map((item) => item.title))].join(" ") || (isToday ? "今天" : "");
    if (isToday) classes.push("today");
    if (items.length) classes.push("target");
    if (items.length && items.every((item) => item.type === "abstract")) classes.push("abstractTarget");
    if (label.length >= 5) classes.push("longLabel");

    cells.push(`<span class="${classes.join(" ")}"><span>${html(label)}</span></span>`);
  }

  return `
    <div class="calendarGrid" aria-label="calendar">${cells.join("")}</div>
  `;
}

const WORK_WINDOW_MS = 60 * 86400000;

function workProgress(conference, now = state.now) {
  const deadline = deadlineOf(conference);
  if (!deadline) return null;
  const elapsed = now.getTime() - (deadline.getTime() - WORK_WINDOW_MS);
  return Math.max(0, Math.min(100, (elapsed / WORK_WINDOW_MS) * 100));
}

function renderPrimaryCard(conference) {
  const deadline = deadlineOf(conference);
  const abstract = abstractOf(conference);
  const diff = timeLeft(deadline);
  const abstractStillOpen = abstract && abstract.getTime() > state.now.getTime();
  const progress = workProgress(conference);

  return `
    <section class="countdownPanel">
      <div class="panelTop">
        <h1>${html(conference.title)}</h1>
      </div>
      <div class="daysLine">
        <strong class="js-days">${diff?.totalMs <= 0 ? "已截止" : diff?.days ?? "--"}</strong><span>天</span>
      </div>
      <div class="subCountdown">
        <div><strong class="js-hours">${String(diff?.hours ?? "--").padStart(2, "0")}</strong><span>小时</span></div>
        <div><strong class="js-minutes">${String(diff?.minutes ?? "--").padStart(2, "0")}</strong><span>分钟</span></div>
        <div><strong class="js-seconds">${String(diff?.seconds ?? "--").padStart(2, "0")}</strong><span>秒</span></div>
      </div>
      ${progress === null ? "" : `<div class="deadlineProgress"><div class="js-progress" style="width:${progress.toFixed(2)}%"></div></div>`}
      <footer>
        ${abstractStillOpen ? `<span class="deadlineTime">${html(formatUtc8(abstract))}</span>` : ""}
        <span class="deadlineTime">${html(formatUtc8(deadline))}</span>
      </footer>
    </section>
  `;
}

function renderCompactConference(conference) {
  const diff = timeLeft(deadlineOf(conference));
  return `
    <div class="compactConference">
      <span>${html(conference.title)}</span>
      <strong class="js-compact-days" data-id="${html(conference.id)}">${diff?.days ?? "--"}天</strong>
    </div>
  `;
}

function renderEmpty() {
  return `
    <section class="missingPanel">
      <h1>暂无未来 DDL</h1>
      <p>后台列表中的会议当前没有尚未截止的条目；等 ccfddl 同步到新 DDL 后会自动显示。</p>
    </section>
  `;
}

function layoutSignature(conferences) {
  return [
    conferences.map((conference) => [
      conference.id,
      conference.abstractDeadline ?? "",
      conference.deadline ?? "",
      conference.timezone ?? ""
    ].join(":")).join("|"),
    dayKey(utc8Day(state.now))
  ].join("::");
}

function render() {
  const panelStack = document.getElementById("panel-stack");
  const conferences = activeConferences();
  const [primary, ...secondary] = conferences;
  const signature = layoutSignature(conferences);

  if (state.renderKey === signature) {
    updateCountdown(conferences);
    return;
  }

  state.renderKey = signature;
  panelStack.innerHTML = primary
    ? `<div class="countdownStack">
        ${renderPrimaryCard(primary)}
        ${secondary.length ? `<div class="compactList">${secondary.map(renderCompactConference).join("")}</div>` : ""}
      </div>
      <section class="calendarPanel">${renderCalendar(conferences)}</section>`
    : renderEmpty();

  updateCountdown(conferences);
}

function updateCountdown(conferences) {
  const [primary, ...secondary] = conferences;
  if (!primary) return;

  const diff = timeLeft(deadlineOf(primary));
  document.title = `${primary.title} ${diff?.days ?? "--"}天`;

  const setText = (selector, value) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
  };

  setText(".js-days", diff?.totalMs <= 0 ? "已截止" : String(diff?.days ?? "--"));
  setText(".js-hours", String(diff?.hours ?? "--").padStart(2, "0"));
  setText(".js-minutes", String(diff?.minutes ?? "--").padStart(2, "0"));
  setText(".js-seconds", String(diff?.seconds ?? "--").padStart(2, "0"));

  const progress = workProgress(primary);
  const progressNode = document.querySelector(".js-progress");
  if (progressNode && progress !== null) progressNode.style.width = `${progress.toFixed(2)}%`;

  for (const conference of secondary) {
    const node = document.querySelector(`.js-compact-days[data-id="${CSS.escape(conference.id)}"]`);
    if (node) node.textContent = `${timeLeft(deadlineOf(conference))?.days ?? "--"}天`;
  }
}

function demoConferences(baseData, tracked) {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const toSourceDate = (date) =>
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:00`;

  return {
    ...baseData,
    conferences: [
      ...baseData.conferences,
      ...tracked.map((title, index) => {
        const deadline = new Date(now.getTime() + (index + 1) * 9 * 86400000 + index * 7 * 3600000);
        const abstract = new Date(deadline.getTime() - 3 * 86400000);
        return {
          id: `demo-${normalizeToken(title)}`,
          title,
          description: title,
          aliases: [title],
          abstractDeadline: toSourceDate(abstract),
          deadline: toSourceDate(deadline),
          timezone: "UTC+0",
          source: "demo"
        };
      })
    ]
  };
}

async function load() {
  try {
    const [conferenceData, trackedData] = await Promise.all([
      fetch("./conferences.json").then((response) => response.json()),
      fetch("./tracked-conferences.json").then((response) => response.json())
    ]);
    const demo = new URLSearchParams(window.location.search).has("demo");
    state.conferences = demo ? demoConferences(conferenceData, trackedData).conferences : conferenceData.conferences;
    state.tracked = trackedData;
  } catch {
    state.conferences = [];
    state.tracked = [];
  }
  render();
}

window.setInterval(() => {
  state.now = new Date();
  render();
}, 1000);

load();
