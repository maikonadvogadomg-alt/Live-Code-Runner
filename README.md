# Assistente Jurídico com Robô Jurídico Integrado

Este projeto combina um assistente jurídico com um robô de monitoramento jurídico, criando uma plataforma completa para automação de tarefas jurídicas.

Desenvolvido por **Maikon da Rocha Caldeira** - Manhumirim, MG

## Robô Jurídico

O robô jurídico é uma funcionalidade integrada que automatiza o monitoramento de publicações jurídicas e a comunicação com clientes. Ele realiza as seguintes tarefas:

- Consulta automaticamente a API do DJEN/CNJ para novas publicações
- Identifica quais clientes são afetados por cada publicação
- Extrai datas importantes e prazos das publicações
- Cria rascunhos de e-mails no Gmail para notificar os clientes
- Opcionalmente, salva os documentos no Google Drive

### Como usar

1. Configure as variáveis de ambiente no arquivo `.env` (veja `.env.example`)
2. Prepare a planilha de clientes (`clientes.xlsx`)
3. Acesse a interface web e vá até a seção do Robô Jurídico
4. Verifique o status de configuração
5. Execute o robô manualmente ou agende execuções automáticas

Para mais detalhes, consulte a [documentação completa do robô jurídico](docs/robo-juridico.md).

## 📋 Sobre o Projeto

Este projeto reúne **duas funcionalidades principais** em uma única aplicação web PWA (Progressive Web App):

### 1️⃣ HTML Playground
Editor de código HTML ao vivo com visualização em tempo real.
- Cole seu código HTML, CSS e JavaScript
- Veja o resultado instantaneamente no preview
- Editor com syntax highlighting
- Suporte a múltiplas fontes e temas
- Funciona offline (PWA)

### 2️⃣ Assistente Jurídico com IA
Assistente jurídico inteligente alimentado por IA (Google Gemini).
- Consultas jurídicas em linguagem natural
- Comparador de documentos jurídicos
- Consulta processual
- Auditoria financeira
- Painel de processos
- Tramitação e filtrador jurídico
- Módulo previdenciário

---

## 🚀 Tecnologias Utilizadas

- **Frontend:** React 18 + TypeScript + Vite
- **Roteamento:** Wouter
- **UI:** Tailwind CSS + Radix UI + shadcn/ui
- **Editor de Código:** TinyMCE + TipTap
- **IA:** Google Gemini API + OpenAI
- **Backend:** Express.js (Node.js)
- **PWA:** Service Worker + Web App Manifest
- **Banco de Dados:** PostgreSQL + Drizzle ORM
- **Autenticação:** Passport.js + JWT

---

## 📦 Instalação e Execução

```bash
# Instalar dependências
npm install

# Modo desenvolvimento
npm run dev

# Build para produção
npm run build

# Iniciar em produção
npm start
```

---

## 🗂️ Estrutura do Projeto

```
├── client/
│   ├── src/
│   │   ├── pages/           # Páginas da aplicação
│   │   │   ├── playground.tsx          # HTML Playground
│   │   │   ├── legal-assistant.tsx     # Assistente Jurídico
│   │   │   ├── comparador-juridico.tsx # Comparador de documentos
│   │   │   ├── consulta-processual.tsx # Consulta processual
│   │   │   ├── auditoria-financeira.tsx
│   │   │   ├── painel-processos.tsx
│   │   │   ├── tramitacao.tsx
│   │   │   ├── filtrador.tsx
│   │   │   └── previdenciario.tsx
│   │   ├── components/      # Componentes reutilizáveis
│   │   ├── hooks/           # Custom hooks
│   │   └── lib/             # Utilitários
│   └── public/
│       ├── manifest.json    # PWA manifest
│       ├── sw.js            # Service Worker
│       └── tinymce/         # Editor TinyMCE local
├── server/                  # Backend Express
├── shared/                  # Tipos e schemas compartilhados
└── package.json
```

---

## 🌐 Rotas da Aplicação

| Rota | Funcionalidade |
|------|---------------|
| `/` | Assistente Jurídico (página inicial) |
| `/playground` | HTML Playground |
| `/comparador` | Comparador Jurídico |
| `/consulta` | Consulta Processual |
| `/auditoria` | Auditoria Financeira |
| `/painel` | Painel de Processos |
| `/tramitacao` | Tramitação |
| `/filtrador` | Filtrador Jurídico |
| `/previdenciario` | Módulo Previdenciário |
| `/token` | Gerador de Token |

---

## 📱 PWA (Progressive Web App)

O projeto funciona como PWA instalável em dispositivos móveis e desktop:
- ✅ Funciona offline (Service Worker)
- ✅ Instalável na tela inicial
- ✅ Ícones personalizados (192x192 e 512x512)
- ✅ Tema de cor configurado (`#6366f1`)

---

## ✍️ Autor

**Maikon da Rocha Caldeira**  
Manhumirim - MG, Brasil

---

## 📄 Licença

MIT
