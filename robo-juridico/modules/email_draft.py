"""
╔══════════════════════════════════════════════════════════════════════╗
║          ✉️   MÓDULO DE CRIAÇÃO DE RASCUNHOS NO GMAIL               ║
║  Usa protocolo IMAP para salvar e-mails na pasta Rascunhos.         ║
╚══════════════════════════════════════════════════════════════════════╝

Pré-requisito:
  1. Ative a "Verificação em duas etapas" na conta Google.
  2. Em "Segurança" → "Senhas de app", gere uma senha para "Email".
  3. Coloque a senha no .env: SENHA_APP=xxxx xxxx xxxx xxxx
  4. Ative o acesso IMAP em: Gmail → Configurações → Encaminhamento e POP/IMAP.

Pasta de rascunhos:
  - Gmail em Português : [Gmail]/Rascunhos
  - Gmail em Inglês    : [Gmail]/Drafts
  (ajuste PASTA_DRAFTS no .env)
"""

import imaplib
import time
from email.message import EmailMessage
from config import EMAIL_LOGIN, SENHA_APP, IMAP_SERVER, PASTA_DRAFTS


def criar_rascunho_cliente(dados_processo: dict, cliente: dict) -> bool:
    """
    Cria um rascunho de e-mail na pasta Rascunhos do Gmail.

    Args:
        dados_processo: dict com chaves numero, inicio, fim, prazo, texto
        cliente:        dict com chaves nome_completo, email, tratamento, nome_caso

    Returns:
        True se o rascunho foi salvo com sucesso, False caso contrário.
    """
    if not SENHA_APP:
        print("   ⚠️  SENHA_APP não configurada no .env — rascunho não criado.")
        return False

    numero         = dados_processo.get("numero", "N/A")
    data_inicio    = dados_processo.get("inicio", "N/A")
    data_fim       = dados_processo.get("fim",    "N/A")
    prazo_oral     = dados_processo.get("prazo",  "N/A")
    nome_caso      = cliente.get("nome_caso", "")
    tratamento     = cliente.get("tratamento") or "Prezado(a) Cliente"
    email_cliente  = cliente.get("email", "")
    nome_completo  = cliente.get("nome_completo", "")

    if not email_cliente:
        print(f"   ⚠️  E-mail do cliente '{nome_completo}' não cadastrado.")
        return False

    # ── Monta o assunto ──────────────────────────────────────────────────
    assunto = (
        f"Comunicado: Julgamento Virtual Designado"
        + (f" — {nome_caso}" if nome_caso else f" — Proc. {numero}")
    )

    # ── Monta o corpo do e-mail ──────────────────────────────────────────
    corpo = f"""\
{tratamento},

Espero que esteja bem.

Informo que foi designada sessão de julgamento **virtual** para o seu processo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Processo nº    : {numero}
  Início da sessão: {data_inicio}
  Término da sessão: {data_fim}
  ⚠️  Prazo para Sustentação Oral: {prazo_oral}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Neste momento, **não é necessário o seu comparecimento**. O julgamento acontece de forma eletrônica entre os magistrados.

Nossa equipe já está monitorando o prazo para eventual Sustentação Oral (manifestação oral antes do voto), caso seja cabível.

Assim que tivermos o resultado, entro em contato imediatamente.

Qualquer dúvida, estou à disposição.

Atenciosamente,

Maikon da Rocha Caldeira
Advogado — OAB/RS
"""

    # ── Monta o objeto EmailMessage ──────────────────────────────────────
    msg = EmailMessage()
    msg["Subject"] = assunto
    msg["From"]    = EMAIL_LOGIN
    msg["To"]      = email_cliente
    msg.set_content(corpo)

    # ── Conecta via IMAP e salva o rascunho ──────────────────────────────
    try:
        print(f"   ✉️  Criando rascunho para {nome_completo} <{email_cliente}>...")
        mail = imaplib.IMAP4_SSL(IMAP_SERVER)
        mail.login(EMAIL_LOGIN, SENHA_APP)

        result = mail.append(
            PASTA_DRAFTS,
            "\\Draft",
            imaplib.Time2Internaldate(time.time()),
            msg.as_bytes(),
        )
        mail.logout()

        if result[0] == "OK":
            print(f"   ✅ Rascunho salvo em '{PASTA_DRAFTS}'!")
            return True
        else:
            print(f"   ❌ IMAP append retornou: {result}")
            return False

    except imaplib.IMAP4.error as exc:
        print(f"   ❌ Erro IMAP: {exc}")
        _dica_pasta_drafts(str(exc))
        return False
    except OSError as exc:
        print(f"   ❌ Erro de rede/SSL: {exc}")
        return False


def _dica_pasta_drafts(erro: str) -> None:
    if "select failed" in erro.lower() or "doesn't exist" in erro.lower():
        print("   💡 Dica: A pasta de rascunhos pode ter nome diferente.")
        print(f"      Atual: {PASTA_DRAFTS}")
        print("      Tente '[Gmail]/Drafts' (Gmail em inglês) no .env: PASTA_DRAFTS=[Gmail]/Drafts")
