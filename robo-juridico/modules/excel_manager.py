"""
╔══════════════════════════════════════════════════════════════════════╗
║            📊  MÓDULO DE GESTÃO DA PLANILHA DE CLIENTES             ║
║  Lê clientes.xlsx e fornece busca por número de processo.           ║
╚══════════════════════════════════════════════════════════════════════╝

Estrutura esperada da planilha (cabeçalho na linha 1):

  | processo | nome_completo | email | tratamento | nome_caso |
  |----------|---------------|-------|------------|-----------|

  ⚠️  Formate a coluna "processo" como TEXTO no Excel para evitar
     truncamento de zeros e perda de pontuação.
"""

import re
from typing import Optional
import pandas as pd
from config import ARQUIVO_CLIENTES

# Colunas obrigatórias
_COLUNAS_OBRIGATORIAS = {"processo", "nome_completo", "email"}


def carregar_clientes() -> Optional[dict[str, dict]]:
    """
    Lê a planilha de clientes e retorna um dicionário indexado por número
    de processo (normalizado: apenas dígitos e hifens/pontos).

    Retorna None em caso de erro crítico.
    """
    try:
        df = pd.read_excel(ARQUIVO_CLIENTES, dtype=str)
    except FileNotFoundError:
        print(f"❌ Planilha não encontrada: '{ARQUIVO_CLIENTES}'")
        print("   → Crie o arquivo conforme o modelo no README.")
        return None
    except Exception as exc:
        print(f"❌ Erro ao ler a planilha: {exc}")
        return None

    # Normaliza nomes de colunas
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]

    # Valida colunas obrigatórias
    faltando = _COLUNAS_OBRIGATORIAS - set(df.columns)
    if faltando:
        print(f"❌ Colunas ausentes na planilha: {faltando}")
        print(f"   Colunas encontradas: {list(df.columns)}")
        return None

    # Preenche colunas opcionais com valor padrão
    if "tratamento"  not in df.columns: df["tratamento"]  = ""
    if "nome_caso"   not in df.columns: df["nome_caso"]   = ""

    clientes: dict[str, dict] = {}
    for _, row in df.iterrows():
        proc_raw = str(row.get("processo", "")).strip()
        if not proc_raw or proc_raw == "nan":
            continue

        # Normaliza o número do processo para comparação (remove espaços extras)
        proc_norm = _normalizar_processo(proc_raw)

        clientes[proc_norm] = {
            "processo"      : proc_raw,
            "nome_completo" : str(row.get("nome_completo", "")).strip(),
            "email"         : str(row.get("email",         "")).strip(),
            "tratamento"    : str(row.get("tratamento",    "")).strip(),
            "nome_caso"     : str(row.get("nome_caso",     "")).strip(),
        }

    return clientes


def buscar_cliente(clientes: dict[str, dict], numero_processo: str) -> Optional[dict]:
    """
    Busca o cliente pelo número do processo.
    Faz comparação normalizada para tolerar diferenças de formatação.
    """
    chave = _normalizar_processo(numero_processo)
    return clientes.get(chave)


def _normalizar_processo(numero: str) -> str:
    """
    Remove espaços e converte para minúsculas.
    Mantém pontos, hífens e dígitos (padrão CNJ: NNNNNNN-DD.AAAA.J.TT.OOOO).
    """
    return re.sub(r"\s+", "", numero).lower()
