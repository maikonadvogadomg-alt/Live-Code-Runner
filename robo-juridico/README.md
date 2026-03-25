# 🤖 Robô de Monitoramento Jurídico

> Automação completa para advocacia: monitora o DJEN, extrai prazos,
> identifica clientes e cria rascunhos de e-mail prontos para envio.

**Advogado:** Maikon da Rocha Caldeira — OAB/RS

---

## 🚀 Funcionalidades

| # | Módulo | O que faz |
|---|--------|-----------|
| 1 | `api_djen.py` | Consulta a API do DJEN/CNJ (`/comunicacao`) com paginação automática |
| 2 | `regex_parser.py` | Extrai datas de início/fim de sessões virtuais e calcula o prazo de Sustentação Oral (48h) |
| 3 | `excel_manager.py` | Lê `clientes.xlsx` e identifica o dono do processo |
| 4 | `email_draft.py` | Cria rascunho de e-mail no Gmail via IMAP (sem enviar — você revisa antes) |
| 5 | `drive_manager.py` | (Opcional) Baixa PDF do tribunal e envia direto ao Google Drive |

---

## 🛠 Pré-requisitos

- **Python 3.10+**
- **Node.js 18+** (para gerar tokens JWT com `jwt-tools`)
- Conta Gmail com **Senha de Aplicativo** ativada (não use a senha normal)

---

## 📦 Instalação

```bash
# 1. Acesse a pasta
cd robo-juridico

# 2. Crie ambiente virtual
python -m venv venv

# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

# 3. Instale dependências
pip install -r requirements.txt

# 4. (Opcional) Se usar Google Drive
pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib
```

---

## ⚙️ Configuração

### 1. Arquivo `.env`

Copie o exemplo e preencha os valores:

```bash
cp .env.example .env
```

| Variável | Descrição |
|----------|-----------|
| `EMAIL_LOGIN` | Seu endereço Gmail |
| `SENHA_APP` | Senha de Aplicativo do Google (4 grupos de 4 letras) |
| `PASTA_DRAFTS` | `[Gmail]/Rascunhos` (PT) ou `[Gmail]/Drafts` (EN) |
| `ARQUIVO_CLIENTES` | Caminho da planilha Excel (padrão: `clientes.xlsx`) |
| `DJEN_TOKEN` | Token JWT gerado com `jwt-tools` |
| `SALVAR_NO_DRIVE` | `true` para ativar upload de PDFs |
| `PASTA_DRIVE_ID` | ID da pasta do Google Drive (opcional) |

### 2. Planilha de Clientes (`clientes.xlsx`)

Crie a planilha com estas colunas (**linha 1 = cabeçalho**):

| processo | nome_completo | email | tratamento | nome_caso |
|----------|---------------|-------|------------|-----------|
| 6002755-35.2024.4.06.3819 | Maria do Carmo Silva | maria@email.com | Prezada Maria | Aposentadoria |

> ⚠️ Formate a coluna `processo` como **Texto** no Excel para evitar perda de zeros.

### 3. Token JWT para o DJEN

```bash
cd jwt-tools
npm install

node gen_pjud.js \
  --key  "caminho/chave_privada.pem" \
  --sub  "09494128648" \
  --iss  "https://seu-issuer.pdpj.jus.br" \
  --aud  "https://gateway.stg.cloud.pje.jus.br" \
  --name "Maikon da Rocha Caldeira" \
  --exp  3600 \
  --out  pjud_token.txt
```

Copie o conteúdo de `pjud_token.txt` e cole no `.env` como `DJEN_TOKEN=eyJ...`.

---

## ▶️ Como Usar

```bash
# Executa o robô manualmente
python main.py
```

O robô irá:
1. Ler a planilha de clientes
2. Consultar a API do DJEN
3. Para cada publicação com sessão virtual:
   - Extrair datas e prazo de Sustentação Oral
   - Identificar o cliente
   - Salvar rascunho de e-mail no Gmail
   - (Se ativo) Fazer upload do PDF no Google Drive

---

## 🧪 Testes

```bash
# Instale o pytest
pip install pytest

# Execute os testes
python -m pytest tests/ -v
```

---

## ⏰ Agendamento Automático

### Windows (Agendador de Tarefas)

1. Abra **"Agendador de Tarefas"** → **"Criar Tarefa Básica"**
2. Defina o horário (ex: todos os dias às 08:00)
3. Ação: **"Iniciar um programa"**
4. Programa: `C:\caminho\robo-juridico\venv\Scripts\python.exe`
5. Argumentos: `C:\caminho\robo-juridico\main.py`

### Linux / Mac (Cron)

```bash
# Abra o crontab
crontab -e

# Adicione a linha (executa todo dia às 08:00)
0 8 * * * /caminho/robo-juridico/venv/bin/python /caminho/robo-juridico/main.py >> /caminho/robo-juridico/robo.log 2>&1
```

---

## 🗂 Estrutura do Projeto

```
robo-juridico/
├── main.py                  # Ponto de entrada — orquestra tudo
├── config.py                # Carrega variáveis do .env
├── requirements.txt         # Dependências Python
├── .env.example             # Modelo de configuração (copie para .env)
├── .gitignore               # Protege dados sensíveis
├── clientes.xlsx            # (não commitado) Base de clientes
│
├── modules/
│   ├── api_djen.py          # Consulta à API do DJEN/CNJ
│   ├── regex_parser.py      # Extração de datas via Regex
│   ├── excel_manager.py     # Leitura da planilha de clientes
│   ├── email_draft.py       # Criação de rascunhos no Gmail
│   └── drive_manager.py     # Upload de PDFs no Google Drive
│
├── tests/
│   ├── test_regex_parser.py # Testes do parser de datas
│   └── test_excel_manager.py# Testes da busca de clientes
│
└── jwt-tools/               # Ferramentas Node.js para tokens JWT
    ├── sign.js              # Gera token simples (PDPJ)
    ├── gen_pjud.js          # Gera token configurável (PJUD)
    ├── genpub.js            # Extrai chave pública do PEM
    ├── verify.js            # Verifica/decodifica token
    ├── call_pjud.js         # Chama API autenticada
    └── README.md            # Documentação dos JWT tools
```

---

## 🛡 Segurança

- ✅ `.gitignore` protege `.env`, `*.pem`, `token.json`, `credentials.json` e `clientes.xlsx`
- ✅ Senhas armazenadas apenas no `.env` (nunca no código)
- ✅ Tokens JWT com validade curta (5 min para `client_assertion`)
- ⚠️ **Nunca** compartilhe `chave_privada.pem` — somente `maikon.pub.pem` é público

---

## ⚖️ Aviso Legal

Este software é uma ferramenta auxiliar de produtividade.
**Não substitui a conferência manual** das publicações e prazos nos sistemas
oficiais (PJe / Eproc). O advogado responsável deve sempre validar as
informações antes de enviar comunicações aos clientes.
