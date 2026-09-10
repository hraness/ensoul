import {
  MarketingCallToAction,
  MarketingInstallPanel,
  MarketingInterfaceGrid,
  MarketingMaker,
  MarketingPage,
  MarketingProofFrame,
  MarketingQuestionList,
  MarketingSection,
  MarketingSiteHeader,
  MarketingTrustBoundary,
  ProductHero,
} from "@hraness/design-kit/react/server";
import { AskAiAboutThis } from "@hraness/ui";

import { landingHtml } from "./landing.generated";
import publishedRelease from "../published-release.json";

const repository = "https://github.com/hraness/soulscrape";
const releaseVersion = publishedRelease.version;

const heading = "Understand a person without pretending to contain them";
const lead =
  "Soulscrape turns the evidence you are authorized to use into a dated, evidence-calibrated working model of a person: how they have tended to decide, communicate, work, and revise, with the counterevidence, uncertainty, and stop conditions a useful model needs.";
const footnote =
  `Free and MIT licensed. An Agent Skill for Claude Code, Codex, Cursor, and compatible agents. Current verified release ${publishedRelease.package}@${releaseVersion}.`;

const artifactPreview = `# <Name>: a dated working model

> Status: Partial, source-bounded, dated, and revisable. The real person's
> current words, choices, and corrections outrank this document.

## Executive model
The few patterns that best explain the subject's demonstrated choices.

## Practical operating manual
How to bring context, disagree, decide, draft, verify, and close loops.

## Tensions, limits, and revision hooks
Where the evidence conflicts, where the model predicts poorly, and what
new evidence should change it.

## What not to infer
Sensitive, unsupported, stale, or out-of-scope conclusions.`;

const trust = [
  {
    label: "Authorized evidence only",
    detail: "Soulscrape reads the corpus you place in scope and nothing else. Possessing messages, a packet, or public information is not the subject's authorization, and the skill says so before it starts.",
  },
  {
    label: "Asking before guessing",
    detail: "A question packet records the subject, the intended use, the evidence available and missing, what you must authorize, and when the work is done. The skill asks once, only for what changes the result.",
  },
  {
    label: "Research under your instructions",
    detail: "Public web research is off by default. When you turn it on, scope comes from your words: allowed sources, time window, depth, and purpose. Every finding carries its URL, access date, passage, and identity binding, and nothing is attributed to a person from a name alone.",
  },
  {
    label: "Calibrated, not confident",
    detail: "Facts, stated beliefs, revealed patterns, and speculation stay separate. Contradictions are preserved. Confidence describes support within the evidence examined, never how essentially a claim defines someone.",
  },
] as const;

const interfaces = [
  {
    label: "Agent Skill",
    summary: "Install the skill through skills.sh, then ask for a dated working model from the sources you authorize.",
    example: (
      <>
        <pre tabIndex={0}><code>{publishedRelease.skillInstall}</code></pre>
        <p className="interface-link"><a href={`${repository}/blob/main/skills/soulscrape/SKILL.md`}>Read the skill</a></p>
      </>
    ),
  },
  {
    label: "Immutable package",
    summary: "The GitHub Release archive carries the complete skill, its references, and the dependency-free packet utilities.",
    example: (
      <>
        <pre tabIndex={0}><code>{`bun add --exact ${publishedRelease.archiveUrl}`}</code></pre>
        <p className="interface-link"><a href={publishedRelease.releaseUrl}>Inspect the release</a></p>
      </>
    ),
  },
  {
    label: "Source packets",
    summary: "Message Like Me and Peopleblade export bounded, attributed, digest-checked evidence packets that the skill validates offline before reading.",
    example: (
      <>
        <pre tabIndex={0}><code>{`bun scripts/validate-source-packet.ts \\
  /absolute/private/path/subject.ensoul-source.json`}</code></pre>
        <p className="interface-link"><a href={`${repository}/blob/main/skills/soulscrape/references/source-packets.md`}>Read the packet contract</a></p>
      </>
    ),
  },
] as const;

