---
name: raggle
description: Use the Raggle CLI to index, search, inspect, and expose a Markdown knowledge base without confusing derived index state with source documents.
---

# Raggle CLI

Use this skill when a repository uses [Raggle](https://github.com/mhingston/raggle) for local Markdown retrieval.

## Choose the corpus first

Do not index a repository root by assumption. Identify the intended Markdown corpus and its exclusions first. Keep source documents, raw evidence, generated files, secrets, and unrelated archives out of the corpus unless the owner explicitly includes them.

Use a repository-local index directory so unrelated projects do not share state:

```bash
export RAGGLE_INDEX_DIR="$PWD/.raggle"
export RAGGLE_EXTRACT_DEPTH="structural"
```

If the project supplies a wrapper script, read and use it; wrappers may pin Node, native dependencies, model sources, or environment variables.

## Normal CLI workflow

Check the installed version and command surface:

```bash
raggle --version
raggle --help
```

Index the explicitly selected Markdown directory:

```bash
raggle index path/to/markdown
# Exclude root-relative globs; repeat the option as needed.
raggle index path/to/markdown --exclude 'evidence/**' --exclude '**/drafts/**'
```

Inspect the derived index:

```bash
raggle status
```

Search with the mode that matches the question:

```bash
raggle search "exact terms" --mode bm25 --top 5 --no-rerank --no-expand
raggle search "conceptual question" --mode hybrid --top 5
raggle search "related documents" --mode graph --graph-seed bm25 --top 5
```

Report the result file path, section heading, score/mode, and whether the answer came from source text or an inference. Raggle retrieval is navigation evidence, not authority by itself; open the returned Markdown and follow its citations.

## MCP mode

For an editor or agent integration, inspect the generated configuration rather than guessing:

```bash
raggle mcp-config
raggle mcp
```

Set `RAGGLE_INDEX_DIR` in the MCP server environment and start a new client session after changing project-scoped configuration.

The MCP `index` tool accepts an `exclude` string array with the same root-relative glob semantics.

## Rebuild and failure handling

Re-index after source changes. Treat `.raggle/` as disposable derived state. `raggle clear` removes the local derived index; confirm the target directory before using it and never treat it as a source deletion.

If indexing fails:

1. Capture the Raggle version, Node version, command, corpus path, and full error.
2. Check that `better-sqlite3` has a native binding for the active Node ABI and that install scripts completed.
3. Check model-download access and the configured model source; do not silently disable verification or weaken TLS.
4. Retry only after changing the diagnosed cause. Do not repeatedly run an unchanged failing command.

If a project needs a mirror, local model cache, or pinned runtime, document that in its wrapper/configuration rather than adding it to this generic skill.

## Boundaries

- Raggle indexes and searches; it does not curate facts, rewrite Markdown, refresh Git repositories, or prove deployment/runtime state.
- Keep indexing, source editing, and repository synchronisation as separate operations.
- Do not index sensitive data without explicit scope and access review.
