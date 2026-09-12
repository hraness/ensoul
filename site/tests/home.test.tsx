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

test("scopes editorial framing while keeping product positioning and release evidence visible", () => {
  const html = renderToStaticMarkup(<Home />);
  const elements: string[] = [];
  new HTMLRewriter()
    .on('[data-hraness-marketing-preset="editorial"] .hraness-marketing-header', {
      element() { elements.push("header"); },
    })
    .on('[data-hraness-marketing-preset="editorial"] #main .hraness-marketing-field .hraness-marketing-proof-frame', {
      element() { elements.push("proof"); },
    })
    .transform(html);
  expect(elements).toEqual(["header", "proof"]);
  expect(html).toContain('<p class="hraness-marketing-hero__example">An Agent Skill for evidence-calibrated person models</p>');
  expect(html).toContain(`<p class="install-note">Current verified release · ${publishedRelease.package}@${publishedRelease.version}</p>`);
});