const questions = [
  {
    question: "Is Soulscrape a digital twin?",
    answer: "It can bootstrap a bounded reasoning proxy when the subject has authorized that use, but it does not claim to contain or reproduce a person. The output is a dated, purpose-shaped interpretation of selected evidence.",
  },
  {
    question: "Can I use it to understand someone else?",
    answer: "Yes, for a privacy-minimized collaboration guide when you legitimately possess the evidence. That does not authorize voice imitation, character or fitness evaluation, consequential decisions, or a reusable assistant charter. Explicit subject authorization is required for proxy preparation.",
  },
  {
    question: "Does it search the web about people?",
    answer: "Not by default. Web research turns on when you ask for it or name a URL, and it follows your instructions on sources, time window, and depth. It uses authenticated sources only when explicitly authorized, never bypasses access controls or collects contact details, and it stops when your questions are answered or the allowed sources are exhausted.",
  },
  {
    question: "What does a valid source packet prove?",
    answer: "Structure, attribution fields, bounds, references, and integrity. The workflow still assesses identity binding, provenance, source strength, contradictions, and alternative explanations. A digest proves integrity, not truth.",
  },
  {
    question: "Does installation inspect personal data?",
    answer: "No. The skill installation is inert and the package has no dependencies or lifecycle scripts. Evidence becomes visible only when you place authorized sources into an agent run or explicitly invoke a source-preparation command.",
  },
  {
    question: "What happened to Ensoul?",
    answer: "Soulscrape is the same project under a new name since September 10, 2026. The packet schema, its ensoul.* identifiers, and the validator are unchanged so existing exporters keep working. Versions through 0.3.5 remain published as @hraness/ensoul.",
  },
] as const;

const navigation = [
  { href: "#method", label: "Method" },
  { href: "#boundaries", label: "Boundaries" },
  { href: "#interfaces", label: "Interfaces" },
  { href: "#questions", label: "Questions" },
  { href: repository, label: "GitHub" },
] as const;

function BrandMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 64" className="brand-mark">
      <rect width="64" height="64" rx="14" fill="currentColor" />
      <path d="M16 40c0-8 7-10 14-11s12-3 12-9c0-5-4-8-10-8-5 0-9 2-11 5" fill="none" stroke="var(--background)" strokeWidth="5" strokeLinecap="round" />
      <path d="M48 24c0 8-7 10-14 11s-12 3-12 9c0 5 4 8 10 8 5 0 9-2 11-5" fill="none" stroke="var(--background)" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

