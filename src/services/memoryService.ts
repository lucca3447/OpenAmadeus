import { MemoryItem, PersonaProfile, ChatMessage, CallSession, MemorySource } from '../types/amadeus';
import { KURISU_PERSONA } from '../data/personas/kurisu';

const STORAGE_CUSTOM_MEMORIES = 'amadeus_custom_memories_';
const STORAGE_CUSTOM_PERSONAS = 'amadeus_custom_personas';
const STORAGE_ACTIVE_SESSION = 'amadeus_active_session';
const STORAGE_SESSIONS_LOG = 'amadeus_sessions_log';

// Common Portuguese stop words to ignore when scoring relevance
const STOP_WORDS = new Set([
  'a', 'ao', 'aos', 'aquela', 'aquelas', 'aquele', 'aqueles', 'aquilo', 'as', 'até',
  'com', 'como', 'da', 'das', 'de', 'dela', 'delas', 'dele', 'deles', 'depois',
  'do', 'dos', 'e', 'ela', 'elas', 'ele', 'eles', 'em', 'entre', 'era', 'eram',
  'essa', 'essas', 'esse', 'esses', 'esta', 'estas', 'este', 'estes', 'eu', 'foi',
  'fomos', 'foram', 'isso', 'isto', 'já', 'lhe', 'lhes', 'mais', 'mas', 'me', 'mesmo',
  'meu', 'meus', 'minha', 'minhas', 'muito', 'na', 'nas', 'não', 'no', 'nos', 'nossa',
  'nossas', 'nosso', 'nossos', 'num', 'numa', 'o', 'os', 'ou', 'para', 'pela', 'pelas',
  'pelo', 'pelos', 'por', 'qual', 'quando', 'que', 'quem', 'se', 'seja', 'sejam', 'sem',
  'ser', 'será', 'serão', 'seu', 'seus', 'só', 'somos', 'sou', 'sua', 'suas', 'também',
  'te', 'tem', 'temos', 'têm', 'tenho', 'ter', 'teu', 'teus', 'tinha', 'tinham', 'toda',
  'todas', 'todo', 'todos', 'tu', 'tua', 'tuas', 'um', 'uma', 'umas', 'uns', 'você',
  'vocês', 'vos'
]);

/**
 * Normalizes string by stripping diacritics, punctuation and normalizing whitespace
 */
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .toLowerCase()
    .replace(/[^\w\s]/gi, ' ') // remove punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

export class MemoryService {
  /**
   * Retrieves the active persona, merging canonical memories with locally stored updates
   */
  static getPersona(personaId = 'kurisu'): PersonaProfile {
    if (personaId === 'kurisu') {
      const storedMemories = localStorage.getItem(`${STORAGE_CUSTOM_MEMORIES}kurisu`);
      if (storedMemories) {
        try {
          const parsed: MemoryItem[] = JSON.parse(storedMemories);
          return {
            ...KURISU_PERSONA,
            memories: [...KURISU_PERSONA.memories, ...parsed],
          };
        } catch (e) {
          console.error('Failed to parse stored memories:', e);
        }
      }
      return KURISU_PERSONA;
    }

    // Check custom personas
    const storedPersonas = localStorage.getItem(STORAGE_CUSTOM_PERSONAS);
    if (storedPersonas) {
      try {
        const personas: PersonaProfile[] = JSON.parse(storedPersonas);
        const found = personas.find((p) => p.id === personaId);
        if (found) return found;
      } catch (e) {
        console.error('Failed to parse custom personas:', e);
      }
    }

    return KURISU_PERSONA;
  }

