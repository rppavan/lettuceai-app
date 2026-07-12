# Character-Specific System Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a character carry its own free-text system prompt (direct chat + companion mode), selectable as "Custom (this character)" in the existing dropdowns, with `{{original}}` expanding to the default system prompt's core directive.

**Architecture:** Tauri app — React/TypeScript frontend invokes Rust commands. Prompt assembly happens in Rust (`prompt_engine::build_system_prompt_entries`). The custom prompt is stored as a new `custom_system_prompt` column on characters (companion copy inside the `companion.prompting` JSON blob) and applied as an entry-level transformation: the custom text replaces the base template's core entries (flagged `system_prompt: true`); `{{original}}` expands to their original content; all structural entries (lorebook, memory, image slots) pass through unchanged.

**Tech Stack:** Rust (rusqlite, serde, Tauri commands), React + TypeScript (zod schemas, reducer-based form hooks), custom i18n.

**Spec:** `docs/superpowers/specs/2026-07-12-character-specific-system-prompts-design.md`

## Global Constraints

- Work on branch `feat/character-custom-system-prompt` (already created).
- Token literal is exactly `{{original}}`. Rust const: `ORIGINAL_PROMPT_TOKEN`. Replacement entry id: `"entry_custom_system"`, name `"Custom System Prompt"`.
- JSON/TS field name: `customSystemPrompt`. Rust field/column: `custom_system_prompt`. UI select sentinel (never persisted): `"__custom__"` (const `CUSTOM_PROMPT_OPTION`).
- Custom prompt is active iff the stored text is non-empty after trim. While active, `promptTemplateId` is saved as `null` (and companion `prompting.promptTemplateId` as `null`).
- Session-level template override still wins over the custom prompt. Group chat is untouched.
- Runtime keeps existing leave-verbatim behavior for unknown `{{...}}` tokens; typo protection is editor-side only.
- Full check command: `npm run check` (runs `tsc --noEmit` then `cargo check` in `src-tauri`).
- Rust tests: `cd src-tauri && cargo test custom_system_prompt` (first compile is slow; that's normal).
- Every commit message ends with the line: `By apparao.parwatikar`
- Comments: terse, only non-obvious "why". Match surrounding style.

---

### Task 1: Entry transformation core (`apply_custom_system_prompt`) — TDD

**Files:**
- Modify: `src-tauri/src/chat_manager/prompting/prompt_engine.rs` (append near end of file)

**Interfaces:**
- Produces (used by Tasks 2 and 3):
  - `pub const ORIGINAL_PROMPT_TOKEN: &str = "{{original}}";`
  - `pub fn original_core_content(entries: &[SystemPromptEntry]) -> String`
  - `pub fn apply_custom_system_prompt(entries: Vec<SystemPromptEntry>, custom_text: &str) -> Vec<SystemPromptEntry>`
- Consumes: `SystemPromptEntry`, `PromptEntryRole`, `PromptEntryPosition` (already imported at top of `prompt_engine.rs`).

- [ ] **Step 1: Write the failing tests**

Append at the very end of `src-tauri/src/chat_manager/prompting/prompt_engine.rs` (the file has no test module yet; `turn_builder.rs:228` is the precedent):

```rust
#[cfg(test)]
mod custom_system_prompt_tests {
    use super::*;

    fn entry(id: &str, content: &str, is_core: bool) -> SystemPromptEntry {
        SystemPromptEntry {
            id: id.to_string(),
            name: id.to_string(),
            role: PromptEntryRole::System,
            content: content.to_string(),
            enabled: true,
            injection_position: PromptEntryPosition::Relative,
            injection_depth: 0,
            conditional_min_messages: None,
            interval_turns: None,
            system_prompt: is_core,
            conditions: None,
            prompt_entry_payload: None,
        }
    }

    #[test]
    fn replaces_core_entry_and_expands_original() {
        let entries = vec![
            entry("entry_base", "Base directive.", true),
            entry("entry_character", "Character: {{char.name}}", false),
        ];
        let result = apply_custom_system_prompt(entries, "Custom intro.\n\n{{original}}");
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].id, "entry_custom_system");
        assert!(result[0].system_prompt);
        assert_eq!(result[0].content, "Custom intro.\n\nBase directive.");
        assert_eq!(result[1].id, "entry_character");
    }

    #[test]
    fn custom_without_original_token_is_standalone() {
        let entries = vec![
            entry("entry_base", "Base directive.", true),
            entry("entry_scenario", "Scenario stuff", false),
        ];
        let result = apply_custom_system_prompt(entries, "Only my rules.");
        assert_eq!(result[0].content, "Only my rules.");
        assert!(!result.iter().any(|e| e.content.contains("Base directive")));
        assert!(result.iter().any(|e| e.id == "entry_scenario"));
    }

    #[test]
    fn multiple_core_entries_collapse_into_one() {
        let entries = vec![
            entry("core_a", "Part A.", true),
            entry("mid", "Structural", false),
            entry("core_b", "Part B.", true),
        ];
        let result = apply_custom_system_prompt(entries, "{{original}}");
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].content, "Part A.\n\nPart B.");
        assert_eq!(result[1].id, "mid");
    }

    #[test]
    fn original_token_inside_core_is_not_recursed() {
        let entries = vec![entry("entry_base", "Base {{original}} directive.", true)];
        let result = apply_custom_system_prompt(entries, "X {{original}} Y");
        assert_eq!(result[0].content, "X Base  directive. Y");
    }

    #[test]
    fn no_core_entry_prepends_custom() {
        let entries = vec![entry("entry_scenario", "Scenario", false)];
        let result = apply_custom_system_prompt(entries, "Custom. {{original}}");
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].id, "entry_custom_system");
        assert_eq!(result[0].content, "Custom. ");
        assert!(result[0].system_prompt);
        assert_eq!(result[1].id, "entry_scenario");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test custom_system_prompt`
Expected: compile error — `apply_custom_system_prompt` not found.

- [ ] **Step 3: Write the implementation**

Insert immediately above the test module:

```rust
pub const ORIGINAL_PROMPT_TOKEN: &str = "{{original}}";

pub fn original_core_content(entries: &[SystemPromptEntry]) -> String {
    entries
        .iter()
        .filter(|entry| entry.system_prompt)
        .map(|entry| entry.content.trim())
        .filter(|content| !content.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
        // single-pass guard: never re-expand the token from base content
        .replace(ORIGINAL_PROMPT_TOKEN, "")
}

/// Replace the core (system_prompt-flagged) entries with the character's custom
/// prompt; `{{original}}` inside it expands to the replaced core content.
/// Structural entries (lorebook, memory, image slots, ...) pass through.
pub fn apply_custom_system_prompt(
    entries: Vec<SystemPromptEntry>,
    custom_text: &str,
) -> Vec<SystemPromptEntry> {
    let original = original_core_content(&entries);
    let expanded = custom_text.replace(ORIGINAL_PROMPT_TOKEN, &original);

    let mut result: Vec<SystemPromptEntry> = Vec::with_capacity(entries.len());
    let mut replaced = false;
    for mut entry in entries {
        if entry.system_prompt {
            if !replaced {
                entry.id = "entry_custom_system".to_string();
                entry.name = "Custom System Prompt".to_string();
                entry.content = expanded.clone();
                result.push(entry);
                replaced = true;
            }
            // later core entries are dropped; their content lives in {{original}}
        } else {
            result.push(entry);
        }
    }
    if !replaced {
        result.insert(
            0,
            SystemPromptEntry {
                id: "entry_custom_system".to_string(),
                name: "Custom System Prompt".to_string(),
                role: PromptEntryRole::System,
                content: expanded,
                enabled: true,
                injection_position: PromptEntryPosition::Relative,
                injection_depth: 0,
                conditional_min_messages: None,
                interval_turns: None,
                system_prompt: true,
                conditions: None,
                prompt_entry_payload: None,
            },
        );
    }
    result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test custom_system_prompt`
Expected: `test result: ok. 5 passed`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/chat_manager/prompting/prompt_engine.rs
git commit -m "feat(prompts): entry transformation for character custom system prompt

By apparao.parwatikar"
```

---

### Task 2: Character/companion fields + wire into `build_system_prompt_entries`

**Files:**
- Modify: `src-tauri/src/chat_manager/types.rs:1121` (Character struct)
- Modify: `src-tauri/src/chat_manager/companion/mod.rs:355` (CompanionPromptingConfig) and `:504` (add helper after `companion_prompt_template_id`)
- Modify: `src-tauri/src/chat_manager/prompting/prompt_engine.rs:3332` (after the base_entries wrap block)
- Modify: `src-tauri/src/group_chat_manager/mod.rs:5087` (Character struct literal — add `custom_system_prompt: None`)

**Interfaces:**
- Consumes: `apply_custom_system_prompt` (Task 1).
- Produces (used by Task 3):
  - `Character.custom_system_prompt: Option<String>` (serde camelCase → `customSystemPrompt`)
  - `pub fn companion_custom_system_prompt(character: &Character) -> Option<String>` in `chat_manager::companion`

- [ ] **Step 1: Add the Character field**

In `src-tauri/src/chat_manager/types.rs`, after `group_chat_roleplay_prompt_template_id` (line ~1121), before the deprecated `system_prompt` field:

```rust
    /// Character-specific free-text system prompt ("Custom (this character)").
    /// `{{original}}` inside it expands to the default template's core directive.
    #[serde(default)]
    pub custom_system_prompt: Option<String>,
```

- [ ] **Step 2: Add companion config field + helper**

In `src-tauri/src/chat_manager/companion/mod.rs`, extend `CompanionPromptingConfig` (line ~355):

```rust
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CompanionPromptingConfig {
    #[serde(default)]
    prompt_template_id: Option<String>,
    #[serde(default)]
    custom_system_prompt: Option<String>,
    #[serde(default)]
    style_notes: String,
}
```

Add after `companion_prompt_template_id` (line ~511):

```rust
pub fn companion_custom_system_prompt(character: &Character) -> Option<String> {
    character
        .companion
        .as_ref()
        .and_then(|value| serde_json::from_value::<CompanionConfig>(value.clone()).ok())
        .and_then(|config| config.prompting.custom_system_prompt)
        .filter(|value| !value.trim().is_empty())
}
```

- [ ] **Step 3: Wire into `build_system_prompt_entries`**

In `src-tauri/src/chat_manager/prompting/prompt_engine.rs`, directly AFTER this existing block (lines 3332–3336):

```rust
    let base_entries = if base_entries.is_empty() && !base_content.trim().is_empty() {
        single_entry_from_content(&base_content)
    } else {
        base_entries
    };
```

insert:

```rust
    // Character custom prompt replaces the core entries; session override wins.
    let custom_system_prompt = if base_template_source == "session_template" {
        None
    } else if companion_mode {
        companion::companion_custom_system_prompt(character)
    } else {
        character
            .custom_system_prompt
            .clone()
            .filter(|text| !text.trim().is_empty())
    };

    let base_entries = match &custom_system_prompt {
        Some(custom_text) => {
            debug_parts.push(json!({
                "source": "character_custom_prompt",
                "base_template_source": base_template_source,
                "base_template_id": base_template_id,
            }));
            apply_custom_system_prompt(base_entries, custom_text.trim())
        }
        None => base_entries,
    };
```

Also add to the `system_prompt_debug` JSON object (line ~3684, next to `"character_prompt_template_id"`):

```rust
                "character_custom_prompt_active": custom_system_prompt.is_some(),
```

- [ ] **Step 4: Fix struct-literal compile errors**

Run: `cd src-tauri && cargo check`
Expected: error(s) about missing field `custom_system_prompt` in `Character` literals. Known site: `src-tauri/src/group_chat_manager/mod.rs:5087` — add `custom_system_prompt: None,` next to `prompt_template_id`. Fix any other site cargo reports the same way (`None`). Group chat deliberately ignores the custom prompt.

- [ ] **Step 5: Verify**

Run: `cd src-tauri && cargo check && cargo test custom_system_prompt`
Expected: clean check; 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A src-tauri/src
git commit -m "feat(prompts): apply character custom system prompt in chat/companion flows

By apparao.parwatikar"
```

---

### Task 3: `{{original}}` in preview + debug resolver

**Files:**
- Modify: `src-tauri/src/chat_manager/prompting/prompt_engine.rs` (add `expand_original_token` next to Task 1 functions)
- Modify: `src-tauri/src/chat_manager/commands/mod.rs:989-1054` (`render_prompt_preview`) and `:125-181` (`resolve_debug_prompt_template`)

**Interfaces:**
- Consumes: `ORIGINAL_PROMPT_TOKEN`, `original_core_content`, private `get_app_default_template_content` (same module), `companion::is_companion_mode`, `companion::companion_custom_system_prompt`.
- Produces: `pub fn expand_original_token(app: &AppHandle, settings: &Settings, companion_mode: bool, text: &str) -> String` (used by the frontend preview path via `render_prompt_preview`).

- [ ] **Step 1: Add `expand_original_token`**

In `prompt_engine.rs`, below `apply_custom_system_prompt`:

```rust
/// Expand {{original}} against the mode-aware app-default template.
/// Used by the preview command so previews match runtime output.
pub fn expand_original_token(
    app: &AppHandle,
    settings: &Settings,
    companion_mode: bool,
    text: &str,
) -> String {
    if !text.contains(ORIGINAL_PROMPT_TOKEN) {
        return text.to_string();
    }
    let mut debug_parts: Vec<Value> = Vec::new();
    let (base_content, base_entries, _, _, _) =
        get_app_default_template_content(app, settings, companion_mode, &mut debug_parts);
    let core = if base_entries.is_empty() {
        base_content.replace(ORIGINAL_PROMPT_TOKEN, "")
    } else {
        original_core_content(&base_entries)
    };
    text.replace(ORIGINAL_PROMPT_TOKEN, core.trim())
}
```

- [ ] **Step 2: Expand in `render_prompt_preview`**

In `src-tauri/src/chat_manager/commands/mod.rs`, replace the final render call (lines ~1050–1053):

```rust
    let rendered = prompt_engine::render_with_context(
        &app, &content, &character, persona, &session, settings, None,
    );
    Ok(rendered)
```

with:

```rust
    let companion_mode = super::companion::is_companion_mode(&session, &character);
    let content =
        prompt_engine::expand_original_token(&app, settings, companion_mode, &content);
    let rendered = prompt_engine::render_with_context(
        &app, &content, &character, persona, &session, settings, None,
    );
    Ok(rendered)
```

(If the file already imports the companion module under another path, follow that import style; cargo check settles it.)

- [ ] **Step 3: Teach the debug resolver about custom prompts**

In the same file, replace the body of `resolve_debug_prompt_template` (lines 125–181) with:

```rust
fn resolve_debug_prompt_template(
    app: &AppHandle,
    session: &Session,
    character: &super::types::Character,
    settings: &Settings,
) -> (String, Option<String>, Option<String>) {
    if let Some(session_template_id) = &session.prompt_template_id {
        if let Ok(Some(template)) = prompts::get_template(app, session_template_id) {
            return (
                "session_template".to_string(),
                Some(template.id),
                Some(template.name),
            );
        }
    }

    let companion_mode = super::companion::is_companion_mode(session, character);
    let custom = if companion_mode {
        super::companion::companion_custom_system_prompt(character)
    } else {
        character
            .custom_system_prompt
            .clone()
            .filter(|text| !text.trim().is_empty())
    };
    if custom.is_some() {
        return (
            "character_custom_prompt".to_string(),
            None,
            Some("Custom (this character)".to_string()),
        );
    }

    if let Some(character_template_id) = &character.prompt_template_id {
        if let Ok(Some(template)) = prompts::get_template(app, character_template_id) {
            return (
                "character_template".to_string(),
                Some(template.id),
                Some(template.name),
            );
        }
    }

    if let Some(app_template_id) = &settings.prompt_template_id {
        if let Ok(Some(template)) = prompts::get_template(app, app_template_id) {
            return (
                "app_wide_template".to_string(),
                Some(template.id),
                Some(template.name),
            );
        }
    }

    if let Ok(Some(template)) = prompts::get_template(app, prompts::APP_DEFAULT_TEMPLATE_ID) {
        return (
            "app_default_template".to_string(),
            Some(template.id),
            Some(template.name),
        );
    }

    (
        "emergency_hardcoded_fallback".to_string(),
        None,
        Some("Hardcoded Fallback".to_string()),
    )
}
```

Note: this keeps the pre-existing behavior where a dangling session template id falls through to the character-level resolution (now including custom).

- [ ] **Step 4: Verify and commit**

Run: `cd src-tauri && cargo check`
Expected: clean.

```bash
git add src-tauri/src/chat_manager
git commit -m "feat(prompts): expand {{original}} in preview and debug template resolution

By apparao.parwatikar"
```

---

### Task 4: DB migration + character storage round-trip

**Files:**
- Modify: `src-tauri/src/migrations/mod.rs:10` (version const), `:822-830` (registration), `:4123` area (new fn after `migrate_v78_to_v79`)
- Modify: `src-tauri/src/storage_manager/characters.rs:54` (get SELECT), `:40-147` (tuple/destructure), `:413` (JSON build), `:725` (save extract), `:802-844` (INSERT/UPSERT), `:845-888` (params)

**Interfaces:**
- Produces: `characters.custom_system_prompt TEXT` column; `customSystemPrompt` key in the character JSON returned by storage and accepted on save. (`chat_manager` deserializes that JSON into `Character`, so Task 2's field picks it up automatically.)

- [ ] **Step 1: Migration**

In `src-tauri/src/migrations/mod.rs`:

1. Line 10: `pub const CURRENT_MIGRATION_VERSION: u32 = 80;`
2. After the `if version < 79 { ... }` block (~line 830), add:

```rust
    if version < 80 {
        log_info(
            app,
            "migrations",
            "Running migration v79 -> v80: Add custom_system_prompt to characters",
        );
        migrate_v79_to_v80(app)?;
        version = 80;
    }
```

3. Near `migrate_v78_to_v79` (~line 4123), add:

```rust
fn migrate_v79_to_v80(app: &AppHandle) -> Result<(), String> {
    let conn = crate::storage_manager::db::open_db(app)?;
    let _ = conn.execute(
        "ALTER TABLE characters ADD COLUMN custom_system_prompt TEXT",
        [],
    );
    Ok(())
}
```

- [ ] **Step 2: Load path (`get_character`, characters.rs)**

Append `, custom_system_prompt` at the very END of the SELECT column list at line 54 (after `updated_at`) — appending avoids shifting the positional `r.get(N)` indices. Then:

1. Tuple type (lines 15–52): add a final `Option<String>,` after the last `i64,`.
2. Row mapper (line ~99): add `r.get::<_, Option<String>>(43)?` after `r.get::<_, i64>(42)?`.
3. Destructure (line ~146): add `custom_system_prompt,` after `updated_at,`.
4. JSON build — after the `systemPrompt` insert block (line ~413-415), add:

```rust
    if let Some(csp) = custom_system_prompt {
        if !csp.trim().is_empty() {
            root.insert("customSystemPrompt".into(), JsonValue::String(csp));
        }
    }
```

- [ ] **Step 3: Save path (characters.rs)**

1. After the `system_prompt` extraction (lines 725–728), add:

```rust
    let custom_system_prompt = c
        .get("customSystemPrompt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty());
```

2. In the INSERT statement (line 802): add `custom_system_prompt` to the column list right after `system_prompt`, and add one more `?` in the VALUES list.
3. In the UPSERT SET list (after line 833): add `custom_system_prompt=excluded.custom_system_prompt,`.
4. In `params![...]` (line ~875): add `custom_system_prompt,` right after `system_prompt,`.

- [ ] **Step 4: Verify and commit**

Run: `cd src-tauri && cargo check`
Expected: clean.

```bash
git add src-tauri/src/migrations src-tauri/src/storage_manager/characters.rs
git commit -m "feat(storage): persist character custom_system_prompt (migration v80)

By apparao.parwatikar"
```

---

### Task 5: Entity transfer (export/import) + device sync

**Files:**
- Modify: `src-tauri/src/storage_manager/entity_transfer/mod.rs` — transfer struct (`:89-90`), export snapshot (`load_character_export_snapshot`, SELECT `:1405`, tuple `:1330-1402`, struct init `:1657` area), import INSERT (`:2410`, params `:2440`), `read_imported_character` (SELECT `:3418`, tuple `:3369-3405`, JSON build `:3636` area)
- Modify: `src-tauri/src/sync/models.rs:362` (CharacterRecord), `src-tauri/src/sync/db.rs:2734` (INSERT), `:2770` (params), `:3783` (SELECT), `:3789` (row mapper)

**Interfaces:**
- Consumes: the `custom_system_prompt` column (Task 4).
- Produces: `customSystemPrompt` field in exported character JSON packages; field carried by P2P sync snapshots. Companion-mode custom prompt needs nothing here — it rides inside the `companion` JSON blob, which all these paths already carry.

- [ ] **Step 1: Transfer struct**

In `entity_transfer/mod.rs` (struct with `pub system_prompt: Option<String>` at line 90 — serde `rename_all = "camelCase"`), add right after it:

```rust
    #[serde(default)]
    pub custom_system_prompt: Option<String>,
```

- [ ] **Step 2: Export snapshot (`load_character_export_snapshot`)**

- SELECT at :1405 — append `, custom_system_prompt` at the very END (after `updated_at`).
- Tuple destructure (:1330-1365) — add `custom_system_prompt,` after `updated_at,`.
- Tuple type (:1366-1403) — add final `Option<String>, // custom_system_prompt`.
- Row closure — add matching final `r.get(36)?,`.
- Struct construction where `system_prompt,` appears (:1657 area) — add `custom_system_prompt,` beside it.

- [ ] **Step 3: Import (`INSERT` at :2410)**

- Add `custom_system_prompt` to the column list right after `system_prompt`, add one `?` in VALUES.
- In `params![...]` (:2440 area) add `package.character.custom_system_prompt,` right after `package.character.system_prompt,`.

- [ ] **Step 4: `read_imported_character` (:3340)**

- SELECT at :3418 — append `, custom_system_prompt` at the END.
- Tuple destructure/type (:3369-3405) — add final `custom_system_prompt` / `Option<String>`; row closure gains final `r.get(34)?,` (one past the current last index).
- JSON build (near `:3636`, next to the `systemPrompt` insert):

```rust
    if let Some(csp) = custom_system_prompt {
        root.insert("customSystemPrompt".into(), JsonValue::String(csp));
    }
```

- [ ] **Step 5: Sync**

- `sync/models.rs:362` — after `pub system_prompt: Option<String>,` add:

```rust
    #[serde(default)]
    pub custom_system_prompt: Option<String>,
```

- `sync/db.rs:2734` INSERT — add `custom_system_prompt` column right after `system_prompt` and bump the positional placeholders (`?34` … `?46` become one longer; renumber the tail).
- `sync/db.rs:2770` params — add `character.custom_system_prompt,` after `character.system_prompt,`.
- `sync/db.rs:3783` SELECT — add `custom_system_prompt` right after `system_prompt`.
- `sync/db.rs:3789` row mapper — add `custom_system_prompt: r.get(N)?,` where N is the new column position; shift subsequent indices to match (mirror exactly how `system_prompt` is mapped; the mapper is positional, so keep SELECT order and mapper indices in lockstep).

- [ ] **Step 6: Verify and commit**

Run: `cd src-tauri && cargo check`
Expected: clean.

```bash
git add src-tauri/src/storage_manager/entity_transfer src-tauri/src/sync
git commit -m "feat(transfer,sync): carry customSystemPrompt through export/import and sync

By apparao.parwatikar"
```

---

### Task 6: Frontend schemas, shared consts/utils, English strings

**Files:**
- Modify: `src/core/storage/schemas.ts:3364-3368` (CompanionPromptingConfigSchema), `:3645-3648` (CharacterSchema), `:3447-3450` (companion default)
- Create: `src/ui/pages/characters/utils/customSystemPrompt.ts`
- Modify: `src/core/i18n/locales/en.ts` — `characters.description` block (~:3245), `characters.edit` block (~:3808), new `components.customSystemPrompt` block next to `components.promptTemplate`

**Interfaces:**
- Produces (used by Tasks 7–9):
  - `CharacterSchema` field `customSystemPrompt: z.string().nullish().optional()`
  - `CompanionPromptingConfigSchema` field `customSystemPrompt: z.string().nullish().optional()`
  - `CUSTOM_PROMPT_OPTION = "__custom__"`, `ORIGINAL_TOKEN = "{{original}}"`, `findUnknownTokens(content: string, knownVariables: ReadonlySet<string>): string[]`
  - i18n keys listed below.

- [ ] **Step 1: Zod schemas**

In `CharacterSchema` after `groupChatRoleplayPromptTemplateId` (line 3647):

```ts
  customSystemPrompt: z.string().nullish().optional(),
```

In `CompanionPromptingConfigSchema` (line 3364):

```ts
export const CompanionPromptingConfigSchema = z.object({
  promptTemplateId: z.string().nullish().optional(),
  customSystemPrompt: z.string().nullish().optional(),
  styleNotes: z.string().default(""),
});
```

The `.default({...})` for `prompting` inside `CompanionConfigSchema` (line 3447) stays as-is (the new key is optional).

- [ ] **Step 2: Shared utils**

Create `src/ui/pages/characters/utils/customSystemPrompt.ts`:

```ts
// UI-only sentinel for the prompt template <select>; never persisted.
export const CUSTOM_PROMPT_OPTION = "__custom__";

export const ORIGINAL_TOKEN = "{{original}}";

const TOKEN_PATTERN = /\{\{([^{}]+)\}\}/g;

/** Return {{tokens}} in content that are not known variables (and not {{original}}). */
export function findUnknownTokens(
  content: string,
  knownVariables: ReadonlySet<string>,
): string[] {
  const unknown = new Set<string>();
  for (const match of content.matchAll(TOKEN_PATTERN)) {
    const token = match[1].trim();
    if (token.toLowerCase() === "original") continue;
    if (knownVariables.has(token) || knownVariables.has(`{{${token}}}`)) continue;
    unknown.add(`{{${token}}}`);
  }
  return [...unknown];
}
```

- [ ] **Step 3: English strings**

In `src/core/i18n/locales/en.ts`:

Inside `characters.description` (next to `systemPromptHint`, ~line 3253):

```ts
      customPromptOption: "Custom (this character)",
```

Inside `characters.edit` (next to `useDefaultSystemPrompt`, ~line 3811):

```ts
      customPromptOption: "Custom (this character)",
```

New block next to `components.promptTemplate` (search `promptTemplate:` inside the `components` section and add a sibling):

```ts
    customSystemPrompt: {
      label: "Character System Prompt",
      placeholder: "Write this character's system prompt…",
      originalHint:
        "expands to the default system prompt, so you can layer character instructions on top. Context variables like {{char.name}} keep working.",
      insertOriginal: "Insert default prompt",
      previewButton: "Preview",
      previewHide: "Hide preview",
      previewFailed: "<failed to render preview>",
      unknownTokens: "Unrecognized variables: {{tokens}}",
    },
```

Note: `originalHint` deliberately does NOT contain the literal `{{original}}` — the component renders the token as a `<code>` element before the hint text, because `{{...}}` in locale strings is the interpolation syntax. `{{tokens}}` in `unknownTokens` IS interpolation, filled via `t("...", { tokens })` — mirror how existing keys like `useAppDefault: "Use app default{{model}}"` are called.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/core/storage/schemas.ts src/ui/pages/characters/utils/customSystemPrompt.ts src/core/i18n/locales/en.ts
git commit -m "feat(characters): schema fields, consts, and strings for custom system prompt

By apparao.parwatikar"
```

---

### Task 7: `CustomSystemPromptEditor` component

**Files:**
- Create: `src/ui/pages/characters/components/CustomSystemPromptEditor.tsx`

**Interfaces:**
- Consumes: `findUnknownTokens`, `ORIGINAL_TOKEN` (Task 6); `renderPromptPreview`, `getPromptParameterEngine` from `../../../../core/prompts/service`; design tokens from `../../../design-tokens`; `useI18n` from `../../../../core/i18n/context`.
- Produces (used by Tasks 8–9):

```ts
export interface CustomSystemPromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Enables the Preview button; omit in the create flow (no character yet). */
  previewCharacterId?: string | null;
  disabled?: boolean;
}
export function CustomSystemPromptEditor(props: CustomSystemPromptEditorProps): JSX.Element;
```

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Loader2, Plus, AlertTriangle } from "lucide-react";
import { useI18n } from "../../../../core/i18n/context";
import {
  getPromptParameterEngine,
  renderPromptPreview,
} from "../../../../core/prompts/service";
import { typography, radius, interactive, cn } from "../../../design-tokens";
import {
  findUnknownTokens,
  ORIGINAL_TOKEN,
} from "../utils/customSystemPrompt";

export interface CustomSystemPromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  previewCharacterId?: string | null;
  disabled?: boolean;
}

export function CustomSystemPromptEditor({
  value,
  onChange,
  previewCharacterId,
  disabled,
}: CustomSystemPromptEditorProps) {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [knownVariables, setKnownVariables] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPromptParameterEngine()
      .then((engine) => {
        if (cancelled) return;
        const vars = new Set<string>();
        for (const promptType of engine.promptTypes) {
          for (const def of promptType.allowedVariables) {
            vars.add(def.variable.replace(/^\{\{|\}\}$/g, ""));
          }
        }
        setKnownVariables(vars);
      })
      .catch(() => {
        // no engine: skip token warnings rather than false-positive on everything
        setKnownVariables(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const unknownTokens = useMemo(
    () => (knownVariables.size > 0 ? findUnknownTokens(value, knownVariables) : []),
    [value, knownVariables],
  );

  function insertOriginal() {
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange(value + ORIGINAL_TOKEN);
      return;
    }
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + ORIGINAL_TOKEN + value.slice(end));
    requestAnimationFrame(() => {
      textarea.focus();
      const pos = start + ORIGINAL_TOKEN.length;
      textarea.setSelectionRange(pos, pos);
    });
  }

  async function togglePreview() {
    if (preview !== null) {
      setPreview(null);
      return;
    }
    if (!previewCharacterId) return;
    setPreviewing(true);
    try {
      const rendered = await renderPromptPreview(value, {
        characterId: previewCharacterId,
      });
      setPreview(rendered);
    } catch (error) {
      console.error("Custom prompt preview failed", error);
      setPreview(t("components.customSystemPrompt.previewFailed"));
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={t("components.customSystemPrompt.placeholder")}
        rows={10}
        className={cn(
          "w-full resize-y border bg-surface-el/20 px-4 py-3 font-mono text-sm leading-relaxed text-fg backdrop-blur-xl",
          radius.md,
          interactive.transition.default,
          "focus:border-fg/30 focus:bg-surface-el/30 focus:outline-none",
          "border-fg/10 placeholder:text-fg/30",
        )}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={insertOriginal}
          disabled={disabled}
          className={cn(
            "flex items-center gap-1.5 border border-fg/15 bg-surface-el/30 px-2.5 py-1.5 text-xs font-medium text-fg/80",
            radius.md,
            interactive.transition.default,
            "active:scale-95",
          )}
        >
          <Plus className="h-3 w-3" />
          {t("components.customSystemPrompt.insertOriginal")}
        </button>
        {previewCharacterId ? (
          <button
            type="button"
            onClick={togglePreview}
            disabled={disabled || previewing}
            className={cn(
              "flex items-center gap-1.5 border border-fg/15 bg-surface-el/30 px-2.5 py-1.5 text-xs font-medium text-fg/80",
              radius.md,
              interactive.transition.default,
              "active:scale-95",
            )}
          >
            {previewing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : preview !== null ? (
              <EyeOff className="h-3 w-3" />
            ) : (
              <Eye className="h-3 w-3" />
            )}
            {preview !== null
              ? t("components.customSystemPrompt.previewHide")
              : t("components.customSystemPrompt.previewButton")}
          </button>
        ) : null}
      </div>
      <p className={cn(typography.bodySmall.size, "text-fg/40")}>
        <code className="rounded bg-surface-el/40 px-1 py-0.5 text-[11px]">
          {ORIGINAL_TOKEN}
        </code>{" "}
        {t("components.customSystemPrompt.originalHint")}
      </p>
      {unknownTokens.length > 0 && (
        <p
          className={cn(
            typography.bodySmall.size,
            "flex items-center gap-1.5 text-amber-400/90",
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {t("components.customSystemPrompt.unknownTokens", {
            tokens: unknownTokens.join(", "),
          })}
        </p>
      )}
      {preview !== null && (
        <pre
          className={cn(
            "max-h-64 overflow-y-auto whitespace-pre-wrap border border-fg/10 bg-surface-el/20 px-4 py-3 text-xs leading-relaxed text-fg/80",
            radius.md,
          )}
        >
          {preview}
        </pre>
      )}
    </div>
  );
}
```

Adjust only if `design-tokens` exports differ (`npx tsc --noEmit` will say); keep the visual language of the surrounding form fields. If `t()` in this codebase takes interpolation params differently, mirror an existing call site of `useAppDefault: "Use app default{{model}}"`.

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/ui/pages/characters/components/CustomSystemPromptEditor.tsx
git commit -m "feat(characters): shared editor component for custom system prompt

By apparao.parwatikar"
```

---

### Task 8: Create flow wiring (useCharacterForm + CreateCharacter + DescriptionStep)

**Files:**
- Modify: `src/ui/pages/characters/hooks/useCharacterForm.ts` (state `:82`, actions `:134`, initialState `:180`, draft restore `:407-414`, setters `:578-584`, save payload `:1060-1102` + deps)
- Modify: `src/ui/pages/characters/CreateCharacter.tsx` (draft build `:228-238` + deps `:273-275`, DescriptionStep props `:465-474`)
- Modify: `src/ui/pages/characters/components/DescriptionStep.tsx` (props `:55-61`, system select `:580-599`, companion select `:746-766`)
- Modify: `src/ui/pages/characters/utils/companionDefaults.ts:67` (`withCompanionPromptTemplate`)

**Interfaces:**
- Consumes: `CustomSystemPromptEditor` (Task 7), `CUSTOM_PROMPT_OPTION` (Task 6), i18n keys (Task 6).
- Produces: form state fields used verbatim in Task 9's edit flow too: `customSystemPromptEnabled: boolean`, `customSystemPrompt: string`, `companionCustomSystemPromptEnabled: boolean`, `companionCustomSystemPrompt: string`. Extended helper signature: `withCompanionPromptTemplate(companion, promptTemplateId, customSystemPrompt?: string | null)`.

- [ ] **Step 1: Extend `withCompanionPromptTemplate`**

In `companionDefaults.ts`:

```ts
export function withCompanionPromptTemplate(
  companion: CompanionConfig | null | undefined,
  promptTemplateId: string | null,
  customSystemPrompt: string | null = null,
): CompanionConfig {
  const base = normalizeCompanionConfig(companion);

  return {
    ...base,
    prompting: {
      ...base.prompting,
      promptTemplateId,
      customSystemPrompt,
    },
  };
}
```

- [ ] **Step 2: Form state in `useCharacterForm.ts`**

1. `CharacterFormState` — after `systemPromptTemplateId`/`companionPromptTemplateId` (:82-83):

```ts
  customSystemPromptEnabled: boolean;
  customSystemPrompt: string;
  companionCustomSystemPromptEnabled: boolean;
  companionCustomSystemPrompt: string;
```

2. Actions union — after `SET_COMPANION_PROMPT_TEMPLATE_ID` (:135):

```ts
  | { type: "SET_CUSTOM_SYSTEM_PROMPT_ENABLED"; payload: boolean }
  | { type: "SET_CUSTOM_SYSTEM_PROMPT"; payload: string }
  | { type: "SET_COMPANION_CUSTOM_SYSTEM_PROMPT_ENABLED"; payload: boolean }
  | { type: "SET_COMPANION_CUSTOM_SYSTEM_PROMPT"; payload: string }
```

3. Reducer — add the four straightforward cases next to the existing `SET_SYSTEM_PROMPT_TEMPLATE_ID` case (same one-line `{ ...state, field: action.payload }` shape).
4. `initialState` (:180):

```ts
  customSystemPromptEnabled: false,
  customSystemPrompt: "",
  companionCustomSystemPromptEnabled: false,
  companionCustomSystemPrompt: "",
```

5. Setters next to `setSystemPromptTemplateId` (:578):

```ts
  const setCustomSystemPromptEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: "SET_CUSTOM_SYSTEM_PROMPT_ENABLED", payload: enabled });
  }, []);

  const setCustomSystemPrompt = useCallback((value: string) => {
    dispatch({ type: "SET_CUSTOM_SYSTEM_PROMPT", payload: value });
  }, []);

  const setCompanionCustomSystemPromptEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: "SET_COMPANION_CUSTOM_SYSTEM_PROMPT_ENABLED", payload: enabled });
  }, []);

  const setCompanionCustomSystemPrompt = useCallback((value: string) => {
    dispatch({ type: "SET_COMPANION_CUSTOM_SYSTEM_PROMPT", payload: value });
  }, []);
