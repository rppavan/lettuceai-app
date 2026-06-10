import { useEffect, useState } from "react";
import { ChevronDown, FilePlus2, HardDrive, Check, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";

import {
  LOCAL_DIFFUSION_PROVIDER_ID,
  sdImportLora,
  sdListLoras,
  type SdLocalFile,
} from "../../core/local-diffusion";
import { readSettings } from "../../core/storage/repo";
import { useI18n } from "../../core/i18n/context";
import { toast } from "./toast";
import { BottomMenu, MenuButton, MenuSection } from "./BottomMenu";
import { NumberInput } from "./NumberInput";

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent > 1 ? 1 : 0)} ${units[exponent]}`;
}

function loraStem(filename: string): string {
  return filename.replace(/\.(safetensors|gguf|ckpt|sft)$/i, "");
}

export function LoraSelector({
  loraName,
  loraStrength,
  onChange,
}: {
  loraName: string | null | undefined;
  loraStrength: number | null | undefined;
  onChange: (name: string | null, strength: number | null) => void;
}) {
  const { t } = useI18n();
  const [hasLocalDiffusion, setHasLocalDiffusion] = useState(false);
  const [loras, setLoras] = useState<SdLocalFile[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    readSettings()
      .then((settings) => {
        setHasLocalDiffusion(
          settings.models.some((model) => model.providerId === LOCAL_DIFFUSION_PROVIDER_ID),
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!pickerOpen || loras !== null) return;
    sdListLoras()
      .then(setLoras)
      .catch(() => setLoras([]));
  }, [pickerOpen, loras]);

  if (!hasLocalDiffusion) {
    return null;
  }

  const importLora = async () => {
    const selection = await open({
      multiple: false,
      filters: [{ name: "LoRA files", extensions: ["safetensors", "ckpt", "sft", "gguf"] }],
    });
    if (typeof selection !== "string") return;
    try {
      const file = await sdImportLora(selection);
      setLoras(null);
      onChange(loraStem(file.filename), loraStrength ?? 0.8);
      setPickerOpen(false);
    } catch (err) {
      toast.error(
        t("loraSelector.importFailed"),
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-fg/70">{t("loraSelector.title")}</span>
        {loraName ? (
          <button
            type="button"
            onClick={() => onChange(null, null)}
            className="inline-flex items-center gap-1 text-xs text-fg/45 transition-colors hover:text-danger/80"
          >
            <X className="h-3 w-3" />
            {t("common.buttons.remove")}
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex min-w-0 flex-1 items-center justify-between rounded-lg border border-fg/10 bg-surface-el/20 px-3.5 py-2.5 text-left transition hover:bg-surface-el/30"
        >
          <span
            className={
              loraName ? "truncate text-[13px] text-fg/85" : "truncate text-[13px] text-fg/40"
            }
          >
            {loraName || t("loraSelector.none")}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-fg/40" />
        </button>
        {loraName ? (
          <div className="w-24 shrink-0">
            <NumberInput
              min={0}
              max={2}
              step={0.05}
              decimals={2}
              value={loraStrength ?? 0.8}
              onChange={(next) => onChange(loraName, next)}
              className="w-full rounded-lg border border-fg/10 bg-surface-el/20 px-3 py-2.5 text-center text-[13px] text-fg focus:border-fg/30 focus:outline-none"
            />
          </div>
        ) : null}
      </div>
      <p className="text-xs leading-5 text-fg/40">{t("loraSelector.hint")}</p>

      <BottomMenu
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t("loraSelector.title")}
      >
        <MenuSection>
          <MenuButton
            icon={<FilePlus2 className="h-5 w-5 text-accent/60" />}
            title={t("loraSelector.importFile")}
            description={t("loraSelector.importDescription")}
            color="from-accent/20 to-accent/10"
            onClick={() => void importLora()}
          />
          {(loras ?? []).map((file) => {
            const stem = loraStem(file.filename);
            return (
              <MenuButton
                key={file.path}
                icon={<HardDrive className="h-5 w-5 text-fg/40" />}
                title={stem}
                description={formatBytes(file.size)}
                color="from-white/10 to-white/5"
                rightElement={
                  loraName === stem ? <Check className="h-4 w-4 text-accent" /> : undefined
                }
                onClick={() => {
                  onChange(stem, loraStrength ?? 0.8);
                  setPickerOpen(false);
                }}
              />
            );
          })}
        </MenuSection>
      </BottomMenu>
    </div>
  );
}
