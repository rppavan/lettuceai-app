import { useState, useCallback, useRef, useEffect } from "react";
import { Camera } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn, radius, interactive } from "../../design-tokens";
import { resolveAvatarGenerationOptions } from "../../../core/image-generation";
import { convertFilePathToDataUrl } from "../../../core/storage/images";
import { readSettings, SETTINGS_UPDATED_EVENT } from "../../../core/storage/repo";
import { isRenderableImageUrl } from "../../../core/utils/image";
import type { AvatarCrop } from "../../../core/storage/schemas";
import { AvatarImage } from "../AvatarImage";

import { AvatarSourceMenu } from "./AvatarSourceMenu";
import { AvatarCurrentEditMenu } from "./AvatarCurrentEditMenu";
import { AvatarGenerationSheet } from "./AvatarGenerationSheet";
import { AvatarPositionModal } from "./AvatarPositionModal";
import {
  buildAvatarLibrarySelectionKey,
  type AvatarLibrarySelectionPayload,
} from "./librarySelection";

export { AvatarSourceMenu, AvatarCurrentEditMenu, AvatarGenerationSheet, AvatarPositionModal };

interface AvatarPickerProps {
  currentAvatarPath: string;
  onAvatarChange: (path: string) => void;
  onBeforeChooseFromLibrary?: () => void;
  promptSubjectName?: string;
  promptSubjectDescription?: string;
  avatarCrop?: AvatarCrop | null;
  onAvatarCropChange?: (crop: AvatarCrop | null) => void;
  avatarRoundPath?: string | null;
  onAvatarRoundChange?: (path: string | null) => void;
  avatarPreview?: React.ReactNode;
  placeholder?: string;
  size?: "sm" | "md" | "lg";
  showRemoveButton?: boolean;
  onRemove?: () => void;
}

