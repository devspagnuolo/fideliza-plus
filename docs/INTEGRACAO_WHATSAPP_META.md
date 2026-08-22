# Integração oficial com WhatsApp (Meta Cloud API)

## Finalidade inicial

O Fideliza+ usa o WhatsApp apenas para recuperação de senha por código temporário. O e-mail permanece disponível como contingência. O código:

- possui seis dígitos;
- expira em 10 minutos;
- só pode ser utilizado uma vez;
- aceita no máximo cinco tentativas;
- invalida códigos anteriores e encerra as sessões existentes após a troca da senha.

O canal só aparece no portal quando as credenciais da Meta estão configuradas.

## Configuração na Meta

1. Criar ou utilizar o portfólio empresarial do Fideliza Plus no Meta Business Manager.
2. Adicionar o produto **WhatsApp** a um aplicativo empresarial.
3. Criar a WhatsApp Business Account e cadastrar o número remetente.
4. Criar um usuário do sistema com permissão permanente para o aplicativo.
5. Gerar um token permanente com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
6. Criar e submeter o modelo de autenticação `fideliza_password_reset`, no idioma `pt_BR`.
7. Inserir as credenciais no serviço da API no Render e realizar novo deploy.

## Modelo recomendado

- Categoria: **Authentication**.
- Nome: `fideliza_password_reset`.
- Idioma: `Português (BR)`.
- Conteúdo: código de verificação com variável `{{1}}`.
- Validade operacional no Fideliza+: 10 minutos.

Se o modelo aprovado pela Meta exigir um botão parametrizado, configure `WHATSAPP_OTP_BUTTON_SUBTYPE` conforme o subtipo exibido no Gerenciador do WhatsApp. Sem essa variável, o Fideliza+ envia apenas o componente de corpo com o código.

## Variáveis do Render

```ini
WHATSAPP_ACCESS_TOKEN=<token permanente>
WHATSAPP_PHONE_NUMBER_ID=<id do número remetente>
WHATSAPP_BUSINESS_ACCOUNT_ID=<id da conta do WhatsApp Business>
WHATSAPP_PASSWORD_RESET_TEMPLATE=fideliza_password_reset
WHATSAPP_TEMPLATE_LANGUAGE=pt_BR
WHATSAPP_OTP_BUTTON_SUBTYPE=
META_GRAPH_VERSION=v25.0
```

Os três identificadores e o token devem ser tratados como segredos. Nunca devem ser armazenados no Git, exibidos no frontend ou enviados em capturas de tela.

## Homologação

1. Confirmar que o modelo está com status **Approved**.
2. Confirmar que o número está conectado e com qualidade aceitável.
3. Cadastrar um cliente piloto com CPF e celular válidos.
4. Abrir `Esqueci minha senha`, selecionar WhatsApp e aceitar o envio do código.
5. Confirmar a entrega e redefinir a senha.
6. Validar que a senha anterior deixou de funcionar e que o código não pode ser reutilizado.
7. Conferir o identificador `wamid` e o status da mensagem nos logs da Meta.

## Privacidade

O envio é iniciado pela própria cliente e exige consentimento explícito na tela. O registro de consentimento guarda finalidade, versão dos documentos, data, IP e agente do navegador. O telefone não é compartilhado entre lojas.
