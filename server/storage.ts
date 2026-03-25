import { type User, type InsertUser, type Snippet, type InsertSnippet, type CustomAction, type InsertCustomAction, type Ementa, type InsertEmenta, type AiHistory, type InsertAiHistory, type PromptTemplate, type InsertPromptTemplate, type DocTemplate, type InsertDocTemplate, type SharedParecer, type ProcessoMonitorado, type InsertProcessoMonitorado, type AppSetting, type TramitacaoPublicacao, type Conversation, type Message, users, snippets, customActions, ementas, aiHistory, promptTemplates, docTemplates, sharedPareceres, processosMonitorados, appSettings, tramitacaoPublicacoes, conversations, messages } from "@shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, desc } from "drizzle-orm";
import pg from "pg";
import { randomUUID } from "crypto";

// 🔒 Detecta conexão Neon ou qualquer host com sslmode=require
const requireSsl =
  process.env.DATABASE_URL?.includes("neon.tech") ||
  process.env.DATABASE_URL?.includes("sslmode=require");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // SSL obrigatório para Neon PostgreSQL (serverless)
  ssl: requireSsl ? { rejectUnauthorized: true } : false,
});

export const db = drizzle(pool);

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getSnippets(): Promise<Snippet[]>;
  getSnippet(id: string): Promise<Snippet | undefined>;
  createSnippet(snippet: InsertSnippet): Promise<Snippet>;
  updateSnippet(id: string, data: Partial<InsertSnippet>): Promise<Snippet | undefined>;
  updateSnippetTitle(id: string, title: string): Promise<Snippet | undefined>;
  deleteSnippet(id: string): Promise<void>;
  getCustomActions(): Promise<CustomAction[]>;
  getCustomAction(id: string): Promise<CustomAction | undefined>;
  createCustomAction(action: InsertCustomAction): Promise<CustomAction>;
  updateCustomAction(id: string, action: InsertCustomAction): Promise<CustomAction | undefined>;
  deleteCustomAction(id: string): Promise<void>;
  getEmentas(): Promise<Ementa[]>;
  getEmenta(id: string): Promise<Ementa | undefined>;
  createEmenta(ementa: InsertEmenta): Promise<Ementa>;
  updateEmenta(id: string, ementa: InsertEmenta): Promise<Ementa | undefined>;
  deleteEmenta(id: string): Promise<void>;
  getAiHistory(): Promise<AiHistory[]>;
  createAiHistory(entry: InsertAiHistory): Promise<AiHistory>;
  deleteAiHistory(id: string): Promise<void>;
  clearAiHistory(): Promise<void>;
  getPromptTemplates(): Promise<PromptTemplate[]>;
  getPromptTemplate(id: string): Promise<PromptTemplate | undefined>;
  createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate>;
  updatePromptTemplate(id: string, template: InsertPromptTemplate): Promise<PromptTemplate | undefined>;
  deletePromptTemplate(id: string): Promise<void>;
  getDocTemplates(): Promise<DocTemplate[]>;
  getDocTemplate(id: string): Promise<DocTemplate | undefined>;
  createDocTemplate(template: InsertDocTemplate): Promise<DocTemplate>;
  updateDocTemplate(id: string, template: InsertDocTemplate): Promise<DocTemplate | undefined>;
  deleteDocTemplate(id: string): Promise<void>;
  getSharedParecer(id: string): Promise<SharedParecer | undefined>;
  createSharedParecer(id: string, html: string, processo: string): Promise<SharedParecer>;
  getProcessosMonitorados(): Promise<ProcessoMonitorado[]>;
  getProcessoMonitorado(id: string): Promise<ProcessoMonitorado | undefined>;
  createProcessoMonitorado(p: InsertProcessoMonitorado): Promise<ProcessoMonitorado>;
  updateProcessoMonitorado(id: string, data: Partial<InsertProcessoMonitorado>): Promise<ProcessoMonitorado | undefined>;
  deleteProcessoMonitorado(id: string): Promise<void>;
  // Conversation methods (chat history)
  getConversations?(): Promise<any[]>;
  getConversation?(id: number): Promise<any | undefined>;
  createConversation?(title: string): Promise<any>;
  deleteConversation?(id: number): Promise<void>;
  getMessagesByConversation?(conversationId: number): Promise<any[]>;
  createMessage?(conversationId: number, role: string, content: string): Promise<any>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getSnippets(): Promise<Snippet[]> {
    return db.select().from(snippets);
  }

  async getSnippet(id: string): Promise<Snippet | undefined> {
    const [snippet] = await db.select().from(snippets).where(eq(snippets.id, id));
    return snippet;
  }

  async createSnippet(insertSnippet: InsertSnippet): Promise<Snippet> {
    const [snippet] = await db.insert(snippets).values(insertSnippet).returning();
    return snippet;
  }

  async updateSnippet(id: string, data: Partial<InsertSnippet>): Promise<Snippet | undefined> {
    const [snippet] = await db.update(snippets).set(data).where(eq(snippets.id, id)).returning();
    return snippet;
  }

  async updateSnippetTitle(id: string, title: string): Promise<Snippet | undefined> {
    const [snippet] = await db.update(snippets).set({ title }).where(eq(snippets.id, id)).returning();
    return snippet;
  }

  async deleteSnippet(id: string): Promise<void> {
    await db.delete(snippets).where(eq(snippets.id, id));
  }

  async getCustomActions(): Promise<CustomAction[]> {
    return db.select().from(customActions);
  }

  async getCustomAction(id: string): Promise<CustomAction | undefined> {
    const [action] = await db.select().from(customActions).where(eq(customActions.id, id));
    return action;
  }

  async createCustomAction(action: InsertCustomAction): Promise<CustomAction> {
    const [created] = await db.insert(customActions).values(action).returning();
    return created;
  }

  async updateCustomAction(id: string, action: InsertCustomAction): Promise<CustomAction | undefined> {
    const [updated] = await db.update(customActions).set(action).where(eq(customActions.id, id)).returning();
    return updated;
  }

  async deleteCustomAction(id: string): Promise<void> {
    await db.delete(customActions).where(eq(customActions.id, id));
  }

  async getEmentas(): Promise<Ementa[]> {
    return db.select().from(ementas);
  }

  async getEmenta(id: string): Promise<Ementa | undefined> {
    const [ementa] = await db.select().from(ementas).where(eq(ementas.id, id));
    return ementa;
  }

  async createEmenta(ementa: InsertEmenta): Promise<Ementa> {
    const [created] = await db.insert(ementas).values(ementa).returning();
    return created;
  }

  async updateEmenta(id: string, ementa: InsertEmenta): Promise<Ementa | undefined> {
    const [updated] = await db.update(ementas).set(ementa).where(eq(ementas.id, id)).returning();
    return updated;
  }

  async deleteEmenta(id: string): Promise<void> {
    await db.delete(ementas).where(eq(ementas.id, id));
  }

  async getAiHistory(): Promise<AiHistory[]> {
    return db.select().from(aiHistory).orderBy(desc(aiHistory.createdAt));
  }

  async createAiHistory(entry: InsertAiHistory): Promise<AiHistory> {
    const [created] = await db.insert(aiHistory).values(entry).returning();
    return created;
  }

  async deleteAiHistory(id: string): Promise<void> {
    await db.delete(aiHistory).where(eq(aiHistory.id, id));
  }

  async clearAiHistory(): Promise<void> {
    await db.delete(aiHistory);
  }

  async getPromptTemplates(): Promise<PromptTemplate[]> {
    return db.select().from(promptTemplates);
  }

  async getPromptTemplate(id: string): Promise<PromptTemplate | undefined> {
    const [template] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id));
    return template;
  }

  async createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate> {
    const [created] = await db.insert(promptTemplates).values(template).returning();
    return created;
  }

  async updatePromptTemplate(id: string, template: InsertPromptTemplate): Promise<PromptTemplate | undefined> {
    const [updated] = await db.update(promptTemplates).set(template).where(eq(promptTemplates.id, id)).returning();
    return updated;
  }

  async deletePromptTemplate(id: string): Promise<void> {
    await db.delete(promptTemplates).where(eq(promptTemplates.id, id));
  }

  async getDocTemplates(): Promise<DocTemplate[]> {
    return db.select().from(docTemplates);
  }

  async getDocTemplate(id: string): Promise<DocTemplate | undefined> {
    const [template] = await db.select().from(docTemplates).where(eq(docTemplates.id, id));
    return template;
  }

  async createDocTemplate(template: InsertDocTemplate): Promise<DocTemplate> {
    const [created] = await db.insert(docTemplates).values(template).returning();
    return created;
  }

  async updateDocTemplate(id: string, template: InsertDocTemplate): Promise<DocTemplate | undefined> {
    const [updated] = await db.update(docTemplates).set(template).where(eq(docTemplates.id, id)).returning();
    return updated;
  }

  async deleteDocTemplate(id: string): Promise<void> {
    await db.delete(docTemplates).where(eq(docTemplates.id, id));
  }

  async getSharedParecer(id: string): Promise<SharedParecer | undefined> {
    const [parecer] = await db.select().from(sharedPareceres).where(eq(sharedPareceres.id, id));
    return parecer;
  }

  async createSharedParecer(id: string, html: string, processo: string): Promise<SharedParecer> {
    const [created] = await db.insert(sharedPareceres).values({ id, html, processo }).returning();
    return created;
  }

  async getProcessosMonitorados(): Promise<ProcessoMonitorado[]> {
    return db.select().from(processosMonitorados).orderBy(desc(processosMonitorados.updatedAt));
  }

  async getProcessoMonitorado(id: string): Promise<ProcessoMonitorado | undefined> {
    const [p] = await db.select().from(processosMonitorados).where(eq(processosMonitorados.id, id));
    return p;
  }

  async createProcessoMonitorado(p: InsertProcessoMonitorado): Promise<ProcessoMonitorado> {
    const [created] = await db.insert(processosMonitorados).values(p).returning();
    return created;
  }

  async updateProcessoMonitorado(id: string, data: Partial<InsertProcessoMonitorado>): Promise<ProcessoMonitorado | undefined> {
    const [updated] = await db.update(processosMonitorados).set({ ...data, updatedAt: new Date() }).where(eq(processosMonitorados.id, id)).returning();
    return updated;
  }

  async deleteProcessoMonitorado(id: string): Promise<void> {
    await db.delete(processosMonitorados).where(eq(processosMonitorados.id, id));
  }

  async getSetting(key: string): Promise<string | null> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
  }

  async getTramitacaoPublicacoes(limit = 100): Promise<TramitacaoPublicacao[]> {
    return db.select().from(tramitacaoPublicacoes).orderBy(desc(tramitacaoPublicacoes.createdAt)).limit(limit);
  }

  async upsertTramitacaoPublicacao(data: {
    extId: string;
    idempotencyKey?: string;
    numeroProcesso: string;
    numeroProcessoMascara: string;
    tribunal: string;
    orgao: string;
    classe: string;
    texto: string;
    disponibilizacaoDate: string;
    publicacaoDate: string;
    inicioPrazoDate: string;
    linkTramitacao: string;
    linkTribunal: string;
    destinatarios: string;
    advogados: string;
  }): Promise<TramitacaoPublicacao> {
    const [created] = await db.insert(tramitacaoPublicacoes).values(data).onConflictDoNothing().returning();
    if (created) return created;
    const [existing] = await db.select().from(tramitacaoPublicacoes).where(eq(tramitacaoPublicacoes.extId, data.extId));
    return existing;
  }

  async markPublicacaoLida(id: string, lida: string): Promise<void> {
    await db.update(tramitacaoPublicacoes).set({ lida }).where(eq(tramitacaoPublicacoes.id, id));
  }
}

