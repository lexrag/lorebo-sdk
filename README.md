<p align="center">
  <a href="https://lorebo.com/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/lorebo-logo-on-dark.svg">
      <img src="assets/lorebo-logo-primary.svg" width="264" alt="Lorebo">
    </picture>
  </a>
</p>

<h1 align="center">Lorebo SDK</h1>

<p align="center"><strong>Give your application a knowledge base that people and AI share.</strong></p>

<p align="center">
  <a href="https://github.com/lexrag/lorebo-sdk/actions/workflows/check.yml"><img src="https://github.com/lexrag/lorebo-sdk/actions/workflows/check.yml/badge.svg" alt="Checks"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-593EDC" alt="MIT license"></a>
  <a href="https://pypi.org/project/lorebo-sdk/"><img src="https://img.shields.io/badge/Python-3.12+-3776AB" alt="Python 3.12+"></a>
  <a href="https://www.npmjs.com/package/lorebo-sdk"><img src="https://img.shields.io/badge/TypeScript-Node_22+-3178C6" alt="TypeScript, Node 22+"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#results">Results</a> ·
  <a href="#choosing-a-base">Choosing a base</a> ·
  <a href="#errors">Errors</a> ·
  <a href="https://lorebo.com/docs/">Lorebo docs</a>
</p>

[Lorebo](https://lorebo.com/) turns useful AI work into knowledge you own:
readable, connected pages that people and AI agents can find, correct and reuse.

The Lorebo SDK lets your application use that knowledge with two calls:

- **`capture`** saves the durable part of a text as Lorebo pages. It searches
  first, updates pages that already cover the topic and creates the rest.
- **`explore`** answers a question from the pages in Lorebo and returns the
  pages the answer relies on.

Both calls run the official Lorebo skills with the language model you choose.
The SDK is available for Python and TypeScript with the same behavior.

## Requirements

- A Lorebo MCP endpoint:
  - [Lorebo Desktop](https://lorebo.com/download) serves `http://127.0.0.1:8757/mcp` on your machine.
  - [Lorebo Headless](https://github.com/lexrag/lorebo-cloudflare) serves `https://<your-server>/mcp` and needs its MCP token.
- A language model that supports tool calls and structured output.
- Python 3.12+ or Node.js 22+.

## Quick start

### Python

```bash
pip install "lorebo-sdk[openai]"
```

The extra installs the model provider. `anthropic`, `google`, `groq`,
`mistral` and `bedrock` are available too.

```python
import asyncio

from lorebo_sdk.client import Lorebo


async def main() -> None:
    lorebo = Lorebo.from_url(
        url="http://127.0.0.1:8757/mcp",
        token=None,
        model="openai:gpt-5-mini",
        base_ref="local:your-base-id",
    )

    captured = await lorebo.capture("Our API listens on port 8757, on loopback only.")
    print(captured.summary)

    explored = await lorebo.explore("Which port does our API use?")
    print(explored.answer)


asyncio.run(main())
```

`model` accepts any [Pydantic AI](https://ai.pydantic.dev/models/) model or model name.

### TypeScript

```bash
npm install lorebo-sdk ai @ai-sdk/openai
```

```ts
import { openai } from "@ai-sdk/openai";
import { createLorebo } from "lorebo-sdk";

const lorebo = createLorebo({
  url: "http://127.0.0.1:8757/mcp",
  token: null,
  model: openai("gpt-5-mini"),
  baseRef: "local:your-base-id",
});

const captured = await lorebo.capture(
  "Our API listens on port 8757, on loopback only.",
);
console.log(captured.summary);

const explored = await lorebo.explore("Which port does our API use?");
console.log(explored.answer);
```

`model` accepts any [AI SDK](https://ai-sdk.dev/providers) language model.

## Results

`capture` returns what changed in Lorebo:

| Field     | Meaning                             |
| --------- | ----------------------------------- |
| `summary` | One or two sentences for your user. |
| `created` | Pages this call created.            |
| `updated` | Existing pages this call changed.   |

`explore` returns the answer and its sources:

| Field     | Meaning                                             |
| --------- | --------------------------------------------------- |
| `answer`  | Plain-text answer for your user.                    |
| `sources` | Pages the answer relies on, each read in this call. |

Each page has an `id`, a `title` and the `base_ref` (`baseRef` in TypeScript)
of the base that holds it. The SDK builds these lists from Lorebo's responses,
not from the model's text, so they only contain pages that exist.

Summaries and answers are plain text written for your user, without the model's
reasoning, tool names or page IDs. Nothing is printed to your console.

## Choosing a base

A Lorebo installation can hold several knowledge bases. Pass `base_ref` to
lock every call to one of them:

```python
lorebo = Lorebo.from_url(..., base_ref="local:your-base-id")
```

When the model tries to use another base, the call stops with
`LockedBaseError` before anything is written there.

Pass `None` (`null` in TypeScript) to let the skill choose. `capture` then
picks the base the knowledge belongs to, or creates one when none fits.
`explore` picks the base that holds the answer.

To find a `base_ref`, list the bases with an unlocked client:

```python
for base in await lorebo.list_bases():
    print(base.base_ref, base.label)
```

```ts
for (const base of await lorebo.listBases()) {
  console.log(base.baseRef, base.label);
}
```

`create_base` (`createBase` in TypeScript) creates a base from your code.

## What the model can do

The model only sees the Lorebo tools its skill needs:

- `explore` can read and search pages.
- `capture` can also create, update and link pages.
- Without a locked base, both can list bases and `capture` can create one.

Tools that delete pages, delete bases, restore backups or change sharing are
never offered.

## Errors

Every SDK error extends `LoreboError`:

| Error               | Raised when                                                    |
| ------------------- | -------------------------------------------------------------- |
| `LockedBaseError`   | The model tried to use a base other than the locked one.       |
| `LoreboToolError`   | Lorebo rejected a call or returned an unexpected response.     |
| `RunLimitError`     | The skill did not finish within the step limit of 24.          |
| `SkillPackageError` | A Lorebo skill could not be downloaded or failed verification. |

Python imports them from `lorebo_sdk.errors`, TypeScript from `lorebo-sdk/errors`.
Errors from the model provider are passed through unchanged.

## Lorebo skills

Each SDK release is pinned to one version of the official `lorebo-capture`
and `lorebo-explore` skills. They are downloaded from `downloads.lorebo.com`
on first use, checked against a SHA-256 digest built into the SDK and kept in
memory for the life of the client.

## Development

```bash
uv sync
uv run mypy
uv run ruff check .
uv run pytest
```

```bash
cd typescript
npm ci
npm run check
npm run build
```

## License

[MIT](LICENSE)
