import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Workflow } from "lucide-react";

import { cn } from "../../design-tokens";
import { LorebookGeneratorPage } from "./LorebookGeneratorPage";
import { LorebookEntryGeneratorPage } from "./LorebookEntryGeneratorPage";

type LorebookTab = "full" | "entry";

const TABS: Array<{
  id: LorebookTab;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: "full",
    label: "Full Generator",
    description: "Plan, draft, and refine a complete lorebook from a brief.",
    icon: Workflow,
  },
  {
    id: "entry",
    label: "Entry Generator",
    description: "Turn selected chat messages into single lorebook entries.",
    icon: BookOpen,
  },
];

export function LorebooksPage() {
  const [activeTab, setActiveTab] = useState<LorebookTab>("full");

  return (
    <div className="flex min-h-screen flex-col">
      <div className="px-4 pt-4">
        <div className="mx-auto w-full max-w-5xl">
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-fg/10 bg-fg/3 p-1">
            {TABS.map((tab) => {
              const active = tab.id === activeTab;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                    active ? "text-fg" : "text-fg/65 hover:text-fg",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="lorebook-tab-pill"
                      className="absolute inset-0 rounded-lg bg-fg/8"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span
                    className={cn(
                      "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors",
                      active
                        ? "border-accent/40 bg-accent/15 text-accent"
                        : "border-fg/10 bg-fg/5 text-fg/55",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="block text-sm font-medium">{tab.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-fg/45">
                      {tab.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="relative flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {activeTab === "full" ? <LorebookGeneratorPage /> : <LorebookEntryGeneratorPage />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
