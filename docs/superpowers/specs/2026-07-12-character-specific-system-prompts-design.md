# Character-Specific System Prompts

**Date:** 2026-07-12
**Status:** Approved for implementation
**Scope:** Direct-chat System Prompt and Companion Prompt (dropdowns 1 & 2 in Character Details). Group chat is out of scope for v1.

## Goal

Let users write a system prompt that belongs to a single character, directly in the
Create Character → Character Details step and in Edit Character. Inside the custom text,
the token `{{original}}` expands to the content of the default system prompt template for
the current chat mode, so a character prompt can be composed as
"character-specific instructions + base system prompt".

## Background (current behavior)

- Characters reference global system prompt templates by ID only:
  `Character.prompt_template_id` (`src-tauri/src/chat_manager/types.rs:1117`),
  plus a companion-mode template ID inside the `companion.prompting` JSON blob
  (`src-tauri/src/chat_manager/companion/mod.rs:504`).
- Resolution happens in `build_system_prompt_entries`
  (`src-tauri/src/chat_manager/prompting/prompt_engine.rs:3224`), shared by direct chat and
  companion mode. Priority: session template → companion template → character template →
  app default. Templates are fetched by ID via `prompts::get_template`
  (`src-tauri/src/chat_manager/prompting/prompts.rs:1047`).
- A template is `content` (string) plus `entries` (`Vec<SystemPromptEntry>`) — entries inject
  lorebook, memory, images, etc. at configured positions.
- Variable substitution is a custom replacer (`render_with_context`,
  `prompt_engine.rs:3887`): identity regexes (`{{char}}`, `{{user}}`, `{{persona}}`, …) plus
  `String::replace` for a closed set of tokens (`{{scene}}`, `{{lorebook}}`, …). Unknown
  `{{...}}` tokens pass through to the model verbatim.
- The UI dropdowns live in `src/ui/pages/characters/components/DescriptionStep.tsx:580`
  (create) and `src/ui/pages/characters/EditCharacter.tsx:2223` (edit), backed by
  `useCharacterForm.ts` / `useEditCharacterForm.ts`, mapping UI field
  `systemPromptTemplateId` → persisted `promptTemplateId`.
- `Character.system_prompt` (`types.rs:1122`) is a deprecated free-text field: persisted but
  inert (`skip_serializing`), previously migrated into templates. It is NOT reused by this
  feature (see Data model).

## UX design

When the user selects **"Custom (this character)"** in the System Prompt or Companion
Prompt dropdown, an editor expands inline directly below the dropdown — no navigation:

```
SYSTEM PROMPT
┌─────────────────────────────────────┐
│ Custom (this character)          ▼ │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ You are Mira, a sarcastic          │
│ librarian. Never break character.  │
│                                    │
│ {{original}}                       │
└─────────────────────────────────────┘
  [ Insert {{original}} ]  [ Preview ]
  ⚠ "{{originall}}" is not a recognized variable
```

- Auto-growing textarea styled like existing form fields.
- An "Insert `{{original}}`" chip, plus the same context-variable chips
  (`{{char.name}}`, `{{scene}}`, …) already offered by
  `src/ui/components/PromptTemplateEditor.tsx`.
- A Preview toggle rendering the fully expanded prompt for this character.
- Inline warning under the editor for unknown `{{...}}` tokens (typos, unsupported names).
- Same component in all four spots: create/edit × system/companion.

### Dropdown semantics

- "Custom (this character)" is a UI-only sentinel option value; it is never persisted.
- Custom is active **iff** `customSystemPrompt` is non-empty (after trim). While custom is
  active, `promptTemplateId` is saved as `null`.
