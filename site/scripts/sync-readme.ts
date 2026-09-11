import { resolve } from "node:path";
import { extractLandingMarkdown, renderReadmeHtml } from "./readme-html.ts";
import publishedRelease from "../published-release.json";

const siteRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(siteRoot, "..");

/** Keep the website install on its admitted release while source prepares the next one. */
export function projectPublishedInstall(
  markdown: string,
  release: Readonly<{ version: string; skillInstall: string }>,
): string {
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(release.version)
    || release.version.split(".").some((part) => !Number.isSafeInteger(Number(part)))) {
    throw new Error("Published release version is not a stable version");
  }
  const command = `bunx skills add hraness/soulscrape#v${release.version} --skill soulscrape`;
  if (release.skillInstall !== command) throw new Error("Published skill command does not match its version");
  const sourceCommand = /^bunx skills add hraness\/soulscrape#v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*) --skill soulscrape$/gmu;
  if (Array.from(markdown.matchAll(sourceCommand)).length !== 1) {
    throw new Error("README landing must contain exactly one pinned skill command");
  }
  return markdown.replace(sourceCommand, command);
}

export async function renderLandingModule(): Promise<string> {
  const readme = await Bun.file(resolve(repositoryRoot, "README.md")).text();
  const markdown = projectPublishedInstall(extractLandingMarkdown(readme), publishedRelease);
  const html = renderReadmeHtml(markdown);
  return `// Generated from ../README.md by scripts/sync-readme.ts. Do not edit.\nexport const landingHtml = ${JSON.stringify(html)};\n`;
}

if (import.meta.main) {
  await Bun.write(resolve(siteRoot, "app/landing.generated.ts"), await renderLandingModule());
}