```

Export all four in the returned `actions` object (next to `setSystemPromptTemplateId`).

6. Draft restore — after the `SET_COMPANION_PROMPT_TEMPLATE_ID` dispatch (:411-414):

```ts
          dispatch({
            type: "SET_CUSTOM_SYSTEM_PROMPT_ENABLED",
            payload: Boolean(draftCharacter.customSystemPrompt),
          });
          dispatch({
            type: "SET_CUSTOM_SYSTEM_PROMPT",
            payload: draftCharacter.customSystemPrompt || "",
          });
          dispatch({
            type: "SET_COMPANION_CUSTOM_SYSTEM_PROMPT_ENABLED",
            payload: Boolean(draftCharacter.companion?.prompting?.customSystemPrompt),
          });
          dispatch({
            type: "SET_COMPANION_CUSTOM_SYSTEM_PROMPT",
            payload: draftCharacter.companion?.prompting?.customSystemPrompt || "",
          });
```

7. Save payload (`characterData`, :1068-1102) — replace the two prompt lines:

```ts
        companion: companionConfig,
        // ...
        promptTemplateId: state.systemPromptTemplateId,
```

with:

```ts
        promptTemplateId: state.customSystemPromptEnabled ? null : state.systemPromptTemplateId,
        customSystemPrompt:
          state.customSystemPromptEnabled && state.customSystemPrompt.trim()
            ? state.customSystemPrompt.trim()
            : null,
