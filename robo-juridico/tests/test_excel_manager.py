"""
Testes automáticos para o módulo excel_manager.
Execute com: python -m pytest tests/ -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from modules.excel_manager import buscar_cliente, _normalizar_processo


def _clientes_mock() -> dict:
    return {
        _normalizar_processo("6002755-35.2024.4.06.3819"): {
            "processo":      "6002755-35.2024.4.06.3819",
            "nome_completo": "Maria do Carmo Silva",
            "email":         "maria@example.com",
            "tratamento":    "Prezada Maria",
            "nome_caso":     "Aposentadoria",
        },
        _normalizar_processo("0001234-56.2023.8.21.0001"): {
            "processo":      "0001234-56.2023.8.21.0001",
            "nome_completo": "Theo Pyerre Santos",
            "email":         "theo@example.com",
            "tratamento":    "Prezado Theo",
            "nome_caso":     "Revisão de Benefício",
        },
    }


def test_busca_processo_exato():
    clientes = _clientes_mock()
    c = buscar_cliente(clientes, "6002755-35.2024.4.06.3819")
    assert c is not None
    assert c["nome_completo"] == "Maria do Carmo Silva"


def test_busca_processo_com_espacos():
    clientes = _clientes_mock()
    # Espaços extras não devem importar
    c = buscar_cliente(clientes, "6002755-35.2024.4.06.3819 ")
    assert c is not None
    assert c["email"] == "maria@example.com"


def test_busca_processo_inexistente():
    clientes = _clientes_mock()
    c = buscar_cliente(clientes, "9999999-99.9999.9.99.9999")
    assert c is None


def test_normalizar_processo():
    assert _normalizar_processo("6002755-35.2024.4.06.3819") == "6002755-35.2024.4.06.3819"
    assert _normalizar_processo(" 6002755-35.2024.4.06.3819 ") == "6002755-35.2024.4.06.3819"
