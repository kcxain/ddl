import fs from "node:fs/promises";
import path from "node:path";

const dist = path.resolve("dist");

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });
await fs.copyFile("index.html", path.join(dist, "index.html"));
await fs.cp("src", path.join(dist, "src"), { recursive: true });
await fs.cp("public", dist, { recursive: true });

console.log(`Built static site in ${dist}`);
