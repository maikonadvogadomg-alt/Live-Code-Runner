"""
╔══════════════════════════════════════════════════════════════════════╗
║         🤖 ROBÔ DE MONITORAMENTO JURÍDICO — PONTO DE ENTRADA        ║
║         Maikon da Rocha Caldeira — OAB/RS                           ║
╚══════════════════════════════════════════════════════════════════════╝

Fluxo completo:
  1. Lê a planilha de clientes (clientes.xlsx)
  2. Consulta a API do DJEN/CNJ
  3. Para cada publicação relevante:
     a. Extrai datas/prazos via Regex
     b. Identifica o cliente dono do processo
     c. Cria rascunho de e-mail no Gmail
     d. (Opcional) Salva o PDF no Google Drive
"""

import sys
from modules.api_djen      import buscar_publicacoes
from modules.regex_parser  import extrair_dados_sessao
from modules.excel_manager import carregar_clientes, buscar_cliente
from modules.email_draft   import criar_rascunho_cliente
from modules.drive_manager import salvar_link_no_drive
from config                import PASTA_DRIVE_ID, SALVAR_NO_DRIVE


def processar_publicacao(publicacao: dict, clientes: dict) -> None:
    numero_proc = publicacao.get("numeroProcesso", "")
    texto       = publicacao.get("texto", "")
    link_pdf    = publicacao.get("linkDocumento", "")

    print(f"\n{'─'*60}")
    print(f"📋 Processo: {numero_proc}")

    # ── 1. Extrai datas e prazos via Regex ─────────────────────────────
    dados_sessao = extrair_dados_sessao(texto)

    if not dados_sessao:
        print("   ℹ️  Nenhuma sessão de julgamento identificada. Pulando.")
        return

    print(f"   📅 Início da sessão : {dados_sessao['inicio']}")
    print(f"   📅 Fim da sessão    : {dados_sessao['fim']}")
    print(f"   ⚠️  Prazo oral (48h) : {dados_sessao['prazo_oral']}")

    # ── 2. Identifica o cliente ─────────────────────────────────────────
    cliente = buscar_cliente(clientes, numero_proc)
    dados_proc = {
        "numero" : numero_proc,
        "inicio" : dados_sessao["inicio"],
        "fim"    : dados_sessao["fim"],
        "prazo"  : dados_sessao["prazo_oral"],
        "texto"  : texto[:300] + ("..." if len(texto) > 300 else ""),
    }

    if cliente:
        print(f"   👤 Cliente  : {cliente['nome_completo']}")
        print(f"   📧 E-mail   : {cliente['email']}")
        # ── 3. Cria rascunho de e-mail ──────────────────────────────────
        criar_rascunho_cliente(dados_proc, cliente)

        # ── 4. (Opcional) Salva PDF no Google Drive ─────────────────────────
        if SALVAR_NO_DRIVE and link_pdf:
            from datetime import datetime
            data_hoje   = datetime.now().strftime("%Y-%m-%d")
            nome_limpo  = cliente["nome_completo"].replace(" ", "_")
            nome_arquivo = f"{data_hoje}_Intimacao_{nome_limpo}_{numero_proc}.pdf"
            salvar_link_no_drive(link_pdf, nome_arquivo, pasta_id=PASTA_DRIVE_ID)
    else:
        print("   ⚠️  Cliente não encontrado na planilha. Rascunho genérico ignorado.")


def main():
    print("=" * 60)
    print("  🤖  ROBÔ JURÍDICO — INICIANDO                          ")
    print("=" * 60)

    # ── Carrega planilha de clientes ────────────────────────────────────
    clientes = carregar_clientes()
    if clientes is None:
        print("❌ Não foi possível carregar a planilha de clientes. Abortando.")
        sys.exit(1)
    print(f"✅ {len(clientes)} cliente(s) carregado(s) da planilha.\n")

    # ── Consulta API do DJEN ────────────────────────────────────────────
    publicacoes = buscar_publicacoes()
    if not publicacoes:
        print("ℹ️  Nenhuma publicação nova encontrada. Encerrando.")
        return

    print(f"📦 {len(publicacoes)} publicação(ões) encontrada(s). Processando...\n")

    for pub in publicacoes:
        try:
            processar_publicacao(pub, clientes)
        except Exception as exc:
            print(f"   ❌ Erro inesperado ao processar publicação: {exc}")

    print("\n" + "=" * 60)
    print("  ✅  ROBÔ JURÍDICO — CONCLUÍDO                          ")
    print("=" * 60)


if __name__ == "__main__":
    main()