```

and change the `companionConfig` construction (:1060-1066) to:

```ts
      const companionConfig =
        state.mode === "companion"
          ? withCompanionPromptTemplate(
              state.companion ?? createDefaultCompanionConfig(),
              state.companionCustomSystemPromptEnabled ? null : state.companionPromptTemplateId,
              state.companionCustomSystemPromptEnabled &&
                state.companionCustomSystemPrompt.trim()
                ? state.companionCustomSystemPrompt.trim()
                : null,
            )
          : null;
```

Add the four new state fields to the `useCallback` dependency array of the save handler (next to `state.systemPromptTemplateId`).

- [ ] **Step 3: Draft persistence in `CreateCharacter.tsx`**

In the `draft` object (:228-238):

```ts
      promptTemplateId: state.customSystemPromptEnabled ? null : state.systemPromptTemplateId,
      customSystemPrompt: state.customSystemPromptEnabled ? state.customSystemPrompt : null,
      companion:
        state.mode === "companion"
          ? {
              ...(state.companion ?? {}),
              prompting: {
                ...(state.companion?.prompting ?? {}),
                promptTemplateId: state.companionCustomSystemPromptEnabled
                  ? null
                  : state.companionPromptTemplateId,
                customSystemPrompt: state.companionCustomSystemPromptEnabled
                  ? state.companionCustomSystemPrompt
                  : null,
              },
            }
          : undefined,
