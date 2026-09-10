import { resolve } from "node:path";
import { extractLandingMarkdown, renderReadmeHtml } from "./readme-html.ts";

const siteRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(siteRoot, "..");

export async function renderLandingModule(): Promise<string> {
  const readme = await Bun.file(resolve(repositoryRoot, "README.md")).text();
  const html = renderReadmeHtml(extractLandingMarkdown(readme));
  return `// Generated from ../README.md by scripts/sync-readme.ts. Do not edit.\nexport const landingHtml = ${JSON.stringify(html)};\n`;
}

if (import.meta.main) {
  await Bun.write(resolve(siteRoot, "app/landing.generated.ts"), await renderLandingModule());
}