// ── MemoryStorage: fallback quando DATABASE_URL não está configurado ──────────
export class MemoryStorage implements IStorage {
  private _users: Map<string, User> = new Map();
  private _snippets: Map<string, Snippet> = new Map();
  private _customActions: Map<string, CustomAction> = new Map();
  private _ementas: Map<string, Ementa> = new Map();
  private _aiHistory: AiHistory[] = [];
  private _promptTemplates: Map<string, PromptTemplate> = new Map();
  private _docTemplates: Map<string, DocTemplate> = new Map();
  private _sharedPareceres: Map<string, SharedParecer> = new Map();
  private _processos: Map<string, ProcessoMonitorado> = new Map();

  async getUser(id: string) { return this._users.get(id); }
  async getUserByUsername(username: string) {
    return [...this._users.values()].find((u) => u.username === username);
  }
  async createUser(u: InsertUser): Promise<User> {
    const user: User = { id: randomUUID(), ...u };
    this._users.set(user.id, user);
    return user;
  }

  async getSnippets() { return [...this._snippets.values()]; }
  async getSnippet(id: string) { return this._snippets.get(id); }
  async createSnippet(s: InsertSnippet): Promise<Snippet> {
    const snippet: Snippet = { id: randomUUID(), title: "Untitled", html: "", css: "", js: "", mode: "html", ...s };
    this._snippets.set(snippet.id, snippet);
    return snippet;
  }
  async updateSnippet(id: string, data: Partial<InsertSnippet>): Promise<Snippet | undefined> {
    const existing = this._snippets.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this._snippets.set(id, updated);
    return updated;
  }
  async updateSnippetTitle(id: string, title: string): Promise<Snippet | undefined> {
    return this.updateSnippet(id, { title });
  }
  async deleteSnippet(id: string) { this._snippets.delete(id); }