```

Add `state.customSystemPromptEnabled`, `state.customSystemPrompt`, `state.companionCustomSystemPromptEnabled`, `state.companionCustomSystemPrompt` to the effect dependency array (:250-284).

- [ ] **Step 4: Pass props to `DescriptionStep`** (:465-474)

```tsx
              systemPromptTemplateId={state.systemPromptTemplateId}
              onSelectSystemPrompt={actions.setSystemPromptTemplateId}
              customSystemPromptEnabled={state.customSystemPromptEnabled}
              onCustomSystemPromptEnabledChange={actions.setCustomSystemPromptEnabled}
              customSystemPrompt={state.customSystemPrompt}
              onCustomSystemPromptChange={actions.setCustomSystemPrompt}
              companionPromptTemplateId={state.companionPromptTemplateId}
              onSelectCompanionPrompt={actions.setCompanionPromptTemplateId}
              companionCustomSystemPromptEnabled={state.companionCustomSystemPromptEnabled}
              onCompanionCustomSystemPromptEnabledChange={
                actions.setCompanionCustomSystemPromptEnabled
              }
              companionCustomSystemPrompt={state.companionCustomSystemPrompt}
              onCompanionCustomSystemPromptChange={actions.setCompanionCustomSystemPrompt}
```

- [ ] **Step 5: `DescriptionStep.tsx` — props and selects**

1. Props interface (after `onSelectSystemPrompt` :59 and `onSelectCompanionPrompt` :61):

```ts
  customSystemPromptEnabled: boolean;
  onCustomSystemPromptEnabledChange: (enabled: boolean) => void;
  customSystemPrompt: string;
  onCustomSystemPromptChange: (value: string) => void;
  companionCustomSystemPromptEnabled: boolean;
  onCompanionCustomSystemPromptEnabledChange: (enabled: boolean) => void;
  companionCustomSystemPrompt: string;
  onCompanionCustomSystemPromptChange: (value: string) => void;
