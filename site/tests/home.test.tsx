import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import Home from "../app/page";
import publishedRelease from "../published-release.json";

test("renders the hero, the README method, boundaries, and the verified install", () => {
  const html = renderToStaticMarkup(<Home />);
  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(html).toContain("Understand a person without pretending to contain them");
  expect(html).toContain('<article class="readme-prose">');
  expect(html).toContain('<h2 id="see-the-artifact-first">');
  expect(html).toContain("Authorized evidence only");
  expect(html).toContain(publishedRelease.skillInstall);
  expect(html).toContain(publishedRelease.archiveUrl);
  expect(html).toContain(`${publishedRelease.package}@${publishedRelease.version}`);
  expect(html).toContain('aria-label="Ask AI about this"');
  expect(html).toContain("What happened to Ensoul?");
  expect(html).not.toContain("undefined");
});