  /**
   * Enhanced RAG Matcher with diacritics normalization, stop-words filter and token scoring
   */
  static matchMemories(userMessage: string, persona: PersonaProfile): MemoryItem[] {
    const rawTokens = normalizeText(userMessage).split(/\s+/).filter(Boolean);
    const meaningfulTokens = rawTokens.filter((t) => t.length > 2 && !STOP_WORDS.has(t));
    const normalizedMessage = normalizeText(userMessage);

    const scored: { memory: MemoryItem; score: number }[] = [];

    persona.memories.forEach((mem) => {
      let score = 0;

      // 1. Exact match in keywords (high weight)
      mem.triggerKeywords.forEach((kw) => {
        const normKw = normalizeText(kw);
        if (normKw && normalizedMessage.includes(normKw)) {
          score += 4.5;
        }
      });

      // 2. Meaningful token match in title
      const titleTokens = normalizeText(mem.title).split(/\s+/).filter((t) => t.length > 2 && !STOP_WORDS.has(t));
      meaningfulTokens.forEach((ut) => {
        if (titleTokens.includes(ut)) {
          score += 2.5;
        }
      });

      // 3. Meaningful token match in content
      const contentNorm = normalizeText(mem.content);
      meaningfulTokens.forEach((ut) => {
        if (contentNorm.includes(ut)) {
          score += 1.0;
        }
      });

      // 4. Boost learned facts about the user so Kurisu references them promptly
      if (mem.source === 'learned') {
        score += 1.5;
      }

      if (score > 1.2) {
        scored.push({ memory: mem, score });
      }
    });

    // Sort descending by relevance score and pick top 4
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 4).map((item) => item.memory);
  }

  /**
   * Adds a newly digitized or learned memory to a persona
   */
  static addMemory(
    personaId: string,
    memory: Omit<MemoryItem, 'id'> & { source?: MemorySource }
  ): MemoryItem {
    const source = memory.source || 'custom';
    const newMemory: MemoryItem = {
      ...memory,
      id: `mem_${source}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      source,
      createdAt: Date.now(),
    };

    const key = `${STORAGE_CUSTOM_MEMORIES}${personaId}`;
    const existing = localStorage.getItem(key);
    let list: MemoryItem[] = [];
    if (existing) {
      try {
        list = JSON.parse(existing);
      } catch {
        list = [];
      }
    }
    list.push(newMemory);
    localStorage.setItem(key, JSON.stringify(list));

    return newMemory;
  }

  /**
   * Deletes a custom or learned memory
   */
  static deleteMemory(personaId: string, memoryId: string): boolean {
    const key = `${STORAGE_CUSTOM_MEMORIES}${personaId}`;
    const existing = localStorage.getItem(key);
    if (!existing) return false;

    try {
      const list: MemoryItem[] = JSON.parse(existing);
      const filtered = list.filter((m) => m.id !== memoryId);
      localStorage.setItem(key, JSON.stringify(filtered));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clears all learned memories for a persona
   */
  static clearLearnedMemories(personaId: string): void {
    const key = `${STORAGE_CUSTOM_MEMORIES}${personaId}`;
    const existing = localStorage.getItem(key);
    if (!existing) return;

    try {
      const list: MemoryItem[] = JSON.parse(existing);
      const kept = list.filter((m) => m.source !== 'learned');
      localStorage.setItem(key, JSON.stringify(kept));
    } catch (e) {
      console.error(e);
    }
  }

  /**
   * Auto-extracts memory from tags like <!--remember:Title|Content|Emotion--> or heuristic
   */
  static extractAndSaveLearnedMemory(personaId: string, rawText: string): MemoryItem | null {
    const match = rawText.match(/<!--remember:(.*?)\|(.*?)\|(.*?)-->/i);
    if (match) {
      const title = match[1].trim();
      const content = match[2].trim();
      const emotionalWeight = match[3].trim() || 'Factual';

      if (title && content) {
        return this.addMemory(personaId, {
          category: 'user',
          title,
          triggerKeywords: [title.toLowerCase()],
          content,
          emotionalWeight,
          source: 'learned',
        });
      }
    }
    return null;
  }

  // --- Session Management (LocalStorage) ---

  static getActiveSession(): { sessionId: string; messages: ChatMessage[] } {
    const stored = localStorage.getItem(STORAGE_ACTIVE_SESSION);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed.sessionId && Array.isArray(parsed.messages)) {
          return parsed;
        }
      } catch (e) {
        console.error(e);
      }
    }
    const newSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const initial = { sessionId: newSessionId, messages: [] };
    localStorage.setItem(STORAGE_ACTIVE_SESSION, JSON.stringify(initial));
    return initial;
  }

  static saveActiveSession(sessionId: string, messages: ChatMessage[]): void {
    localStorage.setItem(
      STORAGE_ACTIVE_SESSION,
      JSON.stringify({ sessionId, messages })
    );

    // Keep sessions log synchronized in real-time so ongoing chats show in the sidebar immediately
    if (messages.length > 0) {
      const logs = this.getSessionLogs();
      const existingIdx = logs.findIndex((s) => s.id === sessionId);

      // Intelligent title: extract first real user message or fallback to clean description
      const userMsg = messages.find((m) => m.sender === 'user');
      const summary = userMsg
        ? (userMsg.content.length > 55 ? userMsg.content.slice(0, 55) + '...' : userMsg.content)
        : (messages[0]?.content.slice(0, 50) || 'Nova conversa com Kurisu');

      const sessionItem: CallSession = {
        id: sessionId,
        startedAt: existingIdx >= 0 ? logs[existingIdx].startedAt : (messages[0]?.timestamp || Date.now()),
        endedAt: Date.now(),
        summary,
        messageCount: messages.length,
        messages,
      };

      if (existingIdx >= 0) {
        logs.splice(existingIdx, 1);
      }
      logs.unshift(sessionItem);

      // Keep up to 30 past sessions
      localStorage.setItem(STORAGE_SESSIONS_LOG, JSON.stringify(logs.slice(0, 30)));
    }
  }

  static archiveAndStartNewSession(currentMessages: ChatMessage[]): string {
    const active = this.getActiveSession();
    if (currentMessages.length > 0) {
      this.saveActiveSession(active.sessionId, currentMessages);
    }

    const newId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    localStorage.setItem(
      STORAGE_ACTIVE_SESSION,
      JSON.stringify({ sessionId: newId, messages: [] })
    );
    return newId;
  }

  static getSessionLogs(): CallSession[] {
    const raw = localStorage.getItem(STORAGE_SESSIONS_LOG);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  static loadSession(sessionId: string): ChatMessage[] | null {
    const logs = this.getSessionLogs();
    const found = logs.find((s) => s.id === sessionId);
    if (found && found.messages && found.messages.length > 0) {
      localStorage.setItem(
        STORAGE_ACTIVE_SESSION,
        JSON.stringify({ sessionId: found.id, messages: found.messages })
      );
      return found.messages;
    }
    return null;
  }

  static deleteSession(sessionId: string): void {
    const logs = this.getSessionLogs().filter((s) => s.id !== sessionId);
    localStorage.setItem(STORAGE_SESSIONS_LOG, JSON.stringify(logs));
  }

  // --- Export / Import ---

  static exportMemoriesJSON(personaId: string): string {
    const persona = this.getPersona(personaId);
    return JSON.stringify(persona.memories, null, 2);
  }

  static importMemoriesJSON(personaId: string, jsonString: string): { success: boolean; count: number } {
    try {
      const parsed: MemoryItem[] = JSON.parse(jsonString);
      if (!Array.isArray(parsed)) return { success: false, count: 0 };

      // Filter only custom/learned items (canonical are protected)
      const importedCustom = parsed.filter((m) => m.source !== 'canonical');
      const key = `${STORAGE_CUSTOM_MEMORIES}${personaId}`;
      localStorage.setItem(key, JSON.stringify(importedCustom));

      return { success: true, count: importedCustom.length };
    } catch (e) {
      console.error('Import error:', e);
      return { success: false, count: 0 };
    }
  }
}
