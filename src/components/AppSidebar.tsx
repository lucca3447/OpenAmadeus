import React, { useState } from 'react';
import {
  Plus,
  Search,
  MessageSquare,
  Trash2,
  Brain,
  Sliders,
  ChevronLeft,
  Database,
} from 'lucide-react';
import { CallSession } from '../types/amadeus';
import { BackendHealth } from '../services/backendService';

interface AppSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: CallSession[];
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenMemory: () => void;
  onOpenSettings: () => void;
  backendHealth?: BackendHealth | null;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onOpenMemory,
  onOpenSettings,
  backendHealth,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSessions = sessions.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (s.summary || '').toLowerCase().includes(q) || s.id.toLowerCase().includes(q);
  });

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    }
    return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
  };

  if (!isOpen) return null;

  return (
    <aside className="w-72 border-r border-orange-500/30 chalkboard-grid bg-[#0a090b]/95 backdrop-blur-md flex flex-col justify-between shrink-0 font-mono text-xs select-none z-20 transition-all duration-300 relative">
      {/* Subtle Top Radial Copper Glow */}
      <div className="absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_50%_0%,rgba(249,115,22,0.12),transparent_70%)] pointer-events-none" />

      {/* Top Header & Actions */}
      <div className="relative z-10 p-3.5 border-b border-amber-900/40 bg-black/50 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-400 shadow-[0_0_8px_#fb923c]" />
              <span className="engraved-serif font-bold text-amber-100 tracking-widest text-xs">
                REGISTROS DE SESSÃO
              </span>
            </div>
            <div className="bus-line-horizontal w-full mt-1" />
          </div>
          <button
            onClick={onClose}
            title="Recolher Barra Lateral (Ctrl+B)"
            className="w-7 h-7 rounded-full border border-amber-900/60 bg-black/70 flex items-center justify-center text-zinc-400 hover:text-amber-200 hover:border-orange-400 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {/* New Session Copper PCB Capsule */}
        <button
          onClick={onNewSession}
          className="copper-capsule w-full py-2 px-3.5 text-amber-100 hover:text-white font-bold text-xs flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4 text-orange-400" />
          <span className="engraved-serif tracking-widest text-[11px]">NOVA SESSÃO NEURAL</span>
        </button>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-orange-400/70 absolute left-3 top-2.5 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrar registros..."
            className="w-full bg-black/85 border border-amber-900/60 focus:border-orange-400 rounded-full pl-8 pr-3 py-1.5 text-xs text-amber-100 placeholder-zinc-500 focus:outline-none transition-colors font-sans shadow-inner"
          />
        </div>
      </div>

      {/* Sessions List with Vertical Conductor Bus Line */}
      <div className="relative flex-1 overflow-y-auto p-3 space-y-2 z-10">
        {filteredSessions.length > 0 && (
          <div className="absolute left-6 top-4 bottom-4 bus-line-vertical opacity-60 pointer-events-none" />
        )}

        {filteredSessions.length === 0 ? (
          <div className="py-12 px-4 text-center text-zinc-500 text-[11px] space-y-1 border border-dashed border-amber-900/30 bg-black/30">
            <p className="engraved-serif text-zinc-400 font-bold">NENHUM REGISTRO</p>
            <p className="text-[10px] text-zinc-500 font-sans">
              Os diálogos arquivados no barramento aparecerão aqui.
            </p>
          </div>
        ) : (
          filteredSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`relative group pl-6 pr-2.5 py-2.5 border cursor-pointer transition-all flex items-center justify-between ${
                  isActive
                    ? 'bg-gradient-to-r from-orange-950/50 via-[#16110d] to-black/90 border-orange-400/80 text-amber-100 shadow-[0_0_16px_rgba(249,115,22,0.2)]'
                    : 'bg-black/65 border-amber-900/35 text-zinc-400 hover:bg-[#14100d] hover:text-amber-100 hover:border-orange-500/50'
                }`}
              >
                {/* Solder Pin Node on the Vertical Bus Line */}
                <span
                  className={`absolute left-2.5 w-2 h-2 rounded-full transition-all ${
                    isActive
                      ? 'bg-orange-400 shadow-[0_0_8px_#fb923c] scale-125'
                      : 'bg-amber-900/80 group-hover:bg-orange-400/70'
                  }`}
                />

                <div className="flex items-center gap-2 overflow-hidden pr-1">
                  <MessageSquare
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? 'text-orange-400' : 'text-zinc-600 group-hover:text-orange-400/70'
                    }`}
                  />
                  <div className="overflow-hidden">
                    <p className="truncate text-xs font-sans font-medium">
                      {session.summary || 'Diálogo Neural OpenAmadeus'}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-0.5 font-mono">
                      <span className={isActive ? 'text-amber-300/80' : ''}>
                        {formatDate(session.endedAt || session.startedAt)}
                      </span>
                      <span>•</span>
                      <span>{session.messageCount} blocos</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('Deseja excluir este registro de sessão?')) {
                      onDeleteSession(session.id);
                    }
                  }}
                  title="Excluir Registro"
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-950/60 hover:text-rose-400 transition-all text-zinc-500"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Workbench Shortcuts & Telemetry Plate */}
      <div className="relative z-10 p-3.5 border-t border-amber-900/40 space-y-2 bg-black/80">
        <button
          onClick={onOpenMemory}
          className="copper-capsule w-full flex items-center gap-2.5 px-3.5 py-2 text-amber-200 hover:text-white"
        >
          <Brain className="w-4 h-4 text-sky-400 shrink-0" />
          <span className="engraved-serif font-bold text-[11px] tracking-widest">
            CÓRTEX & MEMÓRIAS
          </span>
        </button>

        <button
          onClick={onOpenSettings}
          className="copper-capsule w-full flex items-center gap-2.5 px-3.5 py-2 text-amber-200 hover:text-white"
        >
          <Sliders className="w-4 h-4 text-orange-400 shrink-0" />
          <span className="engraved-serif font-bold text-[11px] tracking-widest">
            SETUP MENU
          </span>
        </button>

        <div className="pt-2 border-t border-amber-900/30 flex items-center justify-between text-[10px] text-zinc-400 px-1 font-mono">
          <span className="flex items-center gap-1.5">
            <Database className="w-3 h-3 text-orange-400" />
            <span>{backendHealth ? `CHROMA (${backendHealth.chromaCount})` : 'LOCAL STORAGE'}</span>
          </span>
          <span className="engraved-serif text-[9px] text-orange-400/90 tracking-widest font-bold">
            OPENAMADEUS
          </span>
        </div>
      </div>
    </aside>
  );
};
