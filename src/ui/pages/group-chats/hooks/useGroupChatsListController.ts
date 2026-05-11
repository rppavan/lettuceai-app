import { useCallback, useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { storageBridge } from "../../../../core/storage/files";
import { listCharacters } from "../../../../core/storage/repo";
import type { GroupPreview, GroupSessionPreview, Character } from "../../../../core/storage/schemas";

export function useGroupChatsListController() {
  const [groups, setGroups] = useState<GroupPreview[]>([]);
  const [sessions, setSessions] = useState<GroupSessionPreview[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<GroupPreview | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<GroupSessionPreview | null>(null);
  const [showSessionDeleteConfirm, setShowSessionDeleteConfirm] = useState(false);
  const [deletingSession, setDeletingSession] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [items, allSessions, chars] = await Promise.all([
        storageBridge.groupsList(),
        storageBridge.groupSessionsListAll(),
        listCharacters(),
      ]);
      setGroups(items);
      setSessions(allSessions);
      setCharacters(chars);
    } catch (err) {
      console.error("Failed to load groups:", err);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadData();
      } finally {
        setLoading(false);
      }
    })();

    let unlisten: UnlistenFn | null = null;
    (async () => {
      unlisten = await listen("database-reloaded", () => {
        console.log("Database reloaded, refreshing group sessions...");
        void loadData();
      });
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadData]);

  const handleDelete = useCallback(async () => {
    if (!selectedGroup) return;

    try {
      setDeleting(true);
      await storageBridge.groupDelete(selectedGroup.id);
      await loadData();
      setShowDeleteConfirm(false);
      setSelectedGroup(null);
      setExpandedGroupId((current) => (current === selectedGroup.id ? null : current));
    } catch (err) {
      console.error("Failed to delete group:", err);
    } finally {
      setDeleting(false);
    }
  }, [selectedGroup, loadData]);

  const handleToggleExpand = useCallback((groupId: string) => {
    setExpandedGroupId((current) => (current === groupId ? null : groupId));
  }, []);

  const handleSessionDelete = useCallback(async () => {
    if (!selectedSession) return;

    try {
      setDeletingSession(true);
      await storageBridge.groupSessionDelete(selectedSession.id);
      await loadData();
      setShowSessionDeleteConfirm(false);
      setSelectedSession(null);
    } catch (err) {
      console.error("Failed to delete session:", err);
    } finally {
      setDeletingSession(false);
    }
  }, [selectedSession, loadData]);

  const handleNewChat = useCallback(async (groupId: string) => {
    try {
      const session = await storageBridge.groupCreateSession(groupId);
      await loadData();
      return session;
    } catch (err) {
      console.error("Failed to create new group chat:", err);
      return null;
    }
  }, [loadData]);

  return {
    groups,
    sessions,
    characters,
    loading,
    selectedGroup,
    showDeleteConfirm,
    deleting,
    expandedGroupId,
    setSelectedGroup,
    setShowDeleteConfirm,
    handleDelete,
    handleToggleExpand,
    handleNewChat,
    selectedSession,
    setSelectedSession,
    showSessionDeleteConfirm,
    setShowSessionDeleteConfirm,
    deletingSession,
    handleSessionDelete,
  } as const;
}
