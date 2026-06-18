import fs from "node:fs/promises";
import path from "node:path";

const OWNER = "ccfddl";
const REPO = "ccf-deadlines";
const BRANCH = "main";
const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;
const OUT_FILE = path.resolve("public/conferences.json");
const ICS_FILE = path.resolve("public/calendar.ics");
const HEALTH_FILE = path.resolve("public/health.json");
const MANUAL_FILE = path.resolve("public/manual-conferences.json");
const OVERRIDES_FILE = path.resolve("public/overrides.json");
const TRACKED_FILE = path.resolve("public/tracked-conferences.json");
const SOURCE_MAP_FILE = path.resolve("public/ccfddl-sources.json");

const headers = {
  "Accept": "application/vnd.github+json",
  "User-Agent": "ddl-countdown-sync"
};
const FETCH_TIMEOUT_MS = 20000;
const DOWNLOAD_CONCURRENCY = 6;
const FETCH_RETRIES = 3;

if (process.env.GITHUB_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

async function getText(url) {
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      return await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function parseScalar(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "'" || char === '"') && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === "#" && !quote) return line.slice(0, index);
  }
  return line;
}

function splitKeyValue(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if ((char === "'" || char === '"') && text[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === ":" && !quote) {
      return [text.slice(0, index).trim(), text.slice(index + 1).trim()];
    }
  }
  return [text.trim(), ""];
}

function nextContentLine(lines, startIndex) {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const text = stripComment(lines[index]).trim();
    if (text) return text;
  }
  return "";
}

function parseYamlSubset(raw) {
  const root = [];
  const stack = [{ indent: -1, value: root }];
  const lines = raw.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const withoutComment = stripComment(lines[lineIndex]).replace(/\s+$/, "");
    if (!withoutComment.trim()) continue;

    const indent = withoutComment.match(/^ */)?.[0].length ?? 0;
    const text = withoutComment.trim();
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();

    const parent = stack.at(-1).value;
    if (text.startsWith("- ")) {
      if (!Array.isArray(parent)) {
        throw new Error(`Unexpected list item at line ${lineIndex + 1}`);
      }

      const rest = text.slice(2).trim();
      const item = {};
      parent.push(item);
      stack.push({ indent, value: item });

      if (rest) {
        const [key, value] = splitKeyValue(rest);
        item[key] = value ? parseScalar(value) : {};
        if (!value) stack.push({ indent: indent + 1, value: item[key] });
      }
      continue;
    }

    const [key, value] = splitKeyValue(text);
    if (!key) continue;

    if (value) {
      parent[key] = parseScalar(value);
      continue;
    }

    const childText = nextContentLine(lines, lineIndex);
    parent[key] = childText.startsWith("- ") ? [] : {};
    stack.push({ indent, value: parent[key] });
  }

  return root;
}

function normalizeDeadline(raw) {
  if (!raw || raw === "TBD") return null;
  return String(raw).trim();
}

function normalizeOne(root, conf, sourcePath) {
  const timeline = asArray(conf.timeline);
  const deadlines = timeline
    .map((item, index) => ({
      kind: firstDefined(item?.name, item?.type, index === 0 ? "submission" : `round-${index + 1}`),
      abstractDeadline: normalizeDeadline(item?.abstract_deadline),
      deadline: normalizeDeadline(item?.deadline),
      timezone: firstDefined(item?.timezone, conf.timezone, root.timezone, "AoE")
    }))
    .filter((item) => item.deadline);

  const latestDeadline = deadlines.at(-1);
  if (!latestDeadline) return null;

  const title = String(firstDefined(root.title, root.name, conf.title, conf.id, "")).trim();
  const description = String(firstDefined(root.description, root.full_name, root.name_en, "")).trim();
  const year = Number(conf.year);
  const aliases = new Set([
    title,
    title.toLowerCase(),
    description,
    conf.id,
    root.dblp,
    sourcePath.split("/").at(-1)?.replace(/\.ya?ml$/i, ""),
    Number.isFinite(year) ? `${title} ${year}` : null,
    Number.isFinite(year) ? `${title}${String(year).slice(-2)}` : null,
    Number.isFinite(year) ? `${description} ${year}` : null
  ].filter(Boolean));

  return {
    id: firstDefined(conf.id, `${title.toLowerCase()}-${conf.year}`),
    title,
    description,
    aliases: [...aliases],
    sub: firstDefined(root.sub, conf.sub),
    rank: root.rank ?? {},
    dblp: root.dblp ?? null,
    year: conf.year ?? null,
    deadline: latestDeadline.deadline,
    abstractDeadline: latestDeadline.abstractDeadline,
    timezone: latestDeadline.timezone,
    timeline: deadlines,
    date: conf.date ?? null,
    place: conf.place ?? null,
    link: conf.link ?? null,
    source: `ccfddl:${sourcePath}`
  };
}