export function AvatarPicker({
  currentAvatarPath,
  onAvatarChange,
  onBeforeChooseFromLibrary,
  promptSubjectName,
  promptSubjectDescription,
  avatarCrop,
  onAvatarCropChange,
  avatarRoundPath,
  onAvatarRoundChange,
  avatarPreview,
  placeholder,
  size = "lg",
}: AvatarPickerProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [showMenu, setShowMenu] = useState(false);
  const [showEditCurrentMenu, setShowEditCurrentMenu] = useState(false);
  const [showGenerationSheet, setShowGenerationSheet] = useState(false);
  const [showPositionModal, setShowPositionModal] = useState(false);
  const [pendingImageSrc, setPendingImageSrc] = useState<string | null>(null);
  const [localAvatarPreviewPath, setLocalAvatarPreviewPath] = useState<string | null>(null);
  const [localAvatarRoundPreviewPath, setLocalAvatarRoundPreviewPath] = useState<string | null>(null);
  const [hasImageGenModels, setHasImageGenModels] = useState(false);
  const [generationMode, setGenerationMode] = useState<"create" | "edit-current">("create");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hadExternalAvatarRef = useRef(false);
  const returnPath = `${location.pathname}${location.search}`;
  const summarizeSrc = useCallback((value?: string | null) => {
    if (!value) return "(empty)";
    if (value.startsWith("data:")) return `data-url(${value.slice(0, 24)}..., len=${value.length})`;
    return value.length > 96 ? `${value.slice(0, 96)}...` : value;
  }, []);

  useEffect(() => {
    const loadAvailability = async () => {
      try {
        const settings = await readSettings();
        const options = resolveAvatarGenerationOptions(settings);
        setHasImageGenModels(options.enabled && options.models.length > 0);
      } catch {
        setHasImageGenModels(false);
      }
    };

    void loadAvailability();
    window.addEventListener(SETTINGS_UPDATED_EVENT, loadAvailability);
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, loadAvailability);
  }, []);

  useEffect(() => {
    if (currentAvatarPath) {
      setLocalAvatarPreviewPath(currentAvatarPath);
    }
    if (avatarRoundPath) {
      setLocalAvatarRoundPreviewPath(avatarRoundPath);
    }

    const hasExternalAvatar = !!(currentAvatarPath || avatarRoundPath);
    if (!hasExternalAvatar && hadExternalAvatarRef.current) {
      setLocalAvatarPreviewPath(null);
      setLocalAvatarRoundPreviewPath(null);
    }
    hadExternalAvatarRef.current = hasExternalAvatar;
    console.log("[AvatarPicker] external sync", {
      currentAvatarPath: summarizeSrc(currentAvatarPath),
      avatarRoundPath: summarizeSrc(avatarRoundPath),
      hasExternalAvatar,
    });
  }, [avatarRoundPath, currentAvatarPath]);

  const sizeClasses = {
    sm: "h-20 w-20",
    md: "h-28 w-28",
    lg: "h-48 w-48",
  };

  const handleButtonClick = useCallback(() => {
    setShowMenu(true);
  }, []);

  const handleChooseImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleChooseFromLibrary = useCallback(() => {
    console.log("[AvatarPicker] choose from library", { returnPath });
    onBeforeChooseFromLibrary?.();
    navigate("/library/images/pick", {
      state: {
        returnPath,
      },
    });
  }, [navigate, onBeforeChooseFromLibrary, returnPath]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    console.log("[AvatarPicker] file selected", {
      name: file.name,
      type: file.type,
      size: file.size,
    });

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      console.log("[AvatarPicker] file read complete", { dataUrl: summarizeSrc(dataUrl) });
      setPendingImageSrc(dataUrl);
      setShowPositionModal(true);
    };
    reader.readAsDataURL(file);

    e.target.value = "";
  }, []);

  const handleGeneratedImage = useCallback((imageDataUrl: string) => {
    console.log("[AvatarPicker] generated image received", {
      imageDataUrl: summarizeSrc(imageDataUrl),
    });
    setPendingImageSrc(imageDataUrl);
    setShowPositionModal(true);
  }, [summarizeSrc]);

  const handleEditCurrent = useCallback(() => {
    if (!currentAvatarPath) return;
    setShowEditCurrentMenu(true);
  }, [currentAvatarPath]);

  const normalizeModalImageSrc = useCallback(async (src: string): Promise<string> => {
    if (!src) {
      return src;
    }

    if (!isRenderableImageUrl(src) || src.startsWith("data:")) {
      return src;
    }

    const response = await fetch(src);
    if (!response.ok) {
      throw new Error(`Failed to load avatar asset (${response.status})`);
    }

    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to convert avatar asset to data URL"));
      reader.readAsDataURL(blob);
    });
  }, []);

  const handleRepositionCurrent = useCallback(() => {
    if (!currentAvatarPath) return;
    void (async () => {
      try {
        const normalizedSrc = await normalizeModalImageSrc(currentAvatarPath);
        console.log("[AvatarPicker] reposition current normalized", {
          currentAvatarPath: summarizeSrc(currentAvatarPath),
          normalizedSrc: summarizeSrc(normalizedSrc),
        });
        setPendingImageSrc(normalizedSrc);
        setShowPositionModal(true);
      } catch (error) {
        console.error("[AvatarPicker] failed to normalize current avatar for reposition", error);
      }
    })();
  }, [currentAvatarPath, normalizeModalImageSrc, summarizeSrc]);

  const handleEditCurrentWithAI = useCallback(() => {
    if (!currentAvatarPath) return;
    setGenerationMode("edit-current");
    setShowGenerationSheet(true);
  }, [currentAvatarPath]);

  const handlePositionConfirm = useCallback(
    ({
      baseImageData,
      roundImageData,
    }: {
      baseImageData: string;
      roundImageData: string;
    }) => {
      console.log("[AvatarPicker] position confirm", {
        pendingImageSrc: summarizeSrc(pendingImageSrc),
        baseImageData: summarizeSrc(baseImageData),
        roundImageData: summarizeSrc(roundImageData),
      });
      setLocalAvatarPreviewPath(baseImageData);
      if (pendingImageSrc) {
        onAvatarChange(pendingImageSrc);
      } else {
        onAvatarChange(baseImageData);
      }
      setLocalAvatarRoundPreviewPath(roundImageData);
      onAvatarRoundChange?.(roundImageData);
      onAvatarCropChange?.(null);
      setPendingImageSrc(null);
    },
    [onAvatarChange, onAvatarRoundChange, onAvatarCropChange, pendingImageSrc, summarizeSrc],
  );

  const handlePositionModalClose = useCallback(() => {
    setShowPositionModal(false);
    setPendingImageSrc(null);
  }, []);

  useEffect(() => {
    const storageKey = buildAvatarLibrarySelectionKey(returnPath);
    const rawSelection = sessionStorage.getItem(storageKey);
    if (!rawSelection) {
      return;
    }

    let parsed: AvatarLibrarySelectionPayload | null = null;
    try {
      parsed = JSON.parse(rawSelection) as AvatarLibrarySelectionPayload;
    } catch (error) {
      console.error("Failed to parse avatar library selection:", error);
      return;
    }

    if (!parsed?.filePath) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const dataUrl = await convertFilePathToDataUrl(parsed.filePath);
      if (!dataUrl || cancelled) {
        console.log("[AvatarPicker] library selection conversion failed or cancelled", {
          filePath: parsed.filePath,
          cancelled,
        });
        return;
      }
      sessionStorage.removeItem(storageKey);
      console.log("[AvatarPicker] library selection converted", {
        filePath: parsed.filePath,
        dataUrl: summarizeSrc(dataUrl),
      });
      setPendingImageSrc(dataUrl);
      setShowPositionModal(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [returnPath, summarizeSrc]);

  const displayAvatarSrc =
    localAvatarRoundPreviewPath ||
    avatarRoundPath ||
    localAvatarPreviewPath ||
    currentAvatarPath;
  const hasDisplayAvatar = !!displayAvatarSrc;

  useEffect(() => {
    console.log("[AvatarPicker] render sources", {
      displayAvatarSrc: summarizeSrc(displayAvatarSrc),
      localAvatarPreviewPath: summarizeSrc(localAvatarPreviewPath),
      localAvatarRoundPreviewPath: summarizeSrc(localAvatarRoundPreviewPath),
      currentAvatarPath: summarizeSrc(currentAvatarPath),
      avatarRoundPath: summarizeSrc(avatarRoundPath),
      hasDisplayAvatar,
      pendingImageSrc: summarizeSrc(pendingImageSrc),
      showPositionModal,
    });
  }, [
    avatarRoundPath,
    currentAvatarPath,
    displayAvatarSrc,
    hasDisplayAvatar,
    localAvatarPreviewPath,
    localAvatarRoundPreviewPath,
    pendingImageSrc,
    showPositionModal,
    summarizeSrc,
  ]);

  return (
    <div className="relative inline-block">
      {/* Main avatar container */}
      <div
        className={cn(
          "relative overflow-hidden flex items-center justify-center",
          sizeClasses[size],
          radius.full,
          "bg-[#111113]",
          hasDisplayAvatar
            ? "border-[3px] border-white/10"
            : "border-2 border-dashed border-white/15",
        )}
      >
        {avatarPreview ? (
          avatarPreview
        ) : hasDisplayAvatar ? (
          <AvatarImage
            src={displayAvatarSrc}
            alt="Avatar"
            crop={avatarCrop}
            applyCrop
          />
        ) : placeholder ? (
          <span
            className={cn(
              "font-semibold text-white/30",
              size === "sm" ? "text-base" : size === "md" ? "text-xl" : "text-2xl",
            )}
          >
            {placeholder}
          </span>
        ) : null}
      </div>

      {/* Camera button */}
      <button
        ref={buttonRef}
        onClick={handleButtonClick}
        className={cn(
          "absolute z-20 flex items-center justify-center",
          "bottom-0 right-0 h-12 w-12",
          radius.full,
          "bg-[#1a1a1c] border border-white/10",
          "text-white/70",
          interactive.transition.default,
          "hover:bg-[#252528] hover:text-white hover:border-white/20",
          "active:scale-95",
        )}
      >
        <Camera size={16} strokeWidth={2} />
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      <AvatarSourceMenu
        isOpen={showMenu}
        onClose={() => setShowMenu(false)}
        onGenerateImage={() => {
          setGenerationMode("create");
          setShowGenerationSheet(true);
        }}
        onChooseFromLibrary={handleChooseFromLibrary}
        onChooseImage={handleChooseImage}
        onEditCurrent={handleEditCurrent}
        hasImageGenerationModels={hasImageGenModels}
        hasCurrentAvatar={hasDisplayAvatar}
      />

      <AvatarCurrentEditMenu
        isOpen={showEditCurrentMenu}
        onClose={() => setShowEditCurrentMenu(false)}
        onReposition={handleRepositionCurrent}
        onEditWithAI={handleEditCurrentWithAI}
        hasImageGenerationModels={hasImageGenModels}
      />

      <AvatarGenerationSheet
        isOpen={showGenerationSheet}
        onClose={() => {
          setShowGenerationSheet(false);
          setGenerationMode("create");
        }}
        onImageGenerated={handleGeneratedImage}
        subjectName={promptSubjectName}
        subjectDescription={promptSubjectDescription}
        initialImageSrc={generationMode === "edit-current" ? currentAvatarPath : null}
        startInEditMode={generationMode === "edit-current"}
        hidePromptNavigation={generationMode === "edit-current"}
      />

      {pendingImageSrc && (
        <AvatarPositionModal
          isOpen={showPositionModal}
          onClose={handlePositionModalClose}
          imageSrc={pendingImageSrc}
          onConfirm={handlePositionConfirm}
        />
      )}
    </div>
  );
}