```

Destructure them in the component params (:103-108 area). Add imports:

```ts
import { CustomSystemPromptEditor } from "./CustomSystemPromptEditor";
import { CUSTOM_PROMPT_OPTION } from "../utils/customSystemPrompt";
```

2. System Prompt select (:580-599) — replace `value`/`onChange` and add the option + editor:

```tsx
            <select
              value={
                customSystemPromptEnabled
                  ? CUSTOM_PROMPT_OPTION
                  : (systemPromptTemplateId ?? "")
              }
              onChange={(e) => {
                if (e.target.value === CUSTOM_PROMPT_OPTION) {
                  onCustomSystemPromptEnabledChange(true);
                  onSelectSystemPrompt(null);
                } else {
                  onCustomSystemPromptEnabledChange(false);
                  onSelectSystemPrompt(e.target.value || null);
                }
              }}
              className={/* unchanged */}
            >
              <option value="" className="bg-surface-el text-fg">
                {t("characters.description.useAppDefault")}
              </option>
              <option value={CUSTOM_PROMPT_OPTION} className="bg-surface-el text-fg">
                {t("characters.description.customPromptOption")}
              </option>
              {directPromptTemplates.map(/* unchanged */)}
            </select>
```

After the loading/select ternary closes (before the `systemPromptHint` `<p>` at :606), add:

```tsx
        {customSystemPromptEnabled && (
          <CustomSystemPromptEditor
            value={customSystemPrompt}
            onChange={onCustomSystemPromptChange}
          />
        )}
