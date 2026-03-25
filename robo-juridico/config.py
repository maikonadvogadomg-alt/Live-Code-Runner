"""
╔══════════════════════════════════════════════════════════════════════╗
║                   ⚙️  CONFIGURAÇÕES CENTRAIS                        ║
║  Carrega variáveis do arquivo .env (nunca commite o .env no Git!)   ║
╚══════════════════════════════════════════════════════════════════════╝
"""

import os
from dotenv import load_dotenv

# Carrega o arquivo .env da raiz do projeto
load_dotenv()

# ── Gmail (IMAP) ────────────────────────────────────────────────────────────
EMAIL_LOGIN  : str  = os.getenv("EMAIL_LOGIN",  "seu_email@gmail.com")
SENHA_APP    : str  = os.getenv("SENHA_APP",    "")
IMAP_SERVER  : str  = os.getenv("IMAP_SERVER",  "imap.gmail.com")
PASTA_DRAFTS : str  = os.getenv("PASTA_DRAFTS", "[Gmail]/Rascunhos")

# ── Planilha de clientes ─────────────────────────────────────────────────────
ARQUIVO_CLIENTES : str = os.getenv("ARQUIVO_CLIENTES", "clientes.xlsx")

# ── API do DJEN / CNJ ────────────────────────────────────────────────────────
#   Endpoint de comunicações do DJEN v1.0.3
DJEN_API_URL : str = os.getenv(
    "DJEN_API_URL",
    "https://comunicaapi.pje.jus.br/api/v1/comunicacao"
)
DJEN_TOKEN : str = os.getenv("DJEN_TOKEN", "")

# ── Chave PEM e CPF para auto-geração de JWT (PDPJ / DJEN) ──────────────────
#   Se DJEN_TOKEN estiver vazio, o sistema tentará gerar o token automaticamente
#   usando a chave privada PEM registrada no PDPJ/CNJ.
PDPJ_PEM_PRIVATE_KEY : str = os.getenv("PDPJ_PEM_PRIVATE_KEY", "")
ADVOGADO_CPF         : str = os.getenv("ADVOGADO_CPF", "")

# ── Google Drive (opcional) ──────────────────────────────────────────────────
SALVAR_NO_DRIVE : bool = os.getenv("SALVAR_NO_DRIVE", "false").lower() == "true"
PASTA_DRIVE_ID  : str  = os.getenv("PASTA_DRIVE_ID",  "")
