# Política de Privacidade

**Data de vigência:** `<EFFECTIVE DATE>`

O PickForge é uma ferramenta de desenvolvimento desktop com abordagem
*local-first* (tudo primeiro no seu computador). Esta política explica, de forma
direta, o que permanece na sua máquina, o pequeno conjunto de coisas que sai
dela, quem as trata e quais direitos você tem sob a LGPD (Lei nº 13.709/2018).

Controlador: **ELBERTE PLINIO GOIS VIEIRA FILHO DESENVOLVIMENTO DE SOFTWARE
LTDA**, CNPJ **63.103.885/0001-74**, nome fantasia **Elberte Software**. Contato:
**legal@pickforge.dev** (privacidade/LGPD).

## Resumo

- O PickForge não envia seu código, conversas, voz, capturas de tela ou
  configurações locais não sincronizadas aos próprios serviços. Um agente ou
  provedor BYO pode receber prompts e contexto de projeto/ferramentas que você
  autorizar pelo modelo de permissões desse provedor, sob os termos dele.
- Se você criar uma conta, guardamos o mínimo necessário para operá-la e, se
  comprar o Pro, seus créditos. Versões de release também podem enviar relatórios
  de falha redigidos, salvo se você os desativar nas Configurações.
- O roteamento hospedado envia o comando fornecido por você mais um pequeno
  contexto anexado e redigido — somente quando você opta por isso, a cada ação.
- Você pode exportar ou excluir seus dados dentro do aplicativo a qualquer
  momento.

## O que o PickForge mantém local

Por design, o PickForge não transmite os itens a seguir aos serviços operados
pelo PickForge como parte do fluxo local principal:

- Código-fonte e conteúdo de arquivos.
- Transcrições de conversas e histórico de execuções dos agentes.
- Áudio de voz e sua transcrição — o ditado é transcrito no próprio dispositivo
  pelo whisper.cpp.
- Capturas de tela e telas de dispositivo capturadas.
- Caminhos locais de projetos, números de série de dispositivos, nomes de host
  locais e endereços IP de tailnet.
- Quaisquer chaves de API próprias (BYO) e configurações de CLI que você use para
  roteamento de IA local.

Se você usar um agente ou roteador BYO, esse provedor poderá receber prompts,
texto de comando do Operator e contexto de projeto/ferramentas que você autorizar
pelo modelo de permissões dele, sob sua conta e os termos do provedor. O
PickForge não recebe nem retém esse pacote BYO em seu backend. A sincronização de
conta, os recursos hospedados, os relatórios de falha e a verificação de
atualizações abaixo são as outras exceções restritas ao limite local.

## O que coletamos quando você entra na conta

Você pode usar o PickForge localmente sem conta. Ao criar uma, tratamos — por
meio do nosso operador Supabase:

- **E-mail e identidade OAuth** do login com Google ou GitHub, conforme o
  provedor escolhido.
- **Perfil**: nome de exibição e avatar.
- **Direitos de acesso (entitlements)**: se o Pro está ativo para você.
- **Registro de créditos**: suas compras e usos de crédito pré-pago — valores,
  data/hora e referências do Stripe.
- **Configurações sincronizadas**: exatamente quatro grupos permitidos —
  configurações do app, configuração do operator, atalhos de teclado e vínculos
  remotos. Um vínculo remoto inclui o nome-base do projeto, o nome de host na
  tailnet e o caminho absoluto da raiz remota do projeto. A sincronização é
  opcional, e cada grupo passa por uma verificação de remoção de segredos antes
  de sincronizar, de modo que tokens e chaves não saiam junto.
- **Contadores de limite de uso (rate limit)** e **sinais de segurança/auditoria**
  para manter o serviço protegido.

## Roteamento BYO escolhido por você

Quando o Operator não pode usar seu analisador determinístico local e você
seleciona um roteador BYO, ele envia o texto do comando e o prompt/esquema de
roteamento pelo CLI/provedor escolhido. Um provedor local, como o Ollama, pode
manter essa solicitação no dispositivo; um provedor em nuvem a trata sob sua
conta e os próprios termos. O PickForge não recebe nem armazena o pacote de
roteamento BYO em seu backend.

## Recursos Pro que enviam dados (opcionais)

Estes vêm desativados por padrão, estão disponíveis no Pro e só são executados
quando você os escolhe:

- **Roteamento hospedado do Operator.** Quando você seleciona deliberadamente o
  roteador "Hospedado" para um comando, a solicitação passa pela Edge Function do
  Supabase operada pelo PickForge e segue para a OpenAI, que transforma seu
  comando em linguagem natural em uma única ação do app. O próprio comando é
  enviado como foi digitado. O contexto anexado limita-se ao nome de exibição do
  projeto, títulos de conversas visíveis e rótulos de widgets; caminhos de
  arquivos, nomes de host, domínios, endereços IP e números de série são removidos
  desse contexto anexado por uma redação garantida por testes. O corpo da
  solicitação não é armazenado no registro de créditos do PickForge; o registro
  guarda apenas o nome da ação, a contagem de tokens e o custo. [OWNER/LAWYER:
  confirmar a retenção operacional do Supabase e da OpenAI.] O caminho
  determinístico padrão permanece local quando consegue compreender o comando.
- **Voz hospedada** (atualmente atrás de um *feature flag* / futura). Quando você
  usa a voz hospedada, o áudio é transmitido para a API Realtime da OpenAI durante
  aquela sessão. O caminho de voz padrão permanece no dispositivo — veja "O que
  o PickForge mantém local".

## Cobrança