  async getCustomActions() { return [...this._customActions.values()]; }
  async getCustomAction(id: string) { return this._customActions.get(id); }
  async createCustomAction(a: InsertCustomAction): Promise<CustomAction> {
    const action: CustomAction = { id: randomUUID(), description: "", ...a };
    this._customActions.set(action.id, action);
    return action;
  }
  async updateCustomAction(id: string, a: InsertCustomAction): Promise<CustomAction | undefined> {
    const existing = this._customActions.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...a };
    this._customActions.set(id, updated);
    return updated;
  }
  async deleteCustomAction(id: string) { this._customActions.delete(id); }

  async getEmentas() { return [...this._ementas.values()]; }
  async getEmenta(id: string) { return this._ementas.get(id); }
  async createEmenta(e: InsertEmenta): Promise<Ementa> {
    const ementa: Ementa = { id: randomUUID(), categoria: "Geral", ...e };
    this._ementas.set(ementa.id, ementa);
    return ementa;
  }
  async updateEmenta(id: string, e: InsertEmenta): Promise<Ementa | undefined> {
    const existing = this._ementas.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...e };
    this._ementas.set(id, updated);
    return updated;
  }
  async deleteEmenta(id: string) { this._ementas.delete(id); }

  async getAiHistory() { return [...this._aiHistory].reverse(); }
  async createAiHistory(entry: InsertAiHistory): Promise<AiHistory> {
    const h: AiHistory = { id: randomUUID(), inputPreview: "", createdAt: new Date(), ...entry };
    this._aiHistory.push(h);
    return h;
  }
  async deleteAiHistory(id: string) {
    this._aiHistory = this._aiHistory.filter((h) => h.id !== id);
  }
  async clearAiHistory() { this._aiHistory = []; }

  async getPromptTemplates() { return [...this._promptTemplates.values()]; }
  async getPromptTemplate(id: string) { return this._promptTemplates.get(id); }
  async createPromptTemplate(t: InsertPromptTemplate): Promise<PromptTemplate> {
    const template: PromptTemplate = { id: randomUUID(), categoria: "Geral", ...t };
    this._promptTemplates.set(template.id, template);
    return template;
  }
  async updatePromptTemplate(id: string, t: InsertPromptTemplate): Promise<PromptTemplate | undefined> {
    const existing = this._promptTemplates.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...t };
    this._promptTemplates.set(id, updated);
    return updated;
  }
  async deletePromptTemplate(id: string) { this._promptTemplates.delete(id); }

  async getDocTemplates() { return [...this._docTemplates.values()]; }
  async getDocTemplate(id: string) { return this._docTemplates.get(id); }
  async createDocTemplate(t: InsertDocTemplate): Promise<DocTemplate> {
    const template: DocTemplate = { id: randomUUID(), categoria: "Geral", docxBase64: null, docxFilename: null, ...t };
    this._docTemplates.set(template.id, template);
    return template;
  }
  async updateDocTemplate(id: string, t: InsertDocTemplate): Promise<DocTemplate | undefined> {
    const existing = this._docTemplates.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...t };
    this._docTemplates.set(id, updated);
    return updated;
  }
  async deleteDocTemplate(id: string) { this._docTemplates.delete(id); }

  async getSharedParecer(id: string) { return this._sharedPareceres.get(id); }
  async createSharedParecer(id: string, html: string, processo: string): Promise<SharedParecer> {
    const parecer: SharedParecer = { id, html, processo, createdAt: new Date() };
    this._sharedPareceres.set(id, parecer);
    return parecer;
  }

  async getProcessosMonitorados() { return [...this._processos.values()]; }
  async getProcessoMonitorado(id: string) { return this._processos.get(id); }
  async createProcessoMonitorado(p: InsertProcessoMonitorado): Promise<ProcessoMonitorado> {
    const processo: ProcessoMonitorado = {
      id: randomUUID(),
      apelido: "",
      classe: "",
      orgaoJulgador: "",
      dataAjuizamento: "",
      ultimaMovimentacao: "",
      ultimaMovimentacaoData: "",
      assuntos: "",
      status: "ativo",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...p,
    };
    this._processos.set(processo.id, processo);
    return processo;
  }
  async updateProcessoMonitorado(id: string, data: Partial<InsertProcessoMonitorado>): Promise<ProcessoMonitorado | undefined> {
    const existing = this._processos.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this._processos.set(id, updated);
    return updated;
  }
  async deleteProcessoMonitorado(id: string) { this._processos.delete(id); }
}

