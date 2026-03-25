"""
╔══════════════════════════════════════════════════════════════════════╗
║             📡  MÓDULO DE CONSULTA À API DO DJEN / CNJ              ║
║  Endpoint: /comunicacao  (DJEN v1.0.3)                              ║
╚══════════════════════════════════════════════════════════════════════╝

A API do DJEN exige um Bearer Token JWT (RS256). O módulo tenta:
  1. Usar DJEN_TOKEN do .env (se configurado)
  2. Gerar automaticamente via PDPJ_PEM_PRIVATE_KEY + ADVOGADO_CPF do .env

Configure pelo menos PDPJ_PEM_PRIVATE_KEY e ADVOGADO_CPF no .env.
"""

import json
import time
import requests
from typing import List, Dict
from config import DJEN_API_URL, DJEN_TOKEN, PDPJ_PEM_PRIVATE_KEY, ADVOGADO_CPF

# Número de páginas a consultar por execução (ajuste conforme volume)
MAX_PAGINAS = 5
ITENS_POR_PAGINA = 20


def _gerar_token_pem() -> str:
    """Gera JWT RS256 automaticamente usando a chave PEM do .env."""
    if not PDPJ_PEM_PRIVATE_KEY or not ADVOGADO_CPF:
        return ""
    try:
        import jwt as pyjwt  # PyJWT
        pem = PDPJ_PEM_PRIVATE_KEY.replace("\\n", "\n").strip()
        cpf_limpo = "".join(c for c in ADVOGADO_CPF if c.isdigit())
        if len(cpf_limpo) != 11:
            print("⚠️  ADVOGADO_CPF inválido no .env — deve ter 11 dígitos.")
            return ""
        now = int(time.time())
        payload = {
            "sub": cpf_limpo,
            "iss": "pdpj-br",
            "aud": "https://comunicaapi.pje.jus.br",
            "iat": now,
            "exp": now + 3600,
            "jti": f"djen-{now}",
        }
        token = pyjwt.encode(payload, pem, algorithm="RS256")
        # PyJWT >= 2.x retorna str, < 2.x retorna bytes
        return token if isinstance(token, str) else token.decode("utf-8")
    except ImportError:
        print("⚠️  PyJWT não instalado. Execute: pip install PyJWT cryptography")
        return ""
    except Exception as exc:
        print(f"⚠️  Erro ao gerar JWT automático: {exc}")
        return ""


def _obter_token() -> str:
    """Retorna token: primeiro do .env, depois tenta gerar via PEM."""
    if DJEN_TOKEN:
        return DJEN_TOKEN
    token = _gerar_token_pem()
    if token:
        print("   🔑 Token JWT gerado automaticamente via PDPJ_PEM_PRIVATE_KEY.")
    return token


def buscar_publicacoes() -> List[Dict]:
    """
    Consulta a API do DJEN e retorna a lista de publicações.
    Tenta DJEN_TOKEN do .env primeiro; se ausente, gera JWT via PEM automaticamente.
    Retorna lista vazia em caso de erro ou sem resultados.
    """
    token = _obter_token()
    if not token:
        print("⚠️  Sem token disponível (DJEN_TOKEN vazio e PEM não configurado).")
        print("   → Rodando em modo SIMULADO com dados de exemplo.\n")
        return _dados_simulados()

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }

    todas_publicacoes: list[dict] = []

    for pagina in range(1, MAX_PAGINAS + 1):
        params = {
            "pagina": pagina,
            "itensPorPagina": ITENS_POR_PAGINA,
        }
        try:
            print(f"   📡 Consultando DJEN — página {pagina}...")
            resp = requests.get(DJEN_API_URL, headers=headers, params=params, timeout=15)

            if resp.status_code == 401:
                print("   ❌ 401 Unauthorized — Token inválido ou expirado.")
                print("      → Configure PDPJ_PEM_PRIVATE_KEY e ADVOGADO_CPF no .env para auto-geração.")
                break

            if resp.status_code == 403:
                print("   ❌ 403 Forbidden — IP bloqueado ou chave não registrada no PDPJ.")
                break

            if resp.status_code != 200:
                print(f"   ❌ Erro HTTP {resp.status_code}: {resp.text[:200]}")
                break

            dados = resp.json()

            # A API pode retornar { "comunicacoes": [...] } ou diretamente uma lista
            itens = dados.get("comunicacoes") or dados.get("data") or dados
            if isinstance(itens, dict):
                itens = list(itens.values())

            if not itens:
                print(f"   ℹ️  Página {pagina} vazia. Encerrando paginação.")
                break

            todas_publicacoes.extend(itens)
            print(f"   ✅ {len(itens)} item(ns) recebido(s) na página {pagina}.")

            # Verifica se há mais páginas
            total = dados.get("total") or dados.get("totalItens") or 0
            if total and len(todas_publicacoes) >= int(total):
                break

        except requests.exceptions.Timeout:
            print("   ❌ Timeout ao conectar na API do DJEN.")
            break
        except requests.exceptions.ConnectionError as exc:
            print(f"   ❌ Erro de conexão: {exc}")
            break
        except json.JSONDecodeError:
            print("   ❌ Resposta da API não é JSON válido.")
            break

    return todas_publicacoes


# ── Dados simulados para testes sem token ───────────────────────────────────
def _dados_simulados() -> list[dict]:
    return [
        {
            "numeroProcesso": "6002755-35.2024.4.06.3819",
            "texto": (
                "JULGAMENTO VIRTUAL. Processo nº 6002755-35.2024.4.06.3819. "
                "O julgamento ocorrerá de forma virtual entre os dias "
                "26/11/2025 e 02/12/2025. Partes: Maikon da Rocha Caldeira. "
                "Assunto: Aposentadoria por Tempo de Contribuição."
            ),
            "linkDocumento": "",
        },
        {
            "numeroProcesso": "0001234-56.2023.8.21.0001",
            "texto": (
                "PAUTA VIRTUAL. Processo nº 0001234-56.2023.8.21.0001. "
                "Sessão virtual de julgamento designada para o período de "
                "10/12/2025 a 17/12/2025. Recurso de apelação."
            ),
            "linkDocumento": "",
        },
    ]
