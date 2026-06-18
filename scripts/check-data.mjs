import fs from "node:fs/promises";

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

const conferences = await readJson("public/conferences.json");
const health = await readJson("public/health.json");
const ics = await fs.readFile("public/calendar.ics", "utf8");

if (!Array.isArray(conferences.conferences)) {
  throw new Error("public/conferences.json is missing conferences[]");
}

if (conferences.count !== conferences.conferences.length) {
  throw new Error("public/conferences.json count does not match conferences.length");
}

if (health.activeCount !== conferences.conferences.length) {
  throw new Error("public/health.json activeCount does not match generated conferences");
}

if (conferences.conferences.length === 0) {
  throw new Error("No future deadlines were generated for the tracked list");
}

if (!ics.includes("BEGIN:VCALENDAR") || !ics.includes("BEGIN:VEVENT")) {
  throw new Error("public/calendar.ics has no calendar events");
}

console.log(`Data check passed: ${conferences.conferences.length} active future conference(s)`);
