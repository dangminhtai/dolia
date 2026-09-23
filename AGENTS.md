# Dolia — Agent Engineering Rules

## 1. Mission and priorities

Dolia is a production-oriented Discord bot built with Node.js and deployed in environments that include Android Termux. Treat it as a maintained software product, not an AI coding experiment.

Prioritize, in order: **correctness and safety → preservation of existing behavior → maintainability → simplicity → performance where justified**. Follow SOLID, DRY, KISS, YAGNI, separation of concerns, and the principle of least privilege pragmatically. Do not introduce abstractions, patterns, services, or dependencies merely to look professional.

**The smallest coherent, verified change that solves the actual problem is preferred.**

## 2. Required workflow

For every nontrivial task, follow:

**Inspect → Plan → Implement → Validate → Review → Summarize.**

- **Inspect:** Read the relevant source, its callers, configuration, tests, and adjacent modules before editing. Check for existing implementations and conventions.
- **Plan:** Identify the behavior to change, likely root cause, affected files, compatibility risks, and verification approach. Keep the plan proportional to the task; do not generate a planning document unless requested.
- **Implement:** Make one focused set of changes. Prefer modifying an appropriate existing implementation over creating a duplicate. Introduce a new module when cohesion, boundaries, or meaningful reuse justify it.
- **Validate:** Execute applicable checks and test affected paths. Never substitute an explanation for a test.
- **Review:** Inspect the full diff for unintended edits, removed behavior, dead code, temporary artifacts, secrets, and dependency changes.
- **Summarize:** Report what changed, important files, what was actually verified, and remaining limitations in the final response, not in a generated report file.

For a trivial task, apply the same principles without ceremonial paperwork.

## 3. Evidence over guesses

Never invent repository facts, API contracts, existing features, dependencies, configuration, or observed runtime behavior.

When information is incomplete, investigate the available source, callers, tests, logs, configuration, and documentation first. Distinguish verified facts from hypotheses. Make safe and reversible local decisions where possible; ask for clarification only when a material ambiguity cannot be resolved and guessing would risk breaking behavior or causing damage.

Do not use uncertainty as an excuse to avoid reasonable investigation. Do not assume code works because it looks plausible.

## 4. Diagnose before patching

Identify the root cause of a defect instead of suppressing its symptoms. Trace the data and execution flow across relevant boundaries. Reproduce the failure or establish a concrete evidence-based explanation when practical.

Do not add arbitrary sleeps, retries, fallbacks, caches, state, or broad `try/catch` blocks to make a problem disappear. For Gemini/API errors, distinguish rate limits, exhausted quota, authentication, provider errors, invalid requests, transport timeouts, and application bugs before changing key selection or retry logic. Respect provider retry guidance and use bounded backoff where warranted.

Where practical, create a regression test that fails before the fix and passes afterward. An error message disappearing is not proof that the defect is resolved.

## 5. Repository hygiene

Every tracked file must have a clear purpose. Keep source, tests, scripts, documentation, and configuration in their established locations.

Do not leave scratch files, one-off probes, debug logs, backup copies, duplicate implementations, generated summaries, or temporary scripts in the repository. Examples of unacceptable leftover files: `test_final.js`, `scratch.js`, `GeminiManager_old.js`, `fixed_v2.js`, `notes_after_fix.md`.

Use an OS temporary directory for disposable experiments when practical, and clean up only artifacts you created. **Never delete unknown files or user data just to make a directory look clean.** Before deleting apparently obsolete code, verify references and migration status.

Permanent tests and necessary Markdown documentation are project assets, not clutter. Keep tests in the designated test location and update existing documentation instead of multiplying overlapping `.md` files. Do not create task diaries or completion reports unless explicitly requested.

## 6. Architecture and code design

Respect the current repository architecture unless a change has a concrete technical justification.

- Keep files and modules cohesive; avoid god objects and monolithic handlers.
- Keep Discord event handlers thin: coordinate input, permissions, services, and replies rather than embedding unrelated business logic.
- Separate Discord authorization and actions, AI provider integration, agent/tool orchestration, persistence/memory, and presentation when doing so improves clarity.
- Give functions one coherent responsibility and names that reveal intent. Prefer explicit inputs, early returns, and understandable control flow.
- Use classes for meaningful stateful responsibilities; use plain functions for straightforward stateless work. Prefer composition over unnecessary inheritance.
- Centralize duplicated business rules and validation, but do not force unrelated code into a misleading shared abstraction.
- Do not split or merge files to satisfy arbitrary line-count or file-count targets.

