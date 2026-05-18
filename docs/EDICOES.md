# Edições no site — fluxo de export manual

O site (Modo Planejamento e Dashboard) deixa você **mover viagens entre
status** clicando no menu `⋯` do card. As edições ficam salvas no seu
navegador (`localStorage`) e precisam ser **exportadas para o repositório**
para virarem permanentes e aparecerem nos agentes (Auditor, Curador).

## Como funciona

```
Você edita no site          → localStorage acumula edições
   │
   ▼
Badge no header             → "N edições" aparece e fica visível
   │
   ▼
Clica no badge              → abre dialog "Exportar edições"
   │
   ▼
Baixa trips.json            → arquivo com edições já aplicadas
   │
   ▼
Cola no GitHub Web          → substitui o conteúdo de data/trips.json
   │
   ▼
Volta no site, "Descartar"  → limpa localStorage (edições já estão no repo)
```

## Passo a passo

### 1. Editar no site

No **Modo Planejamento** (`#planejamento`):

1. Em cada card, clica no botão `⋯` no canto superior esquerdo
2. Escolhe "Mover para [status]"
3. O card "salta" para a coluna correspondente

No **Dashboard** (`#dashboard`): a mesma coisa funciona nos mini-cards do
kanban compacto.

Edições suportadas hoje:
- ✅ Mover viagem entre `planned` / `em_planejamento` / `wishlist`
- ⏳ (futuro) marcar checklist, adicionar decisão, editar memória, etc.

### 2. Conferir o que vai ser exportado

Quando há edições pendentes, aparece um badge **"N edições"** no header
(canto direito, ao lado do toggle ☾/☀).

Clica no badge → abre o dialog de export, que lista:
- Quantas edições estão pendentes
- Qual viagem, qual mudança

### 3. Baixar o trips.json

No dialog, clica **"📥 Baixar trips.json"**.

O arquivo baixado é o **trips.json completo** já com as edições aplicadas
em cima da versão atual do repo (fez um `fetch` fresh + aplica overrides).

### 4. Aplicar no GitHub Web

Tem duas formas:

#### Opção A: copiar e colar (recomendado)

1. Abre o arquivo `trips.json` baixado num editor de texto
2. Seleciona tudo (Ctrl+A) e copia (Ctrl+C)
3. Vai em https://github.com/edurcampos86-jpg/viagens/blob/main/data/trips.json
4. Clica no ícone do **lápis** (canto superior direito do arquivo)
5. Seleciona tudo (Ctrl+A) e cola (Ctrl+V)
6. Vai pro fim, mensagem de commit: `edições do site — YYYY-MM-DD` (ou só "edições")
7. **Commit changes**

#### Opção B: upload pelo GitHub Web

1. Vai em https://github.com/edurcampos86-jpg/viagens/tree/main/data
2. Clica em **Add file → Upload files**
3. Arrasta o `trips.json` baixado
4. GitHub detecta como substituição
5. Mensagem de commit e Commit

### 5. Limpar o localStorage

Volta no site e **abre o dialog de export novamente**.

Clica **"🗑 Descartar edições locais"** → confirma.

Isso limpa o `localStorage`. As edições já estão no repositório (passo 4),
então o site vai carregar elas do `trips.json` na próxima vez (e o badge
some).

> ⚠ **Não pule o passo 5.** Senão as edições ficam acumuladas no navegador
> e quando você editar de novo, vai exportar tudo de novo (criando um
> arquivo desatualizado se sync rodar entre o export e o commit).

## Por que esse fluxo (e não OAuth)?

Pros:
- ✅ Zero setup — não precisa registrar OAuth App nem configurar token
- ✅ Você revisa cada commit pelo GitHub Web antes de mesclar
- ✅ Funciona em qualquer dispositivo sem login
- ✅ Sem cota de API, sem chave que pode vazar

Cons:
- ❌ Você tem que fazer copy-paste a cada vez
- ❌ Risco de conflito se `sync.py` (auto-import Gmail) rodar entre exportar e commitar

Se a fricção do copy-paste te incomodar muito no uso real, podemos
implementar **OAuth GitHub** numa fase futura — daí o site comita
automaticamente.

## Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Esquecer de "Descartar edições locais" após commit | Próximo export vai re-aplicar edições já no repo (idempotente, mas polui o diff). Limpe sempre. |
| Sync auto rodando entre exportar e commitar | Verifica `atualizado_em` no JSON antes de commitar. Se sync rodou, baixa de novo. |
| Trocar de dispositivo perde edições não exportadas | localStorage é por navegador. Exporte antes de trocar. |
| Múltiplas abas com edições diferentes | A última a salvar ganha. Use uma aba só ao editar. |

## Edições no localStorage — chave e formato

Chave: `viagens-trip-state-v1`

Formato:
```json
{
  "sp-junho-2026": {
    "statusOverride": "planned",
    "notes": "...",
    "checklist": { "passport": true, "visa": false }
  },
  "japao-2027": {
    "statusOverride": "em_planejamento"
  }
}
```

Hoje só `statusOverride` é exportado para o `trips.json`. Outros campos
(`notes`, `checklist`) ainda ficam no localStorage e podem ser exportados
em fases futuras quando o schema do `trips.json` tiver lugar para eles
(o schema já prevê — veja `data/schemas/trip.schema.json`, campo
`checklist[]` com `feito: bool`).

## Você quer ver as edições brutas?

DevTools → Application (Chrome) ou Storage (Firefox) → Local Storage →
chave `viagens-trip-state-v1`. Pode editar/limpar manualmente também.
