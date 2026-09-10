import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { renderLandingModule } from "../scripts/sync-readme.ts";
import { extractLandingMarkdown } from "../scripts/readme-html.ts";
import { landingHtml } from "../app/landing.generated.ts";

const site = join(import.meta.dir, "..");
const read = async (path: string): Promise<string> => await readFile(join(site, path), "utf8");

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

describe("Soulscrape site source contract", () => {
  test("advertises only the verified published release", async () => {
    const [home, publication, packageSource] = await Promise.all([
      read("app/page.tsx"),
      read("published-release.json"),
      readFile(join(site, "..", "package.json"), "utf8"),
    ]);
    const publishedRelease = record(JSON.parse(publication) as unknown, "published release");
    const packageJson = record(JSON.parse(packageSource) as unknown, "source package");
    expect(Object.keys(publishedRelease).sort()).toEqual([
      "archiveUrl", "package", "releaseUrl", "skill", "skillInstall", "version",
    ]);
    expect(publishedRelease.version).toMatch(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u);
    expect(String(publishedRelease.archiveUrl)).toMatch(
      /^https:\/\/github\.com\/hraness\/(?:ensoul|soulscrape)\/releases\/download\/v[0-9.]+\/hraness-(?:ensoul|soulscrape)-[0-9.]+\.tgz$/u,
    );
    expect(String(publishedRelease.releaseUrl)).toContain(`/releases/tag/v${String(publishedRelease.version)}`);
    expect(String(publishedRelease.skillInstall)).toContain(`#v${String(publishedRelease.version)} --skill ${String(publishedRelease.skill)}`);
    expect(packageJson.name).toBe("@hraness/soulscrape");
    expect(home).toContain('import publishedRelease from "../published-release.json"');
    expect(home).toContain("const releaseVersion = publishedRelease.version;");
    expect(home).not.toContain("package.json");
    expect(home).not.toMatch(/v0\.\d+\.\d+/u);
  });

  test("renders the README landing block and keeps it committed in sync", async () => {
    const [committed, fresh, readme] = await Promise.all([
      read("app/landing.generated.ts"),
      renderLandingModule(),
      readFile(join(site, "..", "README.md"), "utf8"),
    ]);
    expect(committed).toBe(fresh);
    const markdown = extractLandingMarkdown(readme);
    expect(markdown).not.toContain("# Soulscrape\n");
    expect(markdown).not.toContain("[![skills.sh]");
    expect(markdown).toContain("## See the artifact first");
    expect(markdown).toContain("## How the working model is built");
    expect(markdown).not.toContain("## One skill, three interfaces");
    expect(landingHtml).toContain('<h2 id="see-the-artifact-first">');
    expect(committed).toContain("questions.md");
    expect(committed).toContain("web-research.md");
    expect(committed).not.toContain("<script");
  });

  test("uses the shared Hraness design grammar and Ask AI links", async () => {
    const [packageJson, home, globals, layout] = await Promise.all([
      read("package.json"),
      read("app/page.tsx"),
      read("app/globals.css"),
      read("app/layout.tsx"),
    ]);
    expect(packageJson).toContain('"@hraness/design-kit": "github:hraness/design-kit#v0.4.0"');
    expect(packageJson).toContain('"@hraness/ui": "github:hraness/ui#v0.4.10"');
    expect(home).toContain('import { AskAiAboutThis } from "@hraness/ui"');
    expect(home).toContain('<AskAiAboutThis className="ask-ai" url="https://soulscrape.com" />');
    expect(globals).toContain('@import "@hraness/design-kit/fonts.css"');
    expect(globals).toContain('@import "@hraness/design-kit/product-marketing.css"');
    expect(globals).toContain('--font-text: "Nebula Sans"');
    expect(globals).not.toMatch(/Georgia|Times New Roman/u);
    expect(layout).toContain('metadataBase: new URL("https://soulscrape.com")');
    expect(layout).toContain('url: "/favicon.svg"');
  });

  test("states the boundaries the skill enforces", async () => {
    const home = await read("app/page.tsx");
    expect(home).toContain("Authorized evidence only");
    expect(home).toContain("Asking before guessing");
    expect(home).toContain("Research under your instructions");
    expect(home).toContain("Public web research is off by default.");
    expect(home).toContain("These are product boundaries, not optional cautions.");
    expect(home).toContain("What happened to Ensoul?");
  });

  test("contains no private paths and uses the Vercel Next.js boundary", async () => {
    const [packageJsonSource, vercelConfigSource, home, layout, sitemap, robots] = await Promise.all([
      read("package.json"),
      read("vercel.json"),
      read("app/page.tsx"),
      read("app/layout.tsx"),
      read("public/sitemap.xml"),
      read("public/robots.txt"),
    ]);
    const packageJson = record(JSON.parse(packageJsonSource) as unknown, "package.json");
    const scripts = record(packageJson.scripts, "package.json scripts");
    expect(packageJson.name).toBe("soulscrape-site");
    expect(packageJson.packageManager).toBe("bun@1.3.14");
    expect(packageJson.engines).toEqual({ node: "24.x" });
    expect(scripts).toEqual({
      build: "next build --webpack",
      check: "bun run sync:readme && bun run test && bun run lint && bun run typecheck && bun run build",
      dev: "bun run sync:readme && next dev --webpack",
      lint: "eslint . --ignore-pattern .next",
      start: "next start",
      "sync:readme": "bun scripts/sync-readme.ts",
      test: "bun test ./tests/source.test.ts ./tests/home.test.tsx",
      typecheck: "tsc --noEmit",
    });
    expect(JSON.parse(vercelConfigSource)).toEqual({
      $schema: "https://openapi.vercel.sh/vercel.json",
      buildCommand: "bun run sync:readme && bun run build",
      framework: "nextjs",
      installCommand: "bun install --frozen-lockfile --ignore-scripts",
    });
    expect(sitemap).toContain("<loc>https://soulscrape.com/</loc>");
    expect(robots).toContain("Sitemap: https://soulscrape.com/sitemap.xml");
    expect(`${home}\n${layout}`).not.toMatch(/\/Users\/[^/\s]+|\/private\/tmp\/[^\s)]+/iu);
  });
});
