import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, serial, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const snippets = pgTable("snippets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull().default("Untitled"),
  html: text("html").notNull().default(""),
  css: text("css").notNull().default(""),
  js: text("js").notNull().default(""),
  mode: text("mode").notNull().default("html"),
});

export const customActions = pgTable("custom_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  prompt: text("prompt").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertSnippetSchema = createInsertSchema(snippets).pick({
  title: true,
  html: true,
  css: true,
  js: true,
  mode: true,
});

export const ementas = pgTable("ementas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  titulo: text("titulo").notNull(),
  categoria: text("categoria").notNull().default("Geral"),
  texto: text("texto").notNull(),
});

export const insertCustomActionSchema = createInsertSchema(customActions).pick({
  label: true,
  description: true,
  prompt: true,
});

export const aiHistory = pgTable("ai_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  action: text("action").notNull(),
  inputPreview: text("input_preview").notNull().default(""),
  result: text("result").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmentaSchema = createInsertSchema(ementas).pick({
  titulo: true,
  categoria: true,
  texto: true,
});

export const insertAiHistorySchema = createInsertSchema(aiHistory).pick({
  action: true,
  inputPreview: true,
  result: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertSnippet = z.infer<typeof insertSnippetSchema>;
export type Snippet = typeof snippets.$inferSelect;
export type InsertCustomAction = z.infer<typeof insertCustomActionSchema>;
export type CustomAction = typeof customActions.$inferSelect;
export type InsertEmenta = z.infer<typeof insertEmentaSchema>;
export type Ementa = typeof ementas.$inferSelect;
export const promptTemplates = pgTable("prompt_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  titulo: text("titulo").notNull(),
  categoria: text("categoria").notNull().default("Geral"),
  texto: text("texto").notNull(),
});

export const insertPromptTemplateSchema = createInsertSchema(promptTemplates).pick({
  titulo: true,
  categoria: true,
  texto: true,
});

export const docTemplates = pgTable("doc_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  titulo: text("titulo").notNull(),
  categoria: text("categoria").notNull().default("Geral"),
  conteudo: text("conteudo").notNull(),
  docxBase64: text("docx_base64"),
  docxFilename: text("docx_filename"),
});

export const insertDocTemplateSchema = createInsertSchema(docTemplates).pick({
  titulo: true,
  categoria: true,
  conteudo: true,
  docxBase64: true,
  docxFilename: true,
});

export type InsertAiHistory = z.infer<typeof insertAiHistorySchema>;
export type AiHistory = typeof aiHistory.$inferSelect;
export type InsertPromptTemplate = z.infer<typeof insertPromptTemplateSchema>;
export type PromptTemplate = typeof promptTemplates.$inferSelect;
export const sharedPareceres = pgTable("shared_pareceres", {
  id: varchar("id").primaryKey(),
  html: text("html").notNull(),
  processo: text("processo").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const processosMonitorados = pgTable("processos_monitorados", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  numero: text("numero").notNull(),
  tribunal: text("tribunal").notNull(),
  apelido: text("apelido").notNull().default(""),
  classe: text("classe").notNull().default(""),
  orgaoJulgador: text("orgao_julgador").notNull().default(""),
  dataAjuizamento: text("data_ajuizamento").notNull().default(""),
  ultimaMovimentacao: text("ultima_movimentacao").notNull().default(""),
  ultimaMovimentacaoData: text("ultima_movimentacao_data").notNull().default(""),
  assuntos: text("assuntos").notNull().default(""),
  status: text("status").notNull().default("ativo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertProcessoMonitoradoSchema = createInsertSchema(processosMonitorados).pick({
  numero: true,
  tribunal: true,
  apelido: true,
  classe: true,
  orgaoJulgador: true,
  dataAjuizamento: true,
  ultimaMovimentacao: true,
  ultimaMovimentacaoData: true,
  assuntos: true,
  status: true,
});

export type InsertDocTemplate = z.infer<typeof insertDocTemplateSchema>;
export type DocTemplate = typeof docTemplates.$inferSelect;
export type SharedParecer = typeof sharedPareceres.$inferSelect;
export type InsertProcessoMonitorado = z.infer<typeof insertProcessoMonitoradoSchema>;
export type ProcessoMonitorado = typeof processosMonitorados.$inferSelect;

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const tramitacaoPublicacoes = pgTable("tramitacao_publicacoes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  extId: text("ext_id").notNull().unique(),
  idempotencyKey: text("idempotency_key"),
  numeroProcesso: text("numero_processo").notNull().default(""),
  numeroProcessoMascara: text("numero_processo_mascara").notNull().default(""),
  tribunal: text("tribunal").notNull().default(""),
  orgao: text("orgao").notNull().default(""),
  classe: text("classe").notNull().default(""),
  texto: text("texto").notNull().default(""),
  disponibilizacaoDate: text("disponibilizacao_date").notNull().default(""),
  publicacaoDate: text("publicacao_date").notNull().default(""),
  inicioPrazoDate: text("inicio_prazo_date").notNull().default(""),
  linkTramitacao: text("link_tramitacao").notNull().default(""),
  linkTribunal: text("link_tribunal").notNull().default(""),
  destinatarios: text("destinatarios").notNull().default("[]"),
  advogados: text("advogados").notNull().default("[]"),
  lida: text("lida").notNull().default("nao"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type TramitacaoPublicacao = typeof tramitacaoPublicacoes.$inferSelect;

// Conversation tables for chat history (Robô Jurídico and AI chat)
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull().default("Nova conversa"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).pick({
  title: true,
});

export const insertMessageSchema = createInsertSchema(messages).pick({
  conversationId: true,
  role: true,
  content: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
