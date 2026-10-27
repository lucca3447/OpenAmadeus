import React, { useState, useEffect, useRef } from 'react';
import { MemoryItem, PersonaProfile } from '../types/amadeus';
import { MemoryService } from '../services/memoryService';
import { BackendService } from '../services/backendService';
import { Brain, Plus, X, Tag, Sparkles, Download, Upload, Trash2, Database, ShieldCheck, UserCheck } from 'lucide-react';

interface MemoryInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  persona: PersonaProfile;
  recalledMemoryIds?: string[];
  onMemoryAdded?: () => void;
}

export const MemoryInspectorModal: React.FC<MemoryInspectorModalProps> = ({
  isOpen,
  onClose,
  persona,
  recalledMemoryIds = [],
  onMemoryAdded,
}) => {
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
          setBackendDetails(`ChromaDB (${health.chromaCount} vetores) + SQLite (${health.totalSessions} sessões)`);
        } else {
          setBackendAvailable(false);
          setBackendDetails('Navegador Local (LocalStorage)');
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
    if (confirm('Deseja realmente limpar todas as memórias aprendidas durante suas conversas? As memórias canônicas de Steins;Gate serão mantidas.')) {
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
    a.download = `amadeus_kurisu_cortex_${Date.now()}.json`;
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
          const nonCanonical = parsed.filter((m) => m.source !== 'canonical' && m.title && m.content);
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
          alert(`${count} memórias importadas com sucesso para o Córtex!`);
          onMemoryAdded?.();
        } catch {
          alert('Erro ao importar arquivo. Certifique-se de que é um JSON válido de memórias do Amadeus.');
        }
      } else {
        const res = MemoryService.importMemoriesJSON(persona.id, content);
        if (res.success) {
          alert(`${res.count} memórias importadas com sucesso para o Córtex!`);
          onMemoryAdded?.();
        } else {
          alert('Erro ao importar arquivo. Certifique-se de que é um JSON válido de memórias do Amadeus.');
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Filter memories
  const filteredMemories = persona.memories.filter((mem) => {
    if (filterSource === 'canonical') return mem.source === 'canonical' || !mem.source;
    if (filterSource === 'learned') return mem.source === 'learned';
    if (filterSource === 'custom') return mem.source === 'custom';
    return true;
  });

  const learnedCount = persona.memories.filter((m) => m.source === 'learned').length;
  const canonicalCount = persona.memories.filter((m) => m.source === 'canonical' || !m.source).length;
  const customCount = persona.memories.filter((m) => m.source === 'custom').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl bg-amadeus-panel border border-amadeus-border shadow-[0_0_40px_rgba(0,0,0,0.9)] overflow-hidden font-mono text-sm">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-amadeus-border bg-amadeus-card">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-amadeus-border/40 flex items-center justify-center text-amadeus-accent">
              <Brain className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-amadeus-accent tracking-wider text-glow-nixie">
                INSPETOR DE CÓRTEX & MEMÓRIAS // {persona.name.toUpperCase()}
              </h2>
              <div className="text-[11px] text-amadeus-muted flex items-center gap-2">
                <span>{persona.memories.length} BLOCOS DE MEMÓRIA</span>
                <span className="opacity-40">|</span>
                <span className={backendAvailable ? 'text-amadeus-accent' : 'text-amber-400'}>
                  {backendDetails}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded flex items-center justify-center text-amadeus-muted hover:text-white hover:bg-amadeus-border/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Bar (Filters + Export/Import) */}
        <div className="px-6 py-2.5 border-b border-amadeus-border/60 bg-black/40 flex flex-wrap items-center justify-between gap-2">
          {/* Source Tabs */}
          <div className="flex items-center gap-1 text-[11px]">
            <button
              onClick={() => setFilterSource('all')}
              className={`px-2.5 py-1 rounded transition-colors ${
                filterSource === 'all'
                  ? 'bg-amadeus-accent text-black font-bold'
                  : 'bg-amadeus-card text-amadeus-muted hover:text-white'
              }`}
            >
              Todas ({persona.memories.length})
            </button>
            <button
              onClick={() => setFilterSource('canonical')}
              className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors ${
                filterSource === 'canonical'
                  ? 'bg-amadeus-accent text-black font-bold'
                  : 'bg-amadeus-card text-amadeus-muted hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3 h-3" />
              Canônicas ({canonicalCount})
            </button>
            <button
              onClick={() => setFilterSource('learned')}
              className={`px-2.5 py-1 rounded flex items-center gap-1 transition-colors ${
                filterSource === 'learned'
                  ? 'bg-purple-400 text-black font-bold'
                  : 'bg-amadeus-card text-purple-300 hover:text-white'
              }`}
            >
              <UserCheck className="w-3 h-3" />
              Aprendidas ({learnedCount})
            </button>
            {customCount > 0 && (
              <button
                onClick={() => setFilterSource('custom')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  filterSource === 'custom'
                    ? 'bg-amber-400 text-black font-bold'
                    : 'bg-amadeus-card text-amber-300 hover:text-white'
                }`}
              >
                Custom ({customCount})
              </button>
            )}
          </div>

          {/* Tools */}
          <div className="flex items-center gap-2 text-[11px]">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImportFile}
              accept=".json"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Importar memórias de um arquivo JSON"
              className="p-1.5 rounded bg-amadeus-card border border-amadeus-border text-amadeus-muted hover:text-white hover:border-amadeus-accent transition-colors flex items-center gap-1"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Importar</span>
            </button>
            <button
              onClick={handleExportJSON}
              title="Exportar todo o córtex em arquivo JSON de backup"
              className="p-1.5 rounded bg-amadeus-card border border-amadeus-border text-amadeus-muted hover:text-white hover:border-amadeus-accent transition-colors flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Exportar</span>
            </button>
            {learnedCount > 0 && (
              <button
                onClick={handleClearLearned}
                title="Limpar apenas as memórias aprendidas com você"
                className="p-1.5 rounded bg-red-950/40 border border-red-800/40 text-red-400 hover:bg-red-900/60 hover:text-red-200 transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Limpar Aprendidas</span>
              </button>
            )}
          </div>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Add Memory Button / Toggle */}
          <div className="flex items-center justify-between">
            <div className="text-xs text-amadeus-muted">
              Mostrando {filteredMemories.length} memórias ativas:
            </div>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-3 py-1.5 rounded bg-amadeus-border/40 border border-amadeus-accent/40 text-amadeus-accent text-xs flex items-center gap-1.5 hover:bg-amadeus-accent hover:text-black transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showAddForm ? 'Cancelar' : 'Digitalizar Nova Memória'}</span>
            </button>
          </div>

          {/* New Memory Form */}
          {showAddForm && (
            <form onSubmit={handleAddMemory} className="p-4 rounded-lg bg-amadeus-card border border-amadeus-accent/40 space-y-3 animate-fadeIn">
              <div className="text-xs font-bold text-amadeus-accent flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>INJETAR NOVO BLOCO SINÁPTICO</span>
              </div>
              <div>
                <label className="text-[11px] text-amadeus-muted block mb-1">Título da Memória:</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Conversa sobre o futuro no terraço"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-amadeus-panel border border-amadeus-border text-xs text-white focus:outline-none focus:border-amadeus-accent"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-amadeus-muted block mb-1">Categoria:</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as any)}
                    className="w-full h-8 px-2 rounded bg-amadeus-panel border border-amadeus-border text-xs text-white focus:outline-none focus:border-amadeus-accent"
                  >
                    <option value="anecdote">História Pessoal / Episódio</option>
                    <option value="research">Pesquisa / Teoria Científica</option>
                    <option value="relationship">Relação Interpessoal</option>
                    <option value="secret">Segredo / Fato Oculto</option>
                    <option value="biography">Biografia / Fato de Vida</option>
                    <option value="user">Dado sobre o Operador</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-amadeus-muted block mb-1">Sentimento / Peso Emocional:</label>
                  <input
                    type="text"
                    placeholder="Ex: Nostalgia e carinho"
                    value={newEmotion}
                    onChange={(e) => setNewEmotion(e.target.value)}
                    className="w-full h-8 px-3 rounded bg-amadeus-panel border border-amadeus-border text-xs text-white focus:outline-none focus:border-amadeus-accent"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-amadeus-muted block mb-1">Palavras-chave Gatilho (separadas por vírgula):</label>
                <input
                  type="text"
                  placeholder="Ex: terraço, noite, futuro, promessa"
                  value={newKeywords}
                  onChange={(e) => setNewKeywords(e.target.value)}
                  className="w-full h-8 px-3 rounded bg-amadeus-panel border border-amadeus-border text-xs text-white focus:outline-none focus:border-amadeus-accent"
                />
              </div>
              <div>
                <label className="text-[11px] text-amadeus-muted block mb-1">Conteúdo Detalhado da Memória:</label>
                <textarea
                  required
                  rows={3}
                  placeholder="Descreva o evento, a tese ou o fato a ser consolidado no córtex da Kurisu..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="w-full p-2.5 rounded bg-amadeus-panel border border-amadeus-border text-xs text-white focus:outline-none focus:border-amadeus-accent resize-none font-sans"
                />
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-amadeus-accent text-black font-bold text-xs hover:bg-amadeus-highlight transition-colors flex items-center gap-1.5"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>Consolidar no Córtex</span>
                </button>
              </div>
            </form>
          )}

          {/* Memories List */}
          <div className="space-y-3">
            {filteredMemories.length === 0 ? (
              <div className="p-8 text-center text-xs text-amadeus-muted border border-dashed border-amadeus-border rounded-lg">
                Nenhuma memória encontrada nesta categoria.
              </div>
            ) : (
              filteredMemories.map((mem) => {
                const isRecalled = recalledMemoryIds.includes(mem.id);
                const isLearned = mem.source === 'learned';
                const isCustom = mem.source === 'custom';

                return (
                  <div
                    key={mem.id}
                    className={`p-4 rounded-lg border transition-all ${
                      isRecalled
                        ? 'bg-amadeus-card/90 border-amadeus-accent shadow-[0_0_15px_rgba(0,255,136,0.15)] ring-1 ring-amadeus-accent/50'
                        : isLearned
                        ? 'bg-purple-950/20 border-purple-800/40 hover:border-purple-600/60'
                        : isCustom
                        ? 'bg-amber-950/20 border-amber-800/40 hover:border-amber-600/60'
                        : 'bg-amadeus-card/50 border-amadeus-border hover:border-amadeus-border/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-white tracking-wide">
                          {mem.title}
                        </span>

                        {isLearned ? (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-purple-900/60 text-purple-300 font-bold border border-purple-600/40">
                            ★ APRENDIDA COM VOCÊ
                          </span>
                        ) : isCustom ? (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-900/60 text-amber-300 font-bold border border-amber-600/40">
                            ★ CUSTOMIZADA
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-amadeus-border/40 text-amadeus-muted uppercase">
                            CANÔNICA S;G
                          </span>
                        )}

                        {isRecalled && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-amadeus-accent/20 text-amadeus-accent border border-amadeus-accent/40 animate-pulse">
                            SINAPSE ATIVA
                          </span>
                        )}
                      </div>

                      {/* Delete button for custom / learned */}
                      {(isLearned || isCustom) && (
                        <button
                          onClick={() => handleDeleteMemory(mem.id)}
                          title="Excluir esta memória"
                          className="text-amadeus-muted hover:text-red-400 transition-colors p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <p className="text-xs text-gray-300 font-sans leading-relaxed mb-3">
                      {mem.content}
                    </p>

                    <div className="flex flex-wrap items-center justify-between text-[11px] text-amadeus-muted pt-2 border-t border-amadeus-border/30 gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Tag className="w-3 h-3 text-amadeus-accent/70 shrink-0" />
                        {mem.triggerKeywords && mem.triggerKeywords.length > 0 ? (
                          mem.triggerKeywords.map((kw, i) => (
                            <span key={i} className="text-[10px] bg-black/40 px-1.5 py-0.5 rounded text-amadeus-accent/80">
                              #{kw}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-amadeus-muted/60">Sem palavras-chave específicas</span>
                        )}
                      </div>

                      {mem.emotionalWeight && (
                        <div className="text-[10px] text-amadeus-muted italic">
                          Sentimento: <span className="text-gray-300">{mem.emotionalWeight}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