export default function Home() {
  const structuredData = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareSourceCode",
      codeRepository: repository,
      description: lead,
      license: "https://opensource.org/license/mit",
      name: "Soulscrape",
      programmingLanguage: "TypeScript",
      runtimePlatform: "Bun",
      url: "https://soulscrape.com",
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: questions.map(({ answer, question }) => ({
        "@type": "Question",
        acceptedAnswer: { "@type": "Answer", text: answer },
        name: question,
      })),
    },
  ];

  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        type="application/ld+json"
      />
      <a className="skip-link" href="#main">Skip to content</a>
      <MarketingSiteHeader
        action={{ href: "#install", label: "Install the skill" }}
        brand={<><BrandMark />Soulscrape</>}
        brandLabel="Soulscrape home"
        links={navigation}
      />

      <main id="main" tabIndex={-1}>
        <MarketingPage>
          <ProductHero
            actions={[
              { href: "#install", label: "Install the skill" },
              { href: "#method", label: "See how it works" },
            ]}
            boundary={footnote}
            className="soulscrape-marketing-hero"
            eyebrow="An Agent Skill for evidence-calibrated person models"
            frame={(
              <MarketingProofFrame
                caption="The shape of a well-supported result. Its sections follow the evidence rather than a personality template."
                credit="Markdown produced by the skill"
                title="<person>-soulscrape.md"
              >
                <pre className="transcript" tabIndex={0}><code>{artifactPreview}</code></pre>
              </MarketingProofFrame>
            )}
            heading={heading}
            headingId="hero-title"
            name="Soulscrape"
            summary={lead}
          />

          <MarketingSection
            heading="From an authorized corpus to a working model."
            headingId="method-title"
            id="method"
            label="The method"
            summary="Read the evidence, preserve contradictions, and make the limits of each conclusion visible."
          >
            <article
              className="readme-prose"
              dangerouslySetInnerHTML={{ __html: landingHtml }}
            />
          </MarketingSection>

          <MarketingTrustBoundary
            heading="Boundaries the skill keeps for you."
            headingId="boundaries-title"
            id="boundaries"
            items={trust}
            label="Boundaries"
            summary="These are product boundaries, not optional cautions. The skill keeps them adjacent to corpus intake, synthesis, output design, and final verification."
          />

          <MarketingInterfaceGrid
            heading="One skill, three interfaces."
            headingId="interfaces-title"
            id="interfaces"
            interfaces={interfaces}
            label="Interfaces"
            summary="The skill, the immutable package, and the source-packet contract are the same reviewed files. There is no separate hosted service."
          />

          <MarketingInstallPanel
            eyebrow={`Current verified release · ${publishedRelease.package}@${releaseVersion}`}
            heading="Install and run one bounded corpus."
            headingId="install-title"
            id="install"
          >
            <pre className="install-command" tabIndex={0}><code>{publishedRelease.skillInstall}</code></pre>
            <pre className="install-command" tabIndex={0}><code>{`Use $${publishedRelease.skill} to build a dated, evidence-calibrated, partial and revisable working model of <person> from <authorized sources>. State the intended use, audience, source cutoff, and any proxy authorization explicitly.`}</code></pre>
            <p className="install-note">
              <a href={publishedRelease.releaseUrl}>Release notes and verified assets</a>.{" "}
              Review the skill before installation and start a new agent session afterward. Begin with a corpus small enough to inspect; add evidence when it supplies a missing period, context, source stratum, or meaningful contradiction.{" "}
              <a href={`${repository}#one-skill-three-interfaces`}>Read the full installation guide on GitHub</a>.
            </p>
          </MarketingInstallPanel>

          <MarketingQuestionList
            heading="Before you install."
            headingId="questions-title"
            id="questions"
            label="Questions"
            questions={questions.map(({ answer, question }) => ({
              answer: <p>{answer}</p>,
              question,
            }))}
          />

          <MarketingMaker
            heading="Built by Ben Guo"
            headingId="maker-title"
            id="maker"
            label="The maker"
            links={[
              { href: "https://hraness.com", label: "hraness.com" },
              { href: "https://x.com/hraness", label: "@hraness" },
              { href: repository, label: "GitHub" },
            ]}
          >
            <p>
              Soulscrape is built by Ben Guo, a musician and builder, formerly a founder and engineering
              leader at companies including Venmo and Stripe, now building from Puerto Rico. It is
              published by Hraness under the MIT license and adapted from Rob Cheung&apos;s
              MIT-licensed build-person skill.
            </p>
          </MarketingMaker>

          <MarketingCallToAction
            actions={[
              { href: "#install", label: "Install the skill" },
              { href: repository, label: "Read the source" },
            ]}
            footnote={footnote}
            heading="Model the person. Keep the boundaries."
            headingId="cta-title"
            summary="Choose sources you are authorized to use, state the intended use, and ask for a dated working model."
          />
        </MarketingPage>
      </main>

      <AskAiAboutThis className="ask-ai" url="https://soulscrape.com" />

      <footer className="site-footer">
        <p>Soulscrape is open source for people modeling people with the agents beside them.</p>
        <nav aria-label="Project links">
          <a href={`${repository}/blob/main/skills/soulscrape/SKILL.md`}>Agent Skill</a>
          <a href={repository}>hraness/soulscrape</a>
          <a href="https://hraness.com/projects">Hraness projects</a>
        </nav>
      </footer>
    </>
  );
}