- Switching the dropdown from Custom back to a template or App Default keeps the typed text
  in local component state (so an accidental toggle doesn't destroy work) but saves
  `customSystemPrompt: null`. The text is gone after save/reload.
- Selecting Custom but leaving the text empty behaves exactly like App Default.

## Data model

New optional free-text fields:

| Location | Field | Storage |
|---|---|---|
| Character (direct chat) | `customSystemPrompt: string \| null` | New DB column on characters + Rust struct field + zod schema field |
| Companion config | `companion.prompting.customSystemPrompt` | Inside the existing `companion` JSON blob — no migration needed |

Decision: a **new** field, not a revival of the deprecated `system_prompt` column. The old
column is `skip_serializing` and entangled with legacy "migrate free-text → template" code;
reviving it risks re-triggering legacy behavior. The deprecated field stays dead.

The new field must round-trip everywhere a character does:

- SQLite persistence (`src-tauri/src/storage_manager/characters.rs`)
- Zod `CharacterSchema` (`src/core/storage/schemas.ts`)
- Character export/import (`src-tauri/src/storage_manager/entity_transfer/`)
- Sync models (`src-tauri/src/sync/models.rs`), if characters sync field-by-field
- Character draft persistence in the create flow (`useCharacterForm` draft save/restore)

## Backend design

### Resolution chain

In `build_system_prompt_entries` (`prompt_engine.rs:3224`) the priority becomes:

> session template → **character custom prompt** → companion/character template → app default

- Session-level `prompt_template_id` still wins over the custom prompt (consistent with
  today's override semantics).
- In companion mode, `companion.prompting.customSystemPrompt` is checked at the same
  position (before the companion template ID).
- Custom prompt with empty/whitespace-only text is treated as absent (falls through).

### `{{original}}` expansion

Templates render from their `entries`; a template's `content` blob is only used when it has
no entries (it is wrapped into a single core entry at `prompt_engine.rs:3332`). Core
directive entries are marked `system_prompt: true`; structural entries (scenario, character
definition, lorebook, memory, author note, image slots) are not. So the custom prompt
operates at the entry level. When active:

1. Resolve the **base template** exactly as if the character had no selection — the
   app-default chain, mode-aware (direct-chat default vs companion default). This is the
   same code path that runs today when `prompt_template_id` is null (guaranteed by the UI,
   which saves `promptTemplateId: null` while custom is active). Legacy content-only
   templates are already wrapped into a single core entry before this step.
2. `original` = the concatenated content of the base template's core entries
   (`system_prompt: true`), joined with blank lines. Single pass: any `{{original}}` inside
   that content itself is removed, not re-expanded (no recursion possible).
3. Replace the first core entry's content with the custom text (with `{{original}}`
   expanded); drop any further core entries (their content lives inside `{{original}}`).
   If the base has no core entry, prepend the custom text as a new core entry.
4. All **non-core entries pass through unchanged**. This keeps lorebook, memory,
   image-slot, and conditional injections working for custom-prompt characters.
5. Everything downstream (`render_with_context` per entry, identity/context variable
   substitution, `sanitize_placeholders_in_api_messages`) runs untouched. The fork is
   confined to one entry-transformation step — no mode-specific branching added elsewhere.

Because the custom text goes through the normal renderer, all existing variables
(`{{char}}`, `{{user}}`, `{{scene}}`, `{{lorebook}}`, …) work inside it.

A custom prompt containing no `{{original}}` is valid: the character's prompt is then fully
standalone text (base content is not appended implicitly), but base entries still apply.

### Unknown tokens

Runtime keeps the engine's existing leave-verbatim behavior for unknown `{{...}}` tokens.
`{{original}}` always resolves, so nothing needs dropping at runtime; typo protection is the
editor warning (below). No changes to `sanitize_placeholders_in_api_messages`.

### Preview

`render_prompt_preview` (`src-tauri/src/chat_manager/commands/mod.rs:989`) gains
`{{original}}` awareness: it resolves the same mode-aware base template for the given
character and expands the token before running `render_with_context`, so the preview matches
runtime output. The expansion helper is shared between the completion path and the preview
command (one implementation, two call sites).

### Message debug page

`MessageDebugPage` shows the resolved system prompt; it should reflect the custom prompt via
the normal resolution path with no special handling (verify during implementation;
`resolve_debug_prompt_template` at `commands/mod.rs:125` mirrors the resolution chain and
must include the new custom-prompt step).

## Frontend design

- **Shared editor component** (new, e.g.
  `src/ui/pages/characters/components/CustomSystemPromptEditor.tsx`): textarea +
  insert chip(s) + preview toggle (via `renderPromptPreview` from
  `src/core/prompts/service.ts`) + unknown-token warning. Warning logic: scan for
  `{{...}}` tokens, flag any not in the known-variable set ∪ {`original`}. The known set
  is the allowed-variable list from `getPromptParameterEngine`
  (`src/core/prompts/index.ts:144`); identity aliases (`{{char}}`, `{{user}}`, …) are
  included in that set.
- **`DescriptionStep.tsx`**: System Prompt and Companion Prompt selects get the sentinel
  option; render the editor beneath when selected. New props for the custom text values +
  change handlers.
- **`EditCharacter.tsx`**: same for its two inline selects (`:2223` system, `:2272`
  companion).
- **`useCharacterForm.ts` / `useEditCharacterForm.ts`**: new state fields
  `customSystemPrompt` and `companionCustomSystemPrompt`; load from character, include in
  save payload, include in create-flow draft persistence.
- **Save mapping**: `promptTemplateId: null` + `customSystemPrompt: <text>` when custom
  active; `customSystemPrompt: null` otherwise. Mirror for companion inside
  `companion.prompting`.
- **i18n**: new strings (option label "Custom (this character)", hints, warning text,
  preview/insert labels) added to `src/core/i18n/locales/en.ts` and translated across all
  locale files, per repo convention.

## Testing

Rust unit tests (prompt_engine — the entry transformation is pure and unit-testable; the
full resolution chain needs an AppHandle, so chain behavior is covered by the manual pass
via the debug page):
- Custom text replaces the core entry; `{{original}}` expands to its original content.
- Custom text without `{{original}}` renders standalone.
- Multiple core entries collapse into one; non-core entries are preserved unchanged.
- Single-pass guard: `{{original}}` inside core content is removed, not recursed.
- A base with no core entry gets the custom text prepended as a new core entry.

Frontend verification (this repo has no JS test framework; `npm run check` = tsc + cargo
check, plus manual):
- Form round-trip: select Custom → type → save → reload shows Custom + text.
- Dropdown switching: Custom → template → Custom preserves text within the session;
  saving while on a template persists `customSystemPrompt: null`.
- Unknown-token warning appears for `{{originall}}`, not for `{{original}}` or known
  variables.

Manual end-to-end:
- Via the message debug page, confirm the final system prompt sent to the model for a
  custom-prompt character in direct chat and in companion mode.
- Export → import a character with a custom prompt; confirm the field survives.

## Out of scope (v1)

- Group-chat dropdowns (separate resolution path in `group_chat_manager`).
- `{{Template Name}}` references to arbitrary global templates. The expansion pass is a
  token-lookup step, so adding named references later is additive (name resolver + editor
  picker + unresolved-name handling), no rework of this design.
- Per-session custom prompts.
- Publishing custom prompts through discovery cards beyond the field traveling with normal
  character JSON.