Os pagamentos são processados pela Stripe. **Os dados do cartão são tratados
inteiramente pela Stripe; o PickForge nunca vê nem armazena os números do seu
cartão.** A Stripe mantém o cadastro do cliente e seu histórico de pagamentos e
faturas. Do nosso lado, armazenamos apenas o vínculo com o identificador de
cliente da Stripe e o registro de créditos descrito acima.

## Relatórios de erro e verificação de atualizações

- **Relatórios de erro e falha.** As versões de release enviam relatórios
  redigidos de erro/falha por padrão, por meio do Sentry, para nos ajudar a
  corrigir problemas de estabilidade e segurança. O nome do servidor e os
  *breadcrumbs* são apagados antes de os relatórios saírem do processo, e não
  adicionamos intencionalmente código-fonte, transcrições, prompts, capturas de
  tela, caminhos, números de série ou identificadores de usuário. Despejos de
  falha nativos ainda podem conter fragmentos da memória do processo no momento da
  falha, e uma mensagem de erro pode, ocasionalmente, referenciar um caminho. Você
  pode desativar isso em **Configurações → Relatórios de falha**.
- **Verificação de atualizações.** Ao iniciar, o PickForge pergunta ao GitHub
  Releases se existe uma versão mais nova. Isso carrega apenas metadados de versão
  — nenhum dado de conta e nenhum código-fonte sai da sua máquina.

## Quem trata seus dados, e onde

Alguns fluxos de serviço podem envolver tratamento fora do Brasil.
[OWNER/LAWYER: antes da publicação, verificar quais fluxos configuram
transferência internacional e declarar o mecanismo válido do Art. 33 da LGPD
para cada um.] Os documentos dos fornecedores abaixo são listados para
transparência e análise jurídica; a mera listagem não estabelece, por si só, um
mecanismo válido de transferência.

| Fornecedor / destinatário | O que trata | Documento do fornecedor |
| --- | --- | --- |
| Supabase | Conta, autenticação, direitos de acesso, créditos, configurações sincronizadas, limites de uso, auditoria e tratamento transitório pela Edge Function do roteador hospedado | [Acordo de Tratamento de Dados](https://supabase.com/downloads/docs/Supabase%2BDPA%2B260601.pdf) |
| Stripe | Pagamentos, cartões, faturas, cadastro do cliente | [Acordo de Tratamento de Dados](https://stripe.com/legal/dpa) |
| OpenAI | Roteamento hospedado do Operator; voz hospedada (com flag) | [Aditivo de Tratamento de Dados](https://openai.com/policies/data-processing-addendum/) |
| Sentry | Relatórios de erro / falha | [Aditivo de Tratamento de Dados](https://sentry.io/legal/dpa/) |
| GitHub | Provedor de identidade OAuth quando escolhido; transporte anônimo da verificação de atualização | [Declaração Geral de Privacidade do GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) |

## Bases legais (Art. 7)

- **Execução de contrato.** Sua conta, cobrança, direitos de acesso, créditos e
  sincronização de configurações — os dados necessários para prestar o serviço que
  você contratou.
- **Legítimo interesse.** Segurança, prevenção a fraudes, limitação de uso,
  registros de auditoria, relatórios de erro/falha e entrega de atualizações.
- **Consentimento.** O roteamento hospedado do Operator e a voz hospedada são
  recursos Pro opcionais que você ativa. Se algum dia oferecermos comunicações de
  marketing, elas exigirão consentimento separado.

## Seus direitos (Art. 18)

Sob a LGPD, você pode confirmar se tratamos seus dados, acessá-los, corrigi-los,
solicitar anonimização ou exclusão, pedir portabilidade e obter informações sobre
como seus dados são compartilhados. Você pode exercer esses direitos diretamente:

- **Excluir sua conta** dentro do aplicativo. Isso apaga todos os dados pessoais
  do lado do PickForge — perfil, direitos de acesso, configurações sincronizadas e
  registro de créditos — por cascata no banco de dados, e exclui seu cadastro de
  cliente na Stripe. Quaisquer créditos restantes são perdidos. Observe que a
  Stripe, como processadora de pagamentos, mantém seus próprios registros de
  transação para cumprir suas obrigações legais e fiscais.
- **Exportar seus dados** dentro do aplicativo — um arquivo JSON portátil com seu
  perfil, direitos de acesso, registro de créditos e configurações sincronizadas.
- **Falar conosco** em **legal@pickforge.dev** para qualquer outra
  solicitação. Este é o nosso canal de privacidade. [OWNER/LAWYER: confirmar se
  é necessária a nomeação formal de encarregado (DPO) ou se aplica a dispensa
  para agentes de tratamento de pequeno porte.]

## Retenção

- Os dados de conta são mantidos até você excluir sua conta.
- A Stripe retém seus registros de pagamento pelo tempo exigido por suas próprias
  obrigações legais e fiscais.
- Os dados locais permanecem na sua máquina, sob seu controle; não definimos
  retenção sobre eles porque nunca os recebemos.

## Crianças e adolescentes

O PickForge é uma ferramenta profissional de desenvolvimento e não é direcionada a
crianças.

## Alterações nesta política

Se fizermos mudanças relevantes, atualizaremos esta página e sua data de vigência
e, quando apropriado, avisaremos você no aplicativo. A versão atual está sempre em
https://pickforge.dev/privacy.

## Contato

**legal@pickforge.dev** — Controlador: **ELBERTE PLINIO GOIS VIEIRA FILHO
DESENVOLVIMENTO DE SOFTWARE LTDA**, CNPJ **63.103.885/0001-74**.
Encarregado (DPO): [OWNER/LAWYER: confirmar nomeação ou dispensa].
