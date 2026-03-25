"""
Script de teste para o robô jurídico.
Demonstra como executar o robô programaticamente.
"""

import sys
import os
import json
from datetime import datetime

# Adiciona o caminho do projeto ao sys.path
sys.path.append(os.path.join(os.path.dirname(__file__), "../robo-juridico"))

def main():
    """
    Função principal para executar o teste do robô jurídico.
    """
    print("🤖 Iniciando teste do Robô Jurídico")
    print(f"📅 Data e hora: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
    print("─" * 50)
    
    try:
        # Importa a classe do robô jurídico
        from robo_juridico_api import RoboJuridico
        
        # Cria uma instância do robô
        robo = RoboJuridico()
        
        # Executa o robô
        print("🚀 Executando robô jurídico...")
        resultado = robo.executar()
        
        # Exibe os resultados
        print("\n📊 Resultados:")
        print("─" * 50)
        
        if resultado["sucesso"]:
            print(f"✅ Sucesso: {resultado['mensagem']}")
            
            # Estatísticas
            estatisticas = resultado['estatisticas']
            print(f"\n📈 Estatísticas:")
            print(f"  Total de publicações: {estatisticas['total_publicacoes']}")
            print(f"  Processadas com sucesso: {estatisticas['processadas']}")
            print(f"  Com erro: {estatisticas['com_erro']}")
            print(f"  Ignoradas: {estatisticas['ignoradas']}")
            
            # Resultados detalhados
            if resultado['resultados']:
                print(f"\n📝 Detalhes das publicações:")
                for r in resultado['resultados']:
                    status_emoji = "✅" if r["status"] == "concluído" else "⚠️" if "erro" in r["status"] else "ℹ️"
                    print(f"  {status_emoji} {r['processo']}: {r['status']}")
                    
                    if r['erros']:
                        for erro in r['erros']:
                            print(f"    ❌ {erro}")
        else:
            print(f"❌ Erro: {resultado.get('erro', 'Erro desconhecido')}")
            
        # Salva os resultados em um arquivo JSON
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"resultado_robo_{timestamp}.json"
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(resultado, f, ensure_ascii=False, indent=2)
        
        print(f"\n💾 Resultados salvos em: {filename}")
        
    except ImportError as e:
        print(f"❌ Erro de importação: {e}")
        print("Verifique se o caminho do robô jurídico está correto e todos os módulos estão instalados.")
        sys.exit(1)
        
    except Exception as e:
        print(f"❌ Erro inesperado: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()