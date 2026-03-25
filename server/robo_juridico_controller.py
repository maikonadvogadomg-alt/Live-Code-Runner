import sys
import os
import json
from typing import Dict, Any

# Adiciona o caminho do robô jurídico ao sys.path para importação
sys.path.append(os.path.join(os.path.dirname(__file__), "../robo-juridico"))

class RoboJuridicoController:
    """
    Controlador para integração do robô jurídico com a API web.
    Gerencia a execução do robô e formatação dos resultados para resposta HTTP.
    """
    
    @staticmethod
    def executar_robo() -> Dict[str, Any]:
        """
        Executa o robô jurídico e retorna resultados formatados para API.
        """
        try:
            # Importa a classe do robô jurídico
            from robo_juridico_api import RoboJuridico
            
            # Executa o robô
            robo = RoboJuridico()
            resultado = robo.executar()
            
            return {
                "success": resultado["sucesso"],
                "data": {
                    "message": resultado.get("mensagem", ""),
                    "results": resultado.get("resultados", []),
                    "statistics": resultado.get("estatisticas", {}),
                    "timestamp": resultado.get("timestamp", "")
                }
            }
            
        except ImportError as e:
            return {
                "success": False,
                "error": f"Erro ao importar módulos do robô jurídico: {str(e)}",
                "data": {}
            }
        
        except Exception as e:
            return {
                "success": False,
                "error": f"Erro ao executar robô jurídico: {str(e)}",
                "data": {}
            }
    
    @staticmethod
    def obter_status() -> Dict[str, Any]:
        """
        Retorna o status do robô jurídico e sua configuração.
        """
        try:
            # Verifica se os arquivos necessários existem
            robo_dir = os.path.join(os.path.dirname(__file__), "../robo-juridico")
            arquivos_necessarios = [
                "main.py",
                "config.py",
                "modules/api_djen.py",
                "modules/regex_parser.py",
                "modules/excel_manager.py",
                "modules/email_draft.py",
                "modules/drive_manager.py"
            ]
            
            arquivos_existentes = {}
            for arquivo in arquivos_necessarios:
                caminho = os.path.join(robo_dir, arquivo)
                arquivos_existentes[arquivo] = os.path.exists(caminho)
            
            # Verifica configurações essenciais
            from dotenv import load_dotenv
            load_dotenv()
            
            configuracoes = {
                "EMAIL_LOGIN": os.getenv("EMAIL_LOGIN", "") != "",
                "SENHA_APP": os.getenv("SENHA_APP", "") != "",
                "DJEN_TOKEN": os.getenv("DJEN_TOKEN", "") != "",
                "ARQUIVO_CLIENTES": os.path.exists(os.getenv("ARQUIVO_CLIENTES", "clientes.xlsx"))
            }
            
            todos_configurados = all(configuracoes.values())
            
            return {
                "success": True,
                "data": {
                    "status": "ativo" if todos_configurados else "configuração_incompleta",
                    "arquivos": arquivos_existentes,
                    "configuracoes": configuracoes,
                    "todos_configurados": todos_configurados,
                    "mensagem": "Robô jurídico configurado corretamente" if todos_configurados else "Configuração incompleta. Verifique as variáveis de ambiente e arquivos necessários."
                }
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": f"Erro ao verificar status do robô jurídico: {str(e)}",
                "data": {}
            }