function normalizeYamlDocument(document, sourcePath) {
  const roots = asArray(document).filter(Boolean);
  const rows = [];

  for (const root of roots) {
    for (const conf of asArray(root.confs)) {
      const normalized = normalizeOne(root, conf, sourcePath);
      if (normalized) rows.push(normalized);
    }
  }

  return rows;
}

async function readManualConferences() {
  try {
    const raw = await fs.readFile(MANUAL_FILE, "utf8");
    return JSON.parse(raw)
      .filter((item) => !item.disabled)
      .map((item) => ({
        aliases: [],
        rank: {},
        source: "manual",
        ...item
      }));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function normalizeToken(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
}

function parseDeadline(conference) {
  return parseDeadlineValue(conference?.deadline, conference?.timezone);
}

function parseAbstractDeadline(conference) {
  return parseDeadlineValue(conference?.abstractDeadline, conference?.timezone);
}

function parseDeadlineValue(value, timezoneValue) {
  if (!value || value === "TBD") return null;
  const deadline = String(value).replace(" ", "T");
  const timezone = String(timezoneValue ?? "AoE");

  if (timezone === "AoE") return new Date(`${deadline}-12:00`);
  if (timezone === "PT") return new Date(`${deadline}-08:00`);

  let match = timezone.match(/^UTC([+-]\d{1,2})$/);
  if (match) {
    const sign = match[1].startsWith("-") ? "-" : "+";
    const hour = match[1].replace(/[+-]/, "").padStart(2, "0");
    return new Date(`${deadline}${sign}${hour}:00`);
  }

  match = timezone.match(/^UTC([+-]\d{1,2}):(\d{2})$/);
  if (match) {
    const sign = match[1].startsWith("-") ? "-" : "+";
    const hour = match[1].replace(/[+-]/, "").padStart(2, "0");
    return new Date(`${deadline}${sign}${hour}:${match[2]}`);
  }

  return new Date(deadline);
}

function nextMilestone(conference, now) {
  const abstract = parseAbstractDeadline(conference);
  const deadline = parseDeadline(conference);
  if (abstract && abstract.getTime() > now.getTime()) {
    return abstract;
  }
  return deadline;
}

function conferenceKeys(conference) {
  return [
    conference.title,
    conference.description,
    conference.dblp,
    ...(conference.aliases ?? [])
  ].filter(Boolean);
}

function isTrackedConference(conference, trackedTokens) {
  const keys = conferenceKeys(conference).map(normalizeToken);
  return trackedTokens.some((token) => keys.includes(token));
}

function overrideKeys(conference) {
  return [conference.id, conference.title, conference.dblp, ...(conference.aliases ?? [])]
    .filter(Boolean);
}

function applyOverrides(conference, overrideEntries) {
  const keys = overrideKeys(conference);
  const overrides = keys
    .flatMap((key) => [overrideEntries.get(key), overrideEntries.get(normalizeToken(key))])
    .filter(Boolean);

  if (!overrides.length) return conference;

  const merged = Object.assign({}, conference, ...overrides);
  if (overrides.some((override) => override.disabled)) return null;
  if (conference.aliases || merged.aliases) {
    merged.aliases = [...new Set([...(conference.aliases ?? []), ...(merged.aliases ?? [])])];
  }
  return merged;
}

function icsDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsEscape(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function makeIcs(conferences, generatedAt) {
  const events = [];

  for (const conference of conferences) {
    const milestones = [
      ["abstract", "Abstract", parseAbstractDeadline(conference)],
      ["deadline", "Deadline", parseDeadline(conference)]
    ].filter(([, , date]) => date && date.getTime() > generatedAt.getTime());

    for (const [kind, label, date] of milestones) {
      const end = new Date(date.getTime() + 15 * 60 * 1000);
      events.push([
        "BEGIN:VEVENT",
        `UID:${icsEscape(`${conference.id}-${kind}@ddl-countdown`)}`,
        `DTSTAMP:${icsDate(generatedAt)}`,
        `DTSTART:${icsDate(date)}`,
        `DTEND:${icsDate(end)}`,
        `SUMMARY:${icsEscape(`${conference.title} ${label}`)}`,
        `DESCRIPTION:${icsEscape(`${conference.title} ${label} deadline (${conference.timezone ?? "AoE"})`)}`,
        conference.link ? `URL:${icsEscape(conference.link)}` : null,
        "END:VEVENT"
      ].filter(Boolean).join("\r\n"));
    }
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DDL Countdown//Conference Deadlines//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR"
  ].join("\r\n") + "\r\n";
}

async function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

const tracked = await readJsonFile(TRACKED_FILE, []);
const sourceMap = await readJsonFile(SOURCE_MAP_FILE, {});
const overridesRaw = await readJsonFile(OVERRIDES_FILE, {});
const overrideEntries = new Map(
  Array.isArray(overridesRaw)
    ? overridesRaw.flatMap((override) => (override.keys ?? [override.id, override.title, override.dblp])
      .filter(Boolean)
      .flatMap((key) => [[key, override], [normalizeToken(key), override]]))
    : Object.entries(overridesRaw).flatMap(([key, override]) => [[key, override], [normalizeToken(key), override]])
);
const normalizedSourceMap = new Map(
  Object.entries(sourceMap).map(([token, source]) => [normalizeToken(token), source])
);
const yamlFiles = [...new Set(tracked.map((token) => normalizedSourceMap.get(normalizeToken(token))).filter(Boolean))];
const missingSources = tracked.filter((token) => !normalizedSourceMap.get(normalizeToken(token)));

if (missingSources.length) {
  throw new Error(`Missing ccfddl source mapping for: ${missingSources.join(", ")}`);
}

const fetched = [];

for (let offset = 0; offset < yamlFiles.length; offset += DOWNLOAD_CONCURRENCY) {
  const batch = yamlFiles.slice(offset, offset + DOWNLOAD_CONCURRENCY);
  const rows = await Promise.all(batch.map(async (yamlPath) => {
    const raw = await getText(`${RAW_BASE}/${yamlPath}`);
    const parsed = parseYamlSubset(raw);
    return normalizeYamlDocument(parsed, yamlPath);
  }));
  fetched.push(...rows.flat());
  console.log(`Fetched ${Math.min(offset + DOWNLOAD_CONCURRENCY, yamlFiles.length)}/${yamlFiles.length}`);
}

const manual = await readManualConferences();
const byId = new Map();
const trackedTokens = tracked.map(normalizeToken);
const now = new Date();

for (const item of [...fetched, ...manual]) {
  const overridden = applyOverrides(item, overrideEntries);
  if (!overridden) continue;
  const deadline = parseDeadline(overridden);
  if (!deadline || deadline.getTime() <= now.getTime()) continue;
  if (!isTrackedConference(overridden, trackedTokens)) continue;
  byId.set(overridden.id, overridden);
}

const conferences = [...byId.values()].sort((a, b) => {
  const aDeadline = nextMilestone(a, now)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bDeadline = nextMilestone(b, now)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return aDeadline - bDeadline || String(a.title).localeCompare(String(b.title));
});

await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
const generatedAt = new Date();
const activeTokens = new Set();
for (const conference of conferences) {
  for (const token of trackedTokens) {
    if (isTrackedConference(conference, [token])) activeTokens.add(token);
  }
}
const inactiveTracked = tracked.filter((token) => !activeTokens.has(normalizeToken(token)));
const health = {
  generatedAt: generatedAt.toISOString(),
  trackedCount: tracked.length,
  sourceCount: yamlFiles.length,
  activeCount: conferences.length,
  inactiveTracked,
  warnings: [
    ...inactiveTracked.map((token) => `${token}: no future deadline in configured sources`)
  ]
};

await fs.writeFile(
  OUT_FILE,
  `${JSON.stringify({
    generatedAt: generatedAt.toISOString(),
    source: `https://github.com/${OWNER}/${REPO}`,
    count: conferences.length,
    conferences
  }, null, 2)}\n`
);
await fs.writeFile(HEALTH_FILE, `${JSON.stringify(health, null, 2)}\n`);
await fs.writeFile(ICS_FILE, makeIcs(conferences, generatedAt));

console.log(`Wrote ${conferences.length} conferences to ${OUT_FILE}`);
console.log(`Wrote ${ICS_FILE}`);
if (health.warnings.length) {
  console.log(`Health warnings: ${health.warnings.join("; ")}`);
}
