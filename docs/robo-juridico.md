# Robô Jurídico - Integração com a Plataforma

O robô jurídico foi integrado à plataforma como um serviço API, permitindo a automação do monitoramento de publicações jurídicas e criação de rascunhos de e-mails para clientes.

## Funcionalidades

- **Monitoramento Automático**: Consulta a API do DJEN/CNJ para novas publicações
- **Identificação de Clientes**: Relaciona processos com clientes na planilha
- **Criação de Rascunhos**: Gera e-mails no Gmail com informações das publicações
- **Armazenamento de Documentos**: Salva PDFs no Google Drive (opcional)

## Configuração

### Variáveis de Ambiente

As seguintes variáveis de ambiente devem ser configuradas no arquivo `.env`:

```env
# Gmail (IMAP) - Para criação de rascunhos de e-mail
EMAIL_LOGIN=seu_email@gmail.com
SENHA_APP=sua_senha_de_aplicativo
IMAP_SERVER=imap.gmail.com
PASTA_DRAFTS=[Gmail]/Rascunhos

# Planilha de clientes
ARQUIVO_CLIENTES=clientes.xlsx

# API do DJEN / CNJ
DJEN_API_URL=https://comunicaapi.pje.jus.br/api/v1/comunicacao
DJEN_TOKEN=seu_token_djen

# Google Drive (opcional)
SALVAR_NO_DRIVE=false
PASTA_DRIVE_ID=sua_id_da_pasta_no_drive
```

### Planilha de Clientes

A planilha de clientes (`clientes.xlsx`) deve conter as seguintes colunas:

- `nome_completo`: Nome completo do cliente
- `email`: E-mail do cliente
- `processos`: Lista de números de processos do cliente (separados por vírgula)

## Uso

### Via Interface Web

1. Acesse a seção de Robô Jurídico na interface
2. Verifique o status de configuração
3. Execute o robô manualmente quando necessário

### Via API

#### Verificar Status

```bash
curl -X GET http://localhost:5000/api/robo-juridico/status \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..."
```

#### Executar o Robô

```bash
curl -X POST http://localhost:5000/api/robo-juridico/executar \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=..."
```

## Estrutura de Resposta

### Status

```json
{
  "success": true,
  "data": {
    "status": "ativo",
    "arquivos": {
      "main.py": true,
      "config.py": true,
      // ...
    },
    "configuracoes": {
      "EMAIL_LOGIN": true,
      "SENHA_APP": true,
      // ...
    },
    "todos_configurados": true,
    "mensagem": "Robô jurídico configurado corretamente"
  }
}
```

### Execução

```json
{
  "success": true,
  "data": {
    "message": "Processamento concluído: 5 processadas, 1 com erro, 2 ignoradas",
    "results": [
      {
        "processo": "0000000-00.0000.0.00.0000",
        "status": "concluído",
        "acoes_realizadas": [
          "extração de dados da sessão",
          "criação de rascunho de e-mail"
        ]
      }
    ],
    "statistics": {
      "total_publicacoes": 8,
      "processadas": 5,
      "com_erro": 1,
      "ignoradas": 2
    },
    "timestamp": "2024-01-01T12:00:00"
  }
}
```

## Solução de Problemas

### Robô não está ativo

Verifique se todas as variáveis de ambiente estão configuradas corretamente, especialmente:

- `EMAIL_LOGIN` e `SENHA_APP` para acesso ao Gmail
- `DJEN_TOKEN` para acesso à API do DJEN
- `ARQUIVO_CLIENTES` aponta para um arquivo existente

### Erros de autenticação no Gmail

Certifique-se de que:

1. A autenticação de dois fatores está ativada na conta Google
2. A senha de aplicativo foi gerada corretamente
3. O login está correto (deve ser o e-mail completo)

### Erros na API do DJEN

Verifique se o token do DJEN é válido e se tem permissão para acessar a API.

## Próximos Passos

- Agendamento automático de execução
- Interface web para configuração do robô
- Relatórios detalhados de execução
- Integração com outros serviços de e-mail