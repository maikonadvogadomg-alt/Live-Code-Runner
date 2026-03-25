"""
╔══════════════════════════════════════════════════════════════════════╗
║          🔍  MÓDULO DE EXTRAÇÃO DE DADOS VIA REGEX                  ║
║  Lê o texto de intimação e extrai datas de sessão virtual.          ║
╚══════════════════════════════════════════════════════════════════════╝

Padrões reconhecidos:
  - "... entre os dias DD/MM/AAAA e DD/MM/AAAA ..."
  - "... período de DD/MM/AAAA a DD/MM/AAAA ..."
  - "... julgamento virtual de DD/MM/AAAA até DD/MM/AAAA ..."
  - "... início em DD/MM/AAAA e término em DD/MM/AAAA ..."
"""

import re
from datetime import datetime, timedelta
from typing import Optional


# Padrão de data DD/MM/AAAA
_DATA = r"(\d{2}/\d{2}/\d{4})"

# Variações de conectivos entre as datas
_CONECTIVOS = r"(?:e|a|até|ao|com término em|com término)"

# Regex principal: captura início e fim da sessão
_PADROES = [
    # "entre os dias DD/MM/AAAA e DD/MM/AAAA"
    re.compile(
        rf"entre\s+os\s+dias\s+{_DATA}\s+{_CONECTIVOS}\s+{_DATA}",
        re.IGNORECASE,
    ),
    # "período de DD/MM/AAAA a DD/MM/AAAA"
    re.compile(
        rf"per[íi]odo\s+de\s+{_DATA}\s+{_CONECTIVOS}\s+{_DATA}",
        re.IGNORECASE,
    ),
    # "julgamento virtual de DD/MM/AAAA até DD/MM/AAAA"
    re.compile(
        rf"julgamento\s+(?:virtual\s+)?de\s+{_DATA}\s+{_CONECTIVOS}\s+{_DATA}",
        re.IGNORECASE,
    ),
    # "início em DD/MM/AAAA e término em DD/MM/AAAA"
    re.compile(
        rf"in[íi]cio\s+(?:em\s+)?{_DATA}.*?t[eé]rmino\s+(?:em\s+)?{_DATA}",
        re.IGNORECASE | re.DOTALL,
    ),
    # "de DD/MM/AAAA a DD/MM/AAAA" (genérico)
    re.compile(
        rf"\bde\s+{_DATA}\s+{_CONECTIVOS}\s+{_DATA}",
        re.IGNORECASE,
    ),
]


def _parse_data(texto: str) -> Optional[datetime]:
    """Converte string DD/MM/AAAA em datetime. Retorna None se inválida."""
    try:
        return datetime.strptime(texto.strip(), "%d/%m/%Y")
    except ValueError:
        return None


def extrair_dados_sessao(texto: str) -> Optional[dict]:
    """
    Analisa o texto de intimação e retorna um dicionário com:
      - inicio      (str)      : data de início da sessão   (DD/MM/AAAA)
      - fim         (str)      : data de fim da sessão      (DD/MM/AAAA)
      - prazo_oral  (str)      : data limite para sustentação oral (48h antes do início)
      - inicio_dt   (datetime) : data de início como objeto datetime
      - fim_dt      (datetime) : data de fim como objeto datetime

    Retorna None se não encontrar datas no texto.
    """
    for padrao in _PADROES:
        match = padrao.search(texto)
        if match:
            str_inicio, str_fim = match.group(1), match.group(2)

            dt_inicio = _parse_data(str_inicio)
            dt_fim    = _parse_data(str_fim)

            if not dt_inicio or not dt_fim:
                continue

            # Prazo para sustentação oral = 48 horas antes do início
            dt_prazo = dt_inicio - timedelta(hours=48)

            return {
                "inicio"     : dt_inicio.strftime("%d/%m/%Y"),
                "fim"        : dt_fim.strftime("%d/%m/%Y"),
                "prazo_oral" : dt_prazo.strftime("%d/%m/%Y às %H:%M"),
                "inicio_dt"  : dt_inicio,
                "fim_dt"     : dt_fim,
            }

    return None  # Nenhum padrão reconhecido