// Exporta a instância correta conforme DATABASE_URL
let _storage: IStorage;
if (process.env.DATABASE_URL) {
  _storage = new DatabaseStorage();
} else {
  console.warn(
    "⚠️  [SEM BANCO] DATABASE_URL não configurada — usando armazenamento em memória.\n" +
    "    Os dados serão perdidos ao reiniciar o servidor.\n" +
    "    Configure DATABASE_URL para persistência permanente."
  );
  _storage = new MemoryStorage();
}

export const storage: IStorage = _storage;

// ── ConversationStorage: métodos de persistência de chat ─────────────────────
export class ConversationDatabaseStorage {
  async getConversations(): Promise<Conversation[]> {
    return db.select().from(conversations).orderBy(desc(conversations.updatedAt));
  }

  async getConversation(id: number): Promise<Conversation | undefined> {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conv;
  }

  async createConversation(title: string): Promise<Conversation> {
    const [conv] = await db.insert(conversations).values({ title }).returning();
    return conv;
  }

  async deleteConversation(id: number): Promise<void> {
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));
  }

  async getMessagesByConversation(conversationId: number): Promise<Message[]> {
    return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
  }

  async createMessage(conversationId: number, role: string, content: string): Promise<Message> {
    const [msg] = await db.insert(messages).values({ conversationId, role, content }).returning();
    // Update conversation updatedAt
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
    return msg;
  }
}