```

3. Companion select (:746-766) — same pattern with the companion props (`companionCustomSystemPromptEnabled`, `onCompanionCustomSystemPromptEnabledChange`, etc.), option label `t("characters.description.customPromptOption")`, editor rendered with `disabled={mode !== "companion"}` before the `companionPromptHint` `<p>`.

- [ ] **Step 6: Verify and commit**

Run: `npm run check`
Expected: clean (tsc + cargo).

```bash
git add src/ui/pages/characters src/core
git commit -m "feat(characters): custom system prompt in create-character flow

By apparao.parwatikar"
```

---

### Task 9: Edit flow wiring (useEditCharacterForm + EditCharacter)

**Files:**
- Modify: `src/ui/pages/characters/hooks/useEditCharacterForm.ts` (state `:72-75`, initialState `:107+`, load `:373-374`, initialStateRef `:423-424`, save `:593-631`)
- Modify: `src/ui/pages/characters/EditCharacter.tsx` (state destructure near `:311`, system select `:2222-2235`, companion select `:2271-2285`)

**Interfaces:**
- Consumes: identical state field names produced in Task 8 (`customSystemPromptEnabled`, `customSystemPrompt`, `companionCustomSystemPromptEnabled`, `companionCustomSystemPrompt`), `CustomSystemPromptEditor`, `CUSTOM_PROMPT_OPTION`, extended `withCompanionPromptTemplate`.

- [ ] **Step 1: `useEditCharacterForm.ts` state**

1. `EditCharacterState` — after `companionPromptTemplateId` (:73):

```ts
  customSystemPromptEnabled: boolean;
  customSystemPrompt: string;
  companionCustomSystemPromptEnabled: boolean;
  companionCustomSystemPrompt: string;
