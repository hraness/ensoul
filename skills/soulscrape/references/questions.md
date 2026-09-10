# Asking protocol

Most requests to model a person arrive vague: "understand my cofounder", "build a twin of me", "what is this candidate like". This reference turns such a request into a question packet, decides what must be asked before work starts, and defines when the work is done.

## The question packet

Before reading any source, write down the packet below in your working notes. Fill every field from the request, the visible corpus, and reasonable defaults; mark a field `unresolved` when nothing supports a value.

| Field | What it records | Default when unstated |
| --- | --- | --- |
| `subject` | Who is being modeled, with the anchors that identify them (name, handles, roles, the user's relationship to them). | `unresolved` if two people could match. |
| `intended_use` | `self-model`, `private-collaboration-guide`, or `authorized-proxy` as defined in SKILL.md. | `private-collaboration-guide` when the subject is not the user; never `authorized-proxy` without an explicit statement from the subject. |
| `audience` | Who will read the result and for how long. | The user alone, revisable, no expiry. |
| `questions` | The concrete questions the result must answer, in the user's words. | Derive a small set from the request; ask only when different interpretations would materially change the result. |
| `evidence_available` | Each source stratum the user has placed in scope, with type, locator, date range, and author. | Only what the user supplied or named. |
| `evidence_missing` | Strata that would change the answer but are absent or unauthorized. | Filled during the corpus inventory. |
| `authorization_needed` | Private sources the user must explicitly authorize before they are opened, and any subject authorization required by the intended use. | Everything not already in scope. |
| `research_scope` | Whether public web research is in scope, and the exact instructions that bound it (see `web-research.md`). | Off. |
| `done_when` | The observable condition that ends the work. | One document at the requested path that answers `questions` with labeled support, plus the stop conditions below. |
| `stop_conditions` | Situations that end the work early. | Listed below. |

Possession alone does not authorize access to additional private sources or preparation of a proxy. Reuse the user’s explicit authorization for sources already in scope.

A packet is not a form for the user. It is the agent's own statement of the task, and most of it is filled without asking.

## When to ask and when to proceed

Ask only when a missing choice would materially change the result or its safety. That happens when:

- `subject` is ambiguous between two or more people;
- `intended_use` is evaluative, externally facing, consequential, or would require proxy authorization the user has not shown;
- a proposed private source is not authorized, or the user seems to assume that possession equals authorization;
- the result will be shared with an audience whose privacy boundaries are unclear;
- the corpus is unavailable, empty, or clearly the wrong person's material;
- the user's instructions for web research conflict with the boundaries in `web-research.md`.

Proceed without asking when the packet is complete enough to start and the defaults are safe. State the assumptions you made in the document's epistemic-status block and in your first message back, so the user can correct them cheaply.

Ask once, in one message, with the smallest set of questions that unblocks the work. Offer a default with each question so a one-word answer suffices. Reuse answers and authorization already present in the session. Ask again only if new evidence creates a material ambiguity.

## Turning a vague request into questions

Rewrite the request as questions the evidence can answer. Prefer questions about demonstrated behavior over questions about essence.

| Request | Weak question | Better questions |
| --- | --- | --- |
| "What is she like?" | What is her personality? | How does she decide when the team disagrees? What does she pay attention to in a draft? What has she changed her mind about, and what moved her? |
| "Build me a twin." | How would the twin talk? | Which decisions should an assistant be allowed to make in my name, and which stay with me? Which of my habits do I want reproduced, and which do I want counterweighted? |
| "Help me work with my manager." | Is he a good manager? | How does he prefer to receive bad news? What does he reward in written updates? What signals that he has stopped listening? |
| "Research this person before the call." | Who is this? | Which public roles and works are firmly attributed to this person? What are they currently working on, by their own account? Which claims about them come only from third parties? |

Each question should name the evidence that could answer it. If no available stratum could answer a question, move it to `evidence_missing` or drop it, and say so.

## Stop conditions

End the work, report what you found, and return the packet when any of these occur:

- the subject cannot be bound to the evidence with adequate anchors;
- the only available evidence would require an unauthorized private source or an out-of-scope public source;
- the intended use turns out to be evaluative or consequential and the user does not change it;
- the corpus is too thin for the questions asked and the user declines to add sources;
- sampling has saturated: the requested questions have adequate coverage and further sources mostly repeat known patterns; preserve material contradictions and investigate them within the authorized scope;
- the requested output would require inferring protected or sensitive traits.

Saturation is the normal ending. A stop is not a failure; it is the moment the packet's `done_when` is either met or shown to be unreachable with the authorized evidence.

## Example packets

A self-model with a rich corpus:

```yaml
subject: the user (self-model); anchors: repository author identity, notes vault owner
intended_use: self-model
audience: the user and an assistant the user configures; review every quarter
questions:
  - How do I decide under time pressure, and where does that go wrong?
  - Which writing habits should an assistant preserve, and which should it flag?
  - What do I keep returning to across the last three years?
evidence_available:
  - notes vault, 2023-01 to 2026-09, authored by the user
  - two repositories with commit history and plans, authored mostly by the user
evidence_missing:
  - messages (not supplied); collaborators' perspectives
authorization_needed: none beyond the supplied vault and repositories
research_scope: off
done_when: one dated document at ./me-soulscrape.md with an assistant charter
stop_conditions: default
```

A collaboration guide with a thin corpus and one question to the user:

```yaml
subject: unresolved between two people named in the thread; ask which
intended_use: private-collaboration-guide
audience: the user alone
questions:
  - How does this person prefer to receive proposals?
  - What has caused friction in past threads, from the record?
evidence_available:
  - one shared project channel export, 2026-04 to 2026-08, mixed authorship
evidence_missing:
  - any direct message history; any public work
authorization_needed: none when the user supplied the export for this purpose; otherwise ask before opening it
research_scope: off unless the user names sources
done_when: a short guide, no voice imitation, no fitness judgments
stop_conditions: default; also stop if the user wants an evaluation for a hiring decision
```

The single question sent to the user for the second packet: "Two people named Sam appear in the export. Which one do you mean?"