export class ConversationMemoryStorage {
  private _conversations: Map<number, Conversation> = new Map();
  private _messages: Message[] = [];
  private _nextConvId = 1;
  private _nextMsgId = 1;

  async getConversations(): Promise<Conversation[]> {
    return [...this._conversations.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async getConversation(id: number): Promise<Conversation | undefined> {
    return this._conversations.get(id);
  }

  async createConversation(title: string): Promise<Conversation> {
    const conv: Conversation = { id: this._nextConvId++, title, createdAt: new Date(), updatedAt: new Date() };
    this._conversations.set(conv.id, conv);
    return conv;
  }

  async deleteConversation(id: number): Promise<void> {
    this._conversations.delete(id);
    this._messages = this._messages.filter((m) => m.conversationId !== id);
  }

  async getMessagesByConversation(conversationId: number): Promise<Message[]> {
    return this._messages.filter((m) => m.conversationId === conversationId);
  }

  async createMessage(conversationId: number, role: string, content: string): Promise<Message> {
    const msg: Message = { id: this._nextMsgId++, conversationId, role, content, createdAt: new Date() };
    this._messages.push(msg);
    const conv = this._conversations.get(conversationId);
    if (conv) this._conversations.set(conversationId, { ...conv, updatedAt: new Date() });
    return msg;
  }
}

// Extende o storage principal com capacidade de conversas
const _convStorage = process.env.DATABASE_URL
  ? new ConversationDatabaseStorage()
  : new ConversationMemoryStorage();

// Mescla os métodos de conversa no storage exportado
Object.assign(_storage, {
  getConversations: _convStorage.getConversations.bind(_convStorage),
  getConversation: _convStorage.getConversation.bind(_convStorage),
  createConversation: _convStorage.createConversation.bind(_convStorage),
  deleteConversation: _convStorage.deleteConversation.bind(_convStorage),
  getMessagesByConversation: _convStorage.getMessagesByConversation.bind(_convStorage),
  createMessage: _convStorage.createMessage.bind(_convStorage),
});