```

2. `initialState` — add:

```ts
  customSystemPromptEnabled: false,
  customSystemPrompt: "",
  companionCustomSystemPromptEnabled: false,
  companionCustomSystemPrompt: "",
```

3. Load (`setFields` block, after `:374`):

```ts
        customSystemPromptEnabled: Boolean(character.customSystemPrompt),
        customSystemPrompt: character.customSystemPrompt || "",
        companionCustomSystemPromptEnabled: Boolean(
          companion?.prompting?.customSystemPrompt,
        ),
        companionCustomSystemPrompt: companion?.prompting?.customSystemPrompt || "",
```

4. `initialStateRef.current` (after `:424`) — same four keys/values as step 3 (mirror however `systemPromptTemplateId` participates in change detection; grep `initialStateRef` usages and include the new keys the same way).

5. Save — `companionConfig` (:593-599):

```ts
      const companionConfig =
        state.mode === "companion"
          ? withCompanionPromptTemplate(
              state.companion ?? createDefaultCompanionConfig(),
              state.companionCustomSystemPromptEnabled
                ? null
                : state.companionPromptTemplateId,
              state.companionCustomSystemPromptEnabled &&
                state.companionCustomSystemPrompt.trim()
                ? state.companionCustomSystemPrompt.trim()
                : null,
            )
          : null;
