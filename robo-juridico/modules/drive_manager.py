"""
╔══════════════════════════════════════════════════════════════════════╗
║          ☁️   MÓDULO DE INTEGRAÇÃO COM GOOGLE DRIVE                 ║
║  Baixa PDFs do tribunal e faz upload direto para o Drive.           ║
╚══════════════════════════════════════════════════════════════════════╝

Pré-requisito:
  1. Acesse console.cloud.google.com e crie um projeto.
  2. Ative a "Google Drive API".
  3. Crie credenciais OAuth 2.0 (Tipo: Desktop app).
  4. Baixe o JSON e renomeie para credentials.json na raiz do projeto.
  5. pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib

Na primeira execução, o navegador abrirá para autorização.
As credenciais serão salvas em token.json automaticamente.

Para usar, defina no .env:
  SALVAR_NO_DRIVE=true
  PASTA_DRIVE_ID=<ID da pasta no Google Drive>  (opcional)
"""

import os
import io
import requests

# Importações do SDK do Google (instalação opcional)
try:
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseUpload
    _DRIVE_DISPONIVEL = True
except ImportError:
    _DRIVE_DISPONIVEL = False

# Escopo: permissão apenas para criar/ver arquivos criados pelo app
_SCOPES = ["https://www.googleapis.com/auth/drive.file"]
_CREDENTIALS_FILE = "credentials.json"
_TOKEN_FILE = "token.json"


def _autenticar_drive():
    """
    Autentica via OAuth2. Na primeira vez, abre o navegador.
    Salva o token em token.json para execuções futuras.
    """
    creds = None

    if os.path.exists(_TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(_TOKEN_FILE, _SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(_CREDENTIALS_FILE):
                raise FileNotFoundError(
                    f"Arquivo '{_CREDENTIALS_FILE}' não encontrado.\n"
                    "   → Baixe o JSON de credenciais OAuth2 no Google Cloud Console\n"
                    "     e salve como 'credentials.json' na raiz do projeto."
                )
            flow = InstalledAppFlow.from_client_secrets_file(_CREDENTIALS_FILE, _SCOPES)
            creds = flow.run_local_server(port=0)

        with open(_TOKEN_FILE, "w") as f:
            f.write(creds.to_json())

    return build("drive", "v3", credentials=creds)


def salvar_link_no_drive(
    link_pdf: str,
    nome_arquivo: str,
    pasta_id: str = None,
) -> bool:
    """
    Baixa o PDF do link do tribunal e faz upload para o Google Drive.

    O arquivo é mantido em memória (BytesIO) — nada é gravado no disco local.

    Args:
        link_pdf     : URL do PDF no tribunal
        nome_arquivo : Nome de destino no Drive (ex: "2025-01-01_Intimacao_Cliente.pdf")
        pasta_id     : ID da pasta do Drive (opcional). Deixe None para a raiz.

    Returns:
        True em caso de sucesso, False caso contrário.
    """
    if not _DRIVE_DISPONIVEL:
        print("   ⚠️  SDK do Google Drive não instalado.")
        print("      → pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib")
        return False

    if not link_pdf:
        print("   ⚠️  Link do PDF não fornecido. Upload ignorado.")
        return False

    try:
        service = _autenticar_drive()

        # ── 1. Download do PDF (em memória) ─────────────────────────────
        print(f"   ☁️  Baixando do tribunal: {link_pdf[:60]}...")
        resp = requests.get(link_pdf, stream=True, timeout=30)

        if resp.status_code != 200:
            print(f"   ❌ Erro ao baixar PDF: HTTP {resp.status_code}")
            return False

        buffer = io.BytesIO()
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                buffer.write(chunk)
        buffer.seek(0)

        # ── 2. Upload para o Drive ───────────────────────────────────────
        print(f"   ☁️  Enviando para o Drive: {nome_arquivo}")
        metadata = {"name": nome_arquivo}
        if pasta_id:
            metadata["parents"] = [pasta_id]

        media = MediaIoBaseUpload(buffer, mimetype="application/pdf", resumable=True)
        arquivo = (
            service.files()
            .create(body=metadata, media_body=media, fields="id, name")
            .execute()
        )

        print(f"   ✅ PDF salvo no Drive! ID: {arquivo.get('id')} | Nome: {arquivo.get('name')}")
        return True

    except FileNotFoundError as exc:
        print(f"   ❌ {exc}")
        return False
    except Exception as exc:
        print(f"   ⚠️  Falha no upload para o Drive: {exc}")
        return False
