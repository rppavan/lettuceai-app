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
  /** Enables the Preview button; omit in the create flow (no character yet). */
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