```

and in the `saveCharacter({...})` payload replace `promptTemplateId: state.systemPromptTemplateId,` (:629) with:

```ts
        promptTemplateId: state.customSystemPromptEnabled
          ? null
          : state.systemPromptTemplateId,
        customSystemPrompt:
          state.customSystemPromptEnabled && state.customSystemPrompt.trim()
            ? state.customSystemPrompt.trim()
            : null,
```

Also update the post-save `initialStateRef` refresh the same way the other fields are refreshed (grep for where it is updated after save).

- [ ] **Step 2: `EditCharacter.tsx` UI**

1. Add imports:

```ts
import { CustomSystemPromptEditor } from "./components/CustomSystemPromptEditor";
import { CUSTOM_PROMPT_OPTION } from "./utils/customSystemPrompt";
```

2. Add `customSystemPromptEnabled`, `customSystemPrompt`, `companionCustomSystemPromptEnabled`, `companionCustomSystemPrompt` to the existing state destructure (where `systemPromptTemplateId` is destructured).

3. System Prompt select (:2222-2235):

```tsx
                    <select
                      value={
                        customSystemPromptEnabled
                          ? CUSTOM_PROMPT_OPTION
                          : (systemPromptTemplateId || "")
                      }
                      onChange={(e) => {
                        if (e.target.value === CUSTOM_PROMPT_OPTION) {
                          setFields({
                            customSystemPromptEnabled: true,
                            systemPromptTemplateId: null,
                          });
                        } else {
                          setFields({
                            customSystemPromptEnabled: false,
                            systemPromptTemplateId: e.target.value || null,
                          });
                        }
                      }}
                      className={/* unchanged */}
                    >
                      <option value="">{t("characters.edit.useDefaultSystemPrompt")}</option>
                      <option value={CUSTOM_PROMPT_OPTION}>
                        {t("characters.edit.customPromptOption")}
                      </option>
                      {directPromptTemplates.map(/* unchanged */)}
                    </select>
```

After the select/loading ternary, before the `systemPromptOverrideHint` `<p>` (:2242):

```tsx
                  {customSystemPromptEnabled && (
                    <CustomSystemPromptEditor
                      value={customSystemPrompt}
                      onChange={(v) => setFields({ customSystemPrompt: v })}
                      previewCharacterId={characterId}
                      disabled={saving}
                    />
                  )}
```

(`characterId` is the id the page passes to `useEditCharacterForm`; use the identifier in scope.)

4. Companion select (:2271-2285): same pattern with the companion fields, option label `t("characters.edit.customPromptOption")`, and editor:

```tsx
                  {companionCustomSystemPromptEnabled && (
                    <CustomSystemPromptEditor
                      value={companionCustomSystemPrompt}
                      onChange={(v) => setFields({ companionCustomSystemPrompt: v })}
                      previewCharacterId={characterId}
                      disabled={saving || mode !== "companion"}
                    />
                  )}
```

- [ ] **Step 3: Verify and commit**

Run: `npm run check`
Expected: clean.

```bash
git add src/ui/pages/characters
git commit -m "feat(characters): custom system prompt in edit-character flow

By apparao.parwatikar"
```

---

### Task 10: Translations for the remaining locales

**Files:**
- Modify: `src/core/i18n/locales/{de,el,es,fil,fr,hi,id,it,ja,ko,nl,no,pl,pt,ru,tr,vi,zh-Hans,zh-Hant}.ts`

**Interfaces:** none new — same keys as Task 6, translated.

- [ ] **Step 1: Add the keys to every locale**

For each locale file, locate the same three blocks Task 6 touched in `en.ts` (search for the locale's existing `systemPromptHint` / `useDefaultSystemPrompt` / `promptTemplate` keys) and add the translated equivalents of:

- `characters.description.customPromptOption` — "Custom (this character)"
- `characters.edit.customPromptOption` — "Custom (this character)"
- `components.customSystemPrompt.{label, placeholder, originalHint, insertOriginal, previewButton, previewHide, previewFailed, unknownTokens}`

Translate naturally into each language (this repo translates all locales — see commit `48610e34` for precedent). Keep `{{tokens}}` verbatim in every translation of `unknownTokens`; do not introduce the literal `{{original}}` into any string. `previewFailed` stays `"<failed to render preview>"`-style with translated inner text.

- [ ] **Step 2: Verify and commit**

Run: `npx tsc --noEmit`
Expected: clean (locale files are type-checked against the message tree).

```bash
git add src/core/i18n/locales
git commit -m "feat(i18n): translate custom system prompt strings across locales

By apparao.parwatikar"
```

---

### Task 11: End-to-end verification (manual)

**Files:** none (verification only).

- [ ] **Step 1: Full check + tests**

Run: `npm run check && (cd src-tauri && cargo test custom_system_prompt)`
Expected: all clean/passing.

- [ ] **Step 2: Drive the app**

Run: `npm run tauri dev` (or the platform-appropriate dev script) and verify:

1. Create Character → Character Details: System Prompt dropdown shows "Custom (this character)"; selecting it reveals the editor; type `You are a pirate. {{original}}`; insert button works; finish creating the character.
2. Open a chat with that character, send a message, then open the message debug page — the resolved template source should read `character_custom_prompt` and the system prompt should start with "You are a pirate." followed by the default core directive; lorebook/memory entries still present.
3. Edit Character: dropdown shows Custom selected with the saved text; switch to a named template and back within the session — text is retained; save while on a template, reload — custom text gone (dropdown on the template).
4. Editor warnings: type `{{originall}}` → warning appears; `{{original}}` and `{{char.name}}` → no warning. Preview (edit flow) renders the expanded prompt.
5. Companion-mode character: same behavior via the Companion Prompt dropdown.
6. Export the character (settings/entity transfer), re-import it, confirm `customSystemPrompt` survived (re-open Edit Character).

- [ ] **Step 3: Final commit if fixes were needed**

Any fix discovered goes in its own commit ending with `By apparao.parwatikar`.

---

## Self-Review Notes (resolved during planning)

- Templates render from `entries`, not `content`; the transformation is entry-level (spec updated to match).
- The UI guarantees `promptTemplateId === null` while custom is active, so the runtime resolution chain needs no re-resolution — `apply_custom_system_prompt` runs on whatever base the existing chain produced (session-sourced bases excluded).
- `Character` struct literals: `group_chat_manager/mod.rs:5087` is the known site needing `custom_system_prompt: None`; cargo check is the net for any others.
- Sync `CharacterRecord` is bincode-positional; the new field follows the same convention as previously added fields (`chat_appearance`) — devices must run matching app versions to sync, as today.