**Do not turn Dolia into a framework.** Do not introduce microservices, message brokers, Redis, dependency-injection containers, repository layers, or generalized plugin systems without a demonstrated requirement. Existing project mechanisms take precedence over speculative infrastructure.

## 7. Preserve behavior and compatibility

Before changing a subsystem, identify its callers, observable behavior, error paths, and persistent contracts. Preserve unrelated features and public interfaces unless the task explicitly requires a coordinated migration.

Dolia-sensitive paths include Discord message/interaction handling, slash commands and games, tool dispatch, permission checks, Gemini response processing, conversation history and memory, image/attachment handling, retries and API-key management, and Termux startup/runtime behavior.

Do not silently remove functionality while refactoring. Do not equate “no tests found” with “feature unused.” Coordinate schema/configuration changes with migration or backward-compatibility handling. Keep module exports and caller expectations aligned.

## 8. Security and destructive actions

Treat Discord events, user input, model output, and tool arguments as untrusted. Tool selection or arguments produced by an LLM do **not** grant authorization.

Before privileged actions, validate user authorization, bot permissions, Discord role hierarchy, target identity, and the intended scope. Preserve destructive-intent safeguards and AutoMod integrity. Prevent accidental bulk operations and unsafe retries that could repeat a destructive action.

Never hardcode, expose, commit, or log secrets, tokens, API keys, private user data, or sensitive conversation content. Preserve `.env`-based configuration and keep only safe examples in `.env.example`. Apply least privilege to dependencies, process access, and Discord permissions.

Do not bypass a guard simply to make a tool “work.”

## 9. Errors, observability, and provider reliability

Handle errors at the correct boundary with actionable context. Distinguish expected operational failures from programming defects. Do not swallow exceptions, falsely report success, or mask remote failures with invented output.

Keep retries bounded and safe for the operation. Respect `Retry-After` and documented rate limits when available. Consider idempotency for Discord actions and state changes. Ensure a completed agent interaction yields its actual final result, and do not report success if the requested artifact, message, or action is missing.

Logs should aid diagnosis without excessive noise or sensitive data leakage. Do not add noisy permanent debug logging to solve a temporary issue.

## 10. Testing and automated quality gates

Use the project's installed tools and existing scripts rather than inventing verification commands. Where configured, run relevant syntax checks, ESLint, Prettier checks, automated tests, and build/startup checks. Tests must cover meaningful behavior and regressions; do not create disposable tests in the project root.

When introducing or changing quality tooling, configure it coherently and keep generated/cache directories ignored. Prefer enforcing applicable lint, formatting, and tests in CI rather than relying on prompt compliance alone.

If checks cannot run because of missing dependencies, inaccessible services, credentials, platform restrictions, or absent tests, say exactly what was and was not verified. Local unit tests do not prove real Discord or Gemini integration works. Never claim runtime behavior was observed when it was not.

## 11. Refactoring, dependencies, and debt

Refactor to address a demonstrated defect, requirement, or maintainability problem, not as a side quest. Keep bug fixes separate from unrelated rewrites. Avoid new packages when built-in or existing facilities suffice; review the maintenance, security, and Termux compatibility cost of additions.

Avoid preventable technical debt: dead code, magic values without context, hidden global state, circular imports, incomplete migrations, unbounded retry loops, unexplained workarounds, and unfinished required paths disguised as `TODO`.

Technical debt cannot be promised away. When a necessary tradeoff remains, disclose its impact and a concrete follow-up without silently expanding the current task.

## 12. Git and completion integrity

Inspect `git status` and the final diff when Git is available. Preserve pre-existing user changes; do not reset, overwrite, or revert them without authorization. Do not stage or commit unrelated edits. **Create commits only when explicitly requested**; if requested, keep each commit small, cohesive, and focused on one logical change.

Never claim that code was modified, executed, deployed, tested, committed, or verified unless that action actually occurred. Distinguish a code-level fix from a tested integration and from a production deployment.

A task is complete only when the requested change is implemented to the extent permitted by the environment, its limitations are honestly disclosed, and the final diff contains no avoidable debris.
