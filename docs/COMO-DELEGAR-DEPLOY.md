# Como delegar o deploy do backend — passo a passo simples

Você não precisa fazer o deploy sozinho nem ser desenvolvedor. Este guia te ensina a **delegar** para um agente de IA ou um amigo dev.

---

## Opção 1 — Delegar para outro agente Claude (Cowork ou Code)

### Pré-requisitos do agente delegado

A pessoa/agente que vai executar precisa ter:
- ✅ Um computador com terminal (Mac ou Linux)
- ✅ Acesso ao seu repo (`edurcampos86-jpg/viagens`)
- ✅ ~45 min livres
- ✅ Você por perto para responder perguntas (criar contas que só você pode criar)

### Os 3 passos

**1.** Abra uma sessão nova de Claude Cowork na sua máquina local.

**2.** Cole para o agente esta mensagem inicial:

> Olá. Quero delegar o deploy do backend do meu projeto Portal de Viagens v2.0.
>
> O repositório é `edurcampos86-jpg/viagens`. O código já está em `main`, mergeado pelo PR #34.
>
> O passo a passo completo está em `docs/COWORK-PROMPT.md` — abra esse arquivo e siga exatamente o que está dentro do bloco `## 🚀 PROMPT`.
>
> Eu sou o dono mas não sou desenvolvedor. Por favor:
> - Me explique cada passo em português simples antes de executar.
> - Me pergunte uma coisa por vez.
> - Nunca me peça para colar credenciais em texto aberto — sempre me ensine a setar via terminal local.
> - Vamos com calma. Tempo total esperado: 45 minutos.

**3.** Acompanhe. O agente vai te pedir:
- Para criar conta no Supabase (gratuito) → copiar URL + chave
- Para criar OAuth Client no Google Cloud → copiar client_id + secret
- Para criar API key na Anthropic → copiar key
- Para criar API key na Kiwi Tequila → copiar key
- Para rodar uns comandos no terminal seguindo o que ele dita

Você só precisa **executar o que o agente pede** e **avisar quando terminou** cada passo.

---

## Opção 2 — Pedir para um amigo dev

Manda esta mensagem:

> Oi! Tenho um projeto pessoal (Portal de Viagens — `edurcampos86-jpg/viagens`) com backend Supabase pronto pra deploy. O código todo está em `main`. Toda a instrução está em `docs/DEPLOY.md` (manual) ou `docs/COWORK-PROMPT.md` (prompt para agente).
>
> Esforço estimado: 30-45 minutos. Custo de operação: < US$ 5/mês.
>
> O que preciso de você:
> - Criar conta Supabase (free tier), Google OAuth Client, Anthropic, Kiwi Tequila — eu te passo se você não tiver
> - Setar secrets + rodar `supabase functions deploy` (4 funções)
> - Configurar 3 cron jobs no SQL Editor
> - Me confirmar que rodou
>
> Posso pagar uma cerveja em troca. 🍻

---

## Opção 3 — Fazer sozinho com paciência

Se quiser tentar você mesmo, abra `docs/DEPLOY.md` e siga os 10 passos. Cada passo tem o comando exato pra colar no terminal. Estimativa: 1h se nunca usou Supabase antes.

---

## O que você ganha quando o deploy estiver pronto

Visualmente no site (todos os badges no canto inferior direito):

| Badge | O que passa a funcionar |
|---|---|
| 📥 **Sugestões do Gmail** | Lista de reservas TAP/Booking/Latam extraídas automaticamente do seu e-mail |
| 💸 **Otimizador de Bolso** | Alertas diários quando voos planejados caem de preço |
| 🍽️ **Itinerário Concierge** (dentro do editor de uma viagem) | Roteiro de 7 dias gerado pelo Claude com base no seu histórico |
| 📝 **Cronista da Memória** (dentro do editor) | Gera memória + 3 legendas de Instagram a partir de 4 perguntas |

Antes do deploy, esses 4 botões existem mas exibem "ainda não configurado".

---

## Em caso de problema

Se o agente/dev travar em algum passo:
1. **Não force.** Os passos são independentes — dá pra parar no meio e voltar depois.
2. **Pergunta no GitHub Discussions** ou abre issue no próprio repo.
3. **Console do browser** (F12 → Console) mostra erros úteis pro dev.
4. **Pode reverter:** se algo der muito errado, basta apagar o projeto Supabase. O site público continua intocado.
