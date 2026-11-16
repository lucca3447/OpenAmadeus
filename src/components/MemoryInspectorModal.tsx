import React, { useState, useEffect, useRef } from 'react';
import { MemoryItem, PersonaProfile } from '../types/amadeus';
import { MemoryService } from '../services/memoryService';
import { BackendService } from '../services/backendService';
import { getUiText } from '../i18n';
import {
  Brain,
  Plus,
  X,
  Tag,
  Sparkles,
  Download,
  Upload,
  Trash2,
  Database,
  ShieldCheck,
  UserCheck,
  Layers,
  Activity,
} from 'lucide-react';

interface MemoryInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  persona: PersonaProfile;
  recalledMemoryIds?: string[];
  onMemoryAdded?: () => void;
  lang?: string;
}

export const MemoryInspectorModal: React.FC<MemoryInspectorModalProps> = ({
  isOpen,
  onClose,
  persona,
  recalledMemoryIds = [],
  onMemoryAdded,
  lang,
}) => {
  const t = getUiText(lang).memoryModal;
  const [filterSource, setFilterSource] = useState<'all' | 'canonical' | 'learned' | 'custom'>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState<boolean>(false);
  const [backendDetails, setBackendDetails] = useState<string>('');

  // Form states
  const [newTitle, setNewTitle] = useState('');
  const [newKeywords, setNewKeywords] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<MemoryItem['category']>('anecdote');
  const [newEmotion, setNewEmotion] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      BackendService.checkHealth().then((health) => {
        if (health) {
          setBackendAvailable(true);
          setBackendDetails(`ChromaDB (${health.chromaCount}) + SQLite (${health.totalSessions})`);
        } else {
          setBackendAvailable(false);
          setBackendDetails('LocalStorage');
        }
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    const keywords = newKeywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    let savedOnBackend = false;
    if (backendAvailable) {
      try {
        const created = await BackendService.addMemory({
          title: newTitle.trim(),
          category: newCategory,
          content: newContent.trim(),
          emotionalWeight: newEmotion.trim() || 'Factual / Neutro',
          source: 'custom',
        });
        savedOnBackend = Boolean(created);
      } catch (err) {
        console.warn('Backend add failed, saving to LocalStorage:', err);
      }
    }

    if (!savedOnBackend) {
      MemoryService.addMemory(persona.id, {
        title: newTitle.trim(),
        category: newCategory,
        triggerKeywords: keywords,
        content: newContent.trim(),
        emotionalWeight: newEmotion.trim() || 'Neutro / Factual',
        source: 'custom',
      });
    }

    setNewTitle('');
    setNewKeywords('');
    setNewContent('');
    setNewEmotion('');
    setShowAddForm(false);
    onMemoryAdded?.();
  };

  const handleDeleteMemory = async (memoryId: string) => {
    if (backendAvailable) {
      const ok = await BackendService.deleteMemory(memoryId);
      if (!ok) {
        MemoryService.deleteMemory(persona.id, memoryId);
      }
    } else {
      MemoryService.deleteMemory(persona.id, memoryId);
    }
    onMemoryAdded?.();
  };

  const handleClearLearned = async () => {
    if (
      confirm(t.clearConfirm)
    ) {
      if (backendAvailable) {
        await BackendService.clearLearnedMemories();
      } else {
        MemoryService.clearLearnedMemories(persona.id);
      }
      onMemoryAdded?.();
    }
  };

  const handleExportJSON = () => {
    const json = backendAvailable
      ? JSON.stringify(persona.memories, null, 2)
      : MemoryService.exportMemoriesJSON(persona.id);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openamadeus_cortex_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      if (backendAvailable) {
        try {
          const parsed: MemoryItem[] = JSON.parse(content);
          if (!Array.isArray(parsed)) throw new Error('Invalid JSON');
          const nonCanonical = parsed.filter(
            (m) => m.source !== 'canonical' && m.title && m.content
          );
          let count = 0;
          for (const item of nonCanonical) {
            const created = await BackendService.addMemory({
              title: item.title,
              category: item.category || 'anecdote',
              content: item.content,
              emotionalWeight: item.emotionalWeight || 'Factual',
              source: item.source === 'learned' ? 'learned' : 'custom',
            });
            if (created) count++;
          }
          alert(`${count} ${t.importSuccessSuffix}`);
          onMemoryAdded?.();
        } catch {
          alert(
            t.importError
          );
        }
      } else {
        const res = MemoryService.importMemoriesJSON(persona.id, content);
        if (res.success) {
          alert(`${res.count} ${t.importSuccessSuffix}`);
          onMemoryAdded?.();
        } else {
          alert(
            t.importError
          );
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const filteredMemories = persona.memories.filter((mem) => {
    if (filterSource === 'canonical') return mem.source === 'canonical' || !mem.source;
    if (filterSource === 'learned') return mem.source === 'learned';
    if (filterSource === 'custom') return mem.source === 'custom';
    return true;
  });

  const learnedCount = persona.memories.filter((m) => m.source === 'learned').length;
  const canonicalCount = persona.memories.filter(
    (m) => m.source === 'canonical' || !m.source
  ).length;
  const customCount = persona.memories.filter((m) => m.source === 'custom').length;

  const filterCapsules = [
    { id: 'all' as const, label: t.filters.all, count: persona.memories.length, icon: Layers },
    { id: 'canonical' as const, label: t.filters.canonical, count: canonicalCount, icon: ShieldCheck },
    { id: 'learned' as const, label: t.filters.learned, count: learnedCount, icon: UserCheck },
    { id: 'custom' as const, label: t.filters.custom, count: customCount, icon: Sparkles },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-fadeIn select-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="amadeus-cortex-title"
    >
      <div className="relative w-full max-w-5xl max-h-[90vh] flex flex-col md:flex-row chalkboard-grid border border-orange-500/40 shadow-[0_0_50px_rgba(0,0,0,0.95)] overflow-hidden">
        {/* Subtle Radial Amber Spotlight */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_60%_25%,rgba(234,88,12,0.09),transparent_65%)] pointer-events-none" />

        {/* ================= LEFT COLUMN: COPPER PCB FILTER CAPSULES + POWER BUS ================= */}
        <aside className="relative md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-amber-900/40 bg-black/45 p-4 flex flex-col justify-between z-10">
          {/* Vertical Glowing Conductor Line */}
          <div className="hidden md:block absolute left-9 top-6 bottom-16 bus-line-vertical z-0" />

          <div className="relative z-10 space-y-4">
            {/* Filter Capsules */}
            <div
              role="tablist"
              aria-label={t.filterAria}
              className="flex md:flex-col gap-2.5 overflow-x-auto md:overflow-visible pb-1 md:pb-0"
            >
              {filterCapsules.map((cap) => {
                const Icon = cap.icon;
                const selected = filterSource === cap.id;
                return (
                  <button
                    key={cap.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    data-selected={selected}
                    onClick={() => setFilterSource(cap.id)}
                    className="copper-capsule px-4 py-2.5 flex items-center justify-between gap-2 text-left shrink-0 md:w-full"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`w-2.5 h-2.5 rounded-full shrink-0 transition-all ${
                          selected
                            ? 'bg-orange-400 shadow-[0_0_8px_#fb923c]'
                            : 'bg-amber-900/70'
                        }`}
                      />
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          selected ? 'text-orange-400' : 'text-amber-200/70'
                        }`}
                      />
                      <span
                        className={`engraved-serif font-bold text-xs tracking-widest ${
                          selected ? 'text-amber-100' : 'text-amber-200/70'
                        }`}
                      >
                        {cap.label}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-black/70 border border-amber-900/50 text-orange-400">
                      {cap.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* I/O Tools on the Bus */}
            <div className="hidden md:flex flex-col gap-2 pt-3 border-t border-amber-900/30">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportFile}
                accept=".json"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => setShowAddForm((prev) => !prev)}
                className="copper-capsule px-3.5 py-2 flex items-center gap-2 text-amber-200 hover:text-white"
              >
                <Plus className="w-3.5 h-3.5 text-orange-400" />
                <span className="engraved-serif text-[11px] font-bold tracking-wider">
                  {showAddForm ? t.closeEditor : t.injectMemory}
                </span>
              </button>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title={t.importTitle}
                  className="px-2.5 py-1.5 bg-black/75 border border-amber-900/50 hover:border-orange-400 text-zinc-300 hover:text-amber-200 text-[10px] font-mono flex items-center justify-center gap-1 transition-colors"
                >
                  <Upload className="w-3 h-3 text-orange-400" />
                  <span>{t.importBtn}</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportJSON}
                  title={t.exportTitle}
                  className="px-2.5 py-1.5 bg-black/75 border border-amber-900/50 hover:border-orange-400 text-zinc-300 hover:text-amber-200 text-[10px] font-mono flex items-center justify-center gap-1 transition-colors"
                >
                  <Download className="w-3 h-3 text-orange-400" />
                  <span>{t.exportBtn}</span>
                </button>
              </div>

              {learnedCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearLearned}
                  className="px-3 py-1.5 bg-rose-950/35 border border-rose-500/40 hover:border-rose-400 text-rose-300 hover:text-white text-[10px] font-mono flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3 h-3 text-rose-400" />
                  <span>{t.clearLearnedBtn} ({learnedCount})</span>
                </button>
              )}
            </div>
          </div>

          {/* Bottom CÓRTEX RAG Plate + Horizontal Bus Line */}
          <div className="hidden md:block relative z-10 pt-6">
            <div className="bg-black/95 border border-orange-500/60 px-3 py-2 shadow-[0_0_20px_rgba(249,115,22,0.2)]">
              <div className="engraved-serif text-sm font-bold tracking-widest text-amber-100">
                {t.cortexRagTitle}
              </div>
              <div className="text-[9px] font-mono text-orange-400/80 tracking-widest uppercase">
                {backendAvailable ? t.onlineSub : t.offlineSub}
              </div>
            </div>
            <div className="bus-line-horizontal w-full mt-1" />
          </div>
        </aside>

        {/* ================= RIGHT COLUMN: SYNAPTIC MEMORY WORKSPACE ================= */}
        <div className="relative z-10 flex-1 flex flex-col min-h-0">
          {/* Header Bar */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-amber-900/40 bg-black/50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full border border-orange-500/50 bg-[#120e0b] flex items-center justify-center text-orange-400">
                <Brain className="w-4 h-4" />
              </div>
              <div>
                <h2
                  id="amadeus-cortex-title"
                  className="engraved-heading text-lg md:text-xl font-bold uppercase"
                >
                  {t.headerTitle} // {persona.name}
                </h2>
                <div className="text-[11px] font-mono text-orange-400/80 flex items-center gap-2">
                  <span>{persona.memories.length} {t.vectorsConsolidated}</span>
                  <span className="opacity-40">•</span>
                  <span className={backendAvailable ? 'text-emerald-400' : 'text-amber-300'}>
                    {backendDetails}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddForm((prev) => !prev)}
                className="md:hidden copper-capsule px-3 py-1.5 text-[10px] text-amber-200 flex items-center gap-1"
              >
                <Plus className="w-3 h-3 text-orange-400" />
                <span>{t.injectShort}</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                title={t.closeTitle}
                className="w-8 h-8 rounded-full border border-amber-900/60 bg-black/60 flex items-center justify-center text-zinc-400 hover:text-amber-200 hover:border-orange-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Scrollable Memory Workspace */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 font-mono text-xs">
            {/* Collapsible Add Memory Steel Deck Form */}
            {showAddForm && (
              <form
                onSubmit={handleAddMemory}
                className="widescreen-steel-deck p-5 space-y-3.5 animate-fadeIn"
              >
                <div className="flex items-center justify-between border-b border-amber-900/40 pb-2">
                  <div className="engraved-serif text-xs font-bold text-amber-200 flex items-center gap-2 tracking-widest">
                    <Sparkles className="w-4 h-4 text-orange-400" />
                    <span>{t.formHeader}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="text-[10px] text-zinc-400 hover:text-white"
                  >
                    {t.cancelBtn}
                  </button>
                </div>

                <div>
                  <label className="engraved-label text-sm block mb-1">
                    {t.titleLabel}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={t.titlePlaceholder}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full h-9 px-3 bg-black/85 border border-amber-900/60 focus:border-orange-400 text-xs text-amber-100 outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="engraved-label text-sm block mb-1">{t.categoryLabel}</label>
                    <select
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value as MemoryItem['category'])}
                      className="w-full h-9 px-2.5 bg-black/85 border border-amber-900/60 focus:border-orange-400 text-xs text-amber-100 outline-none"
                    >
                      <option value="research">{t.categories.research}</option>
                      <option value="anecdote">{t.categories.anecdote}</option>
                      <option value="relationship">{t.categories.relationship}</option>
                      <option value="biography">{t.categories.biography}</option>
                      <option value="user">{t.categories.user}</option>
                      <option value="secret">{t.categories.secret}</option>
                    </select>
                  </div>
                  <div>
                    <label className="engraved-label text-sm block mb-1">
                      {t.emotionLabel}
                    </label>
                    <input
                      type="text"
                      placeholder={t.emotionPlaceholder}
                      value={newEmotion}
                      onChange={(e) => setNewEmotion(e.target.value)}
                      className="w-full h-9 px-3 bg-black/85 border border-amber-900/60 focus:border-orange-400 text-xs text-amber-100 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="engraved-label text-sm block mb-1">
                    {t.keywordsLabel}
                  </label>
                  <input
                    type="text"
                    placeholder={t.keywordsPlaceholder}
                    value={newKeywords}
                    onChange={(e) => setNewKeywords(e.target.value)}
                    className="w-full h-9 px-3 bg-black/85 border border-amber-900/60 focus:border-orange-400 text-xs text-amber-100 outline-none"
                  />
                </div>

                <div>
                  <label className="engraved-label text-sm block mb-1">
                    {t.contentLabel}
                  </label>
                  <textarea
                    required
                    rows={3}
                    placeholder={t.contentPlaceholder}
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    className="w-full p-3 bg-black/85 border border-amber-900/60 focus:border-orange-400 text-xs text-amber-100 outline-none resize-none font-sans"
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    className="copper-capsule px-5 py-2 text-amber-100 hover:text-white flex items-center gap-2"
                  >
                    <Database className="w-3.5 h-3.5 text-orange-400" />
                    <span className="engraved-serif text-xs font-bold tracking-widest">
                      {t.submitBtn}
                    </span>
                  </button>
                </div>
              </form>
            )}

            {/* Memories List */}
            <div className="space-y-3">
              {filteredMemories.length === 0 ? (
                <div className="p-10 text-center text-xs text-zinc-500 border border-dashed border-amber-900/40 bg-black/40">
                  {t.emptyFilter}
                </div>
              ) : (
                filteredMemories.map((mem) => {
                  const isRecalled = recalledMemoryIds.includes(mem.id);
                  const isLearned = mem.source === 'learned';
                  const isCustom = mem.source === 'custom';

                  return (
                    <div
                      key={mem.id}
                      className={`p-4 border transition-all relative ${
                        isRecalled
                          ? 'widescreen-steel-deck border-orange-400 shadow-[0_0_20px_rgba(249,115,22,0.25)]'
                          : isLearned
                            ? 'bg-purple-950/20 border-purple-500/40 hover:border-purple-400/70'
                            : isCustom
                              ? 'bg-amber-950/20 border-amber-500/40 hover:border-amber-400/70'
                              : 'bg-black/65 border-amber-900/40 hover:border-orange-500/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="engraved-serif text-xs font-bold text-amber-100 tracking-wider">
                            {mem.title}
                          </span>

                          {isLearned ? (
                            <span className="text-[10px] px-2 py-0.5 bg-purple-950/80 text-purple-300 font-bold border border-purple-500/50 flex items-center gap-1">
                              <UserCheck className="w-3 h-3" />
                              <span>{t.badgeLearned}</span>
                            </span>
                          ) : isCustom ? (
                            <span className="text-[10px] px-2 py-0.5 bg-amber-950/80 text-amber-300 font-bold border border-amber-500/50 flex items-center gap-1">
                              <Sparkles className="w-3 h-3" />
                              <span>{t.badgeCustom}</span>
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 bg-zinc-900 text-zinc-400 border border-zinc-700 flex items-center gap-1 uppercase">
                              <ShieldCheck className="w-3 h-3 text-orange-400" />
                              <span>{t.badgeCanonical}</span>
                            </span>
                          )}

                          {isRecalled && (
                            <span className="text-[10px] px-2 py-0.5 bg-orange-500/20 text-orange-300 border border-orange-400/60 flex items-center gap-1 animate-pulse">
                              <Activity className="w-3 h-3" />
                              <span>{t.badgeActive}</span>
                            </span>
                          )}
                        </div>

                        {(isLearned || isCustom) && (
                          <button
                            onClick={() => handleDeleteMemory(mem.id)}
                            title={t.deleteTitle}
                            className="text-zinc-500 hover:text-rose-400 transition-colors p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-zinc-200 font-sans leading-relaxed mb-3">
                        {mem.content}
                      </p>

                      <div className="flex flex-wrap items-center justify-between text-[11px] text-zinc-400 pt-2 border-t border-amber-900/30 gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Tag className="w-3 h-3 text-orange-400 shrink-0" />
                          {mem.triggerKeywords && mem.triggerKeywords.length > 0 ? (
                            mem.triggerKeywords.map((kw, i) => (
                              <span
                                key={i}
                                className="text-[10px] bg-black/70 border border-amber-900/40 px-1.5 py-0.5 text-amber-300/90"
                              >
                                #{kw}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-zinc-500">
                              {t.ragIndexed}
                            </span>
                          )}
                        </div>

                        {mem.emotionalWeight && (
                          <div className="text-[10px] text-zinc-400">
                            {t.valencePrefix} <span className="text-amber-200">{mem.emotionalWeight}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="px-6 py-3.5 border-t border-amber-900/40 bg-black/75 flex items-center justify-between">
            <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
              <Database className="w-3.5 h-3.5 text-orange-400" />
              <span>{t.footerNote}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="copper-capsule px-5 py-1.5 text-amber-100 hover:text-white"
            >
              <span className="engraved-serif text-xs font-bold tracking-widest">{t.closeBtn}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
