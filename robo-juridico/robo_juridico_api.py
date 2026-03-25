import sys
import json
from datetime import datetime
from typing import Dict, List, Optional

# Adaptação do robô jurídico para integração com a API

class RoboJuridico:
    """
    Classe que encapsula a lógica do robô jurídico para integração com a API.
    Permite execução programática e retorno de resultados estruturados.
    """
    
    def __init__(self):
        self.resultados = []
        self.erros = []
        
    def processar_publicacao(self, publicacao: Dict, clientes: Dict) -> Dict:
        """
        Processa uma única publicação jurídica e retorna resultados estruturados.
        """
        numero_proc = publicacao.get("numeroProcesso", "")
        texto = publicacao.get("texto", "")
        link_pdf = publicacao.get("linkDocumento", "")

        resultado = {
            "processo": numero_proc,
            "texto_preview": texto[:300] + ("..." if len(texto) > 300 else ""),
            "status": "processando",
            "acoes_realizadas": [],
            "erros": []
        }

        try:
            # Extrai datas e prazos via Regex
            from modules.regex_parser import extrair_dados_sessao
            dados_sessao = extrair_dados_sessao(texto)

            if not dados_sessao:
                resultado["status"] = "ignorado"
                resultado["motivo"] = "Nenhuma sessão de julgamento identificada"
                return resultado

            resultado["dados_sessao"] = dados_sessao
            resultado["acoes_realizadas"].append("extração de dados da sessão")

            # Identifica o cliente
            from modules.excel_manager import buscar_cliente
            cliente = buscar_cliente(clientes, numero_proc)
            
            if cliente:
                resultado["cliente"] = {
                    "nome": cliente["nome_completo"],
                    "email": cliente["email"]
                }
                
                # Cria rascunho de e-mail
                from modules.email_draft import criar_rascunho_cliente
                dados_proc = {
                    "numero": numero_proc,
                    "inicio": dados_sessao["inicio"],
                    "fim": dados_sessao["fim"],
                    "prazo": dados_sessao["prazo_oral"],
                    "texto": texto[:300] + ("..." if len(texto) > 300 else ""),
                }
                
                try:
                    criar_rascunho_cliente(dados_proc, cliente)
                    resultado["acoes_realizadas"].append("criação de rascunho de e-mail")
                except Exception as e:
                    erro_msg = f"Erro ao criar rascunho de e-mail: {str(e)}"
                    resultado["erros"].append(erro_msg)
                    
                # Salva PDF no Google Drive (opcional)
                from config import SALVAR_NO_DRIVE, PASTA_DRIVE_ID
                if SALVAR_NO_DRIVE and link_pdf and PASTA_DRIVE_ID:
                    try:
                        from modules.drive_manager import salvar_link_no_drive
                        data_hoje = datetime.now().strftime("%Y-%m-%d")
                        nome_limpo = cliente["nome_completo"].replace(" ", "_")
                        nome_arquivo = f"{data_hoje}_Intimacao_{nome_limpo}_{numero_proc}.pdf"
                        salvar_link_no_drive(link_pdf, nome_arquivo, pasta_id=PASTA_DRIVE_ID)
                        resultado["acoes_realizadas"].append("salvar PDF no Google Drive")
                    except Exception as e:
                        erro_msg = f"Erro ao salvar PDF no Google Drive: {str(e)}"
                        resultado["erros"].append(erro_msg)
            else:
                resultado["status"] = "cliente_nao_encontrado"
                resultado["motivo"] = "Cliente não encontrado na planilha"
                
            resultado["status"] = "concluído" if not resultado["erros"] else "concluído_com_erros"
            
        except Exception as e:
            resultado["status"] = "erro"
            resultado["erros"].append(f"Erro inesperado: {str(e)}")

        return resultado
    
    def executar(self) -> Dict:
        """
        Executa o fluxo completo do robô jurídico e retorna resultados estruturados.
        """
        try:
            # Carrega planilha de clientes
            from modules.excel_manager import carregar_clientes
            clientes = carregar_clientes()
            
            if clientes is None:
                return {
                    "sucesso": False,
                    "erro": "Não foi possível carregar a planilha de clientes",
                    "resultados": [],
                    "estatisticas": {
                        "total_publicacoes": 0,
                        "processadas": 0,
                        "com_erro": 0,
                        "ignoradas": 0
                    }
                }
            
            # Consulta API do DJEN
            from modules.api_djen import buscar_publicacoes
            publicacoes = buscar_publicacoes()
            
            if not publicacoes:
                return {
                    "sucesso": True,
                    "mensagem": "Nenhuma publicação nova encontrada",
                    "resultados": [],
                    "estatisticas": {
                        "total_publicacoes": 0,
                        "processadas": 0,
                        "com_erro": 0,
                        "ignoradas": 0
                    }
                }
            
            # Processa cada publicação
            resultados = []
            estatisticas = {
                "total_publicacoes": len(publicacoes),
                "processadas": 0,
                "com_erro": 0,
                "ignoradas": 0
            }
            
            for pub in publicacoes:
                try:
                    resultado = self.processar_publicacao(pub, clientes)
                    resultados.append(resultado)
                    
                    if resultado["status"] == "concluído_com_erros":
                        estatisticas["com_erro"] += 1
                    elif resultado["status"] in ["ignorado", "cliente_nao_encontrado"]:
                        estatisticas["ignoradas"] += 1
                    else:
                        estatisticas["processadas"] += 1
                        
                except Exception as exc:
                    erro_msg = f"Erro inesperado ao processar publicação: {exc}"
                    resultados.append({
                        "processo": pub.get("numeroProcesso", "desconhecido"),
                        "status": "erro",
                        "erros": [erro_msg]
                    })
                    estatisticas["com_erro"] += 1

            return {
                "sucesso": True,
                "mensagem": f"Processamento concluído: {estatisticas['processadas']} processadas, {estatisticas['com_erro']} com erro, {estatisticas['ignoradas']} ignoradas",
                "resultados": resultados,
                "estatisticas": estatisticas,
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            return {
                "sucesso": False,
                "erro": f"Erro ao executar robô jurídico: {str(e)}",
                "resultados": [],
                "estatisticas": {
                    "total_publicacoes": 0,
                    "processadas": 0,
                    "com_erro": 0,
                    "ignoradas": 0
                }
            }

# Função para execução direta (mantém compatibilidade com o script original)
def main():
    robo = RoboJuridico()
    resultado = robo.executar()
    
    if resultado["sucesso"]:
        print(f"✅ Processamento concluído com sucesso!")
        print(f"📊 Estatísticas: {resultado['estatisticas']['processadas']} processadas, {resultado['estatisticas']['com_erro']} com erro, {resultado['estatisticas']['ignoradas']} ignoradas")
    else:
        print(f"❌ Erro no processamento: {resultado.get('erro', 'Erro desconhecido')}")
    
    # Exibe resultados detalhados
    for r in resultado.get('resultados', []):
        status_emoji = "✅" if r["status"] == "concluído" else "⚠️" if "erro" in r["status"] else "ℹ️"
        print(f"{status_emoji} Processo {r['processo']}: {r['status']}")
        
    return resultado

if __name__ == "__main__":
    main()