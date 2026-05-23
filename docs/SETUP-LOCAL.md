# Setup do ambiente local (Windows 11)

Procedimento validado em **maio/2026** numa máquina Windows 11 limpa (sem Python, sem ffmpeg, sem GitHub CLI prévios). Use este documento para replicar o ambiente em outra máquina Windows.

> Para macOS/Linux o procedimento é equivalente — substitua `winget` por `brew`/`apt` e os caminhos `C:\Users\<user>\` pelo equivalente Unix.

---

## 1. Pré-requisitos validados

Versões confirmadas funcionando ponta-a-ponta:

| Ferramenta | Versão validada | Como obter |
|---|---|---|
| Git | 2.53.0 (Windows build) | https://git-scm.com/download/win |
| Git LFS | 3.7.1 | já vem com o Git for Windows recente |
| Python | **3.11.9** | `winget install Python.Python.3.11` |
| pip | 26.1.1 (atualizado) | `python -m pip install --upgrade pip` |
| ffmpeg + ffprobe | 8.1.1 (Gyan full build) | `winget install Gyan.FFmpeg` |
| GitHub CLI | 2.92.0 | ver seção 2 — winget MSI pode travar UAC |
| PowerShell | 5.1 (Windows PowerShell) | nativo do Windows 11 |

---

## 2. Bootstrap em ordem

### 2.1 Instalar ferramentas via winget

```powershell
winget install Python.Python.3.11 --accept-source-agreements --accept-package-agreements --silent
winget install Gyan.FFmpeg          --accept-source-agreements --accept-package-agreements --silent
```

Depois de cada instalação, **reabra o terminal** (ou refresca o PATH na sessão atual):

```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```

### 2.2 GitHub CLI — usar zip portátil (winget MSI trava)

O MSI do GitHub CLI requer elevação UAC; em modo `--silent` o prompt UAC não aparece e o `msiexec` fica preso indefinidamente. **Use o zip portátil**:

```powershell
$dest = "C:\Users\$env:USERNAME\AppData\Local\Programs\GitHubCLI"
$url  = "https://github.com/cli/cli/releases/download/v2.92.0/gh_2.92.0_windows_amd64.zip"
$tmp  = "$env:TEMP\gh.zip"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
Expand-Archive  -Path $tmp -DestinationPath $dest -Force
Remove-Item     $tmp -Force

# Adicionar bin\ ao PATH do usuário (persistente)
$bin = "$dest\bin"
$userPath = [System.Environment]::GetEnvironmentVariable("Path","User")
if ($userPath -notlike "*$bin*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$bin", "User")
}
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```

### 2.3 Verificar instalações

```powershell
git --version
git lfs version
python --version
py --version
python -m pip --version
ffmpeg -version | Select-Object -First 1
ffprobe -version | Select-Object -First 1
gh --version
```

Todos devem retornar uma versão (não "comando não encontrado").

### 2.4 Configuração base

```powershell
# Git LFS init global (uma vez por máquina)
git lfs install

# Identidade git (uma vez por máquina)
git config --global user.name  "<seu-handle-github>"
git config --global user.email "<seu-email-github>"

# Autenticação GitHub CLI (uma vez)
gh auth login
# Responder:
#   Where? GitHub.com
#   Protocol? HTTPS
#   Authenticate Git with credentials? Yes
#   How? Login with a web browser
# Copiar código de 8 chars, abrir browser, autorizar.
```

Confirmar:

```powershell
gh auth status
# Esperado: "✓ Logged in to github.com account ..."
```

### 2.5 Clone do repo (fora do iCloud)

```powershell
New-Item -ItemType Directory -Force -Path "C:\Users\$env:USERNAME\Dev"
cd "C:\Users\$env:USERNAME\Dev"
git clone https://github.com/edurcampos86-jpg/viagens.git
cd viagens
git lfs pull
```

> **iCloud + git = conflitos crônicos.** Não clone dentro de `C:\Users\<user>\iCloudDrive\`.

### 2.6 Instalar dependências Python

```powershell
python -m pip install --upgrade pip
python -m pip install -r scripts\requirements-ingest.txt
python -m pip install -r scripts\requirements-validate.txt
python -m pip install -r scripts\requirements-curator.txt   # anthropic — opcional
python -m pip install -r scripts\requirements.txt           # Google APIs legacy
python -m pip install pytest pyyaml
```

`scikit-learn` puxa `numpy` + `scipy` (~80 MB) — pode demorar 2-5 min.

---

## 3. Configuração da chave da Anthropic API

A chave da API da Anthropic (`ANTHROPIC_API_KEY`) é necessária para o curador inteligente (`scripts/requirements-curator.txt`) gerar legendas automatizadas na Fase 3 do pipeline. Sem ela, o resto do pipeline (ingestão, validação, build do site) roda normal — só as etapas que chamam o modelo são puladas/falham.

A chave fica como **variável de ambiente do Windows no escopo `User`** — persistente, isolada por perfil, sem precisar de UAC.

### 3.1 Gerar a chave

1. Acesse https://console.anthropic.com → **Settings → API Keys → Create Key**.
2. Dê um nome (ex.: `viagens-windows-pessoal`) e copie a chave gerada **na hora** — o console só mostra uma vez.
3. Formato esperado: começa com `sk-ant-api03-`, ~108 caracteres.

### 3.2 Salvar como variável de ambiente

**Não cole a chave direto no PowerShell** (fica no histórico em texto). Salve-a num arquivo temporário fora do repo:

```powershell
# 1. Cole a chave nesse arquivo (não comitado, fora do repo)
notepad C:\Users\$env:USERNAME\Dev\anthropic-key.txt
```

Depois rode:

```powershell
# 2. Lê do arquivo e salva no escopo User
$key = (Get-Content "C:\Users\$env:USERNAME\Dev\anthropic-key.txt" -Raw).Trim()
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", $key, "User")
Write-Host "Variavel salva"
```

```powershell
# 3. Apaga o arquivo temporário imediatamente
Remove-Item "C:\Users\$env:USERNAME\Dev\anthropic-key.txt" -Force
Test-Path "C:\Users\$env:USERNAME\Dev\anthropic-key.txt"  # esperado: False
```

### 3.3 Validar (sem imprimir a chave inteira)

```powershell
$saved = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "User")
if ($saved) {
    $masked = $saved.Substring(0, 12) + "..." + $saved.Substring($saved.Length - 4)
    Write-Host "OK - Chave: $masked"
    Write-Host "OK - Tamanho: $($saved.Length) caracteres"
    Write-Host "OK - Prefixo correto: $($saved.StartsWith('sk-ant-api03-'))"
}
```

Esperado: tamanho ~108, prefixo `True`.

### 3.4 Como o Python consome

Em sessões novas do PowerShell, a variável já vem carregada automaticamente (escopo `User` propaga). Para forçar atualização na sessão atual (após salvar):

```powershell
$env:ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "User")
```

No Python (já é o padrão do SDK da Anthropic):

```python
import os
from anthropic import Anthropic
client = Anthropic()  # lê ANTHROPIC_API_KEY do ambiente automaticamente
# ou explicitamente:
key = os.environ.get("ANTHROPIC_API_KEY")
```

Teste rápido:

```powershell
python -c "import os; k = os.environ.get('ANTHROPIC_API_KEY'); print('OK' if k and k.startswith('sk-ant-api03-') else 'FALHA', '- tamanho:', len(k) if k else 0)"
```

Esperado: `OK - tamanho: 108`.

### 3.5 Atualizar a chave (rotação)

Mesmo procedimento da 3.2 — gera chave nova no console, salva no `anthropic-key.txt`, roda os 3 blocos, apaga o arquivo. A nova chave sobrescreve a antiga. **Revogue a antiga no console depois de validar a nova.**

### 3.6 Remover a chave

```powershell
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", $null, "User")
# Confirmar:
[Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "User")  # esperado: vazio
```

### 3.7 Segurança — o que NUNCA fazer

- **NUNCA** comite a chave em arquivo (`.env`, `.py`, `.md`, `.json` — nenhum).
- **NUNCA** cole a chave em chat, e-mail, issue, PR, screenshot.
- **NUNCA** coloque a chave hard-coded em código-fonte — use `os.environ` sempre.
- **NUNCA** use escopo `Machine` (`SetEnvironmentVariable(..., 'Machine')`) — outros usuários da máquina conseguem ler.
- Se a chave vazar (commitada por engano, vista por alguém, screenshot público), **revogue imediatamente** no console (Settings → API Keys → Revoke) e gere uma nova. Vazamento de chave gera custo direto no cartão.
- Se for compartilhar o repo ou colar logs em chats, sempre rode o validador da 3.3 para mascarar antes.

### 3.8 Por que escopo `User`

- **Sem UAC**: escopo `User` não exige elevação — `Machine` exigiria.
- **Isolamento por perfil**: outro usuário Windows na mesma máquina não enxerga.
- **Persistência**: sobrevive a reinicialização e a fechar terminal — não precisa exportar a cada sessão como `$env:VAR = ...`.
- **Compatível com Python/Node/qualquer SDK**: lido como variável de ambiente padrão.

---

## 4. Como rodar os testes

```powershell
cd C:\Users\<user>\Dev\viagens
python -m pytest -v
```

Esperado: **~104 testes passam**. Um teste (`test_optimize_cluster_end_to_end_with_synthetic_photos`) falha no Windows por causa de separador de path — ver seção 6 (Troubleshooting).

Schemas:

```powershell
python scripts\validate_schemas.py
```

Esperado: `Tudo válido.`

---

## 5. Como rodar o pipeline de ingestão

Detalhes completos em [`docs/INGESTAO.md`](INGESTAO.md). Resumo:

```powershell
# Modo álbum (Takeout exportado como Álbuns)
python scripts\ingest_takeout.py --mode album --input .\media-import\ --output .\proposals.json

# Dry-run (não escreve proposals.json)
python scripts\ingest_takeout.py --mode album --dry-run --no-geocode
```

Após inspecionar `proposals.json`, aplicar:

```powershell
python scripts\apply_proposals.py --input .\proposals.json
```

---

## 6. Troubleshooting

### 6.1 `python` abre Microsoft Store

Causa: alias `App Execution Alias` do Windows aponta `python.exe` para um stub da Store quando Python real não está instalado.

Solução: depois de `winget install Python.Python.3.11`, o real Python entra no PATH **antes** do stub e isso some sozinho. Se persistir, desative o alias em **Settings → Apps → Advanced app settings → App execution aliases**.

### 6.2 `gh: command not found` depois de instalar

Causa: PowerShell não recarrega PATH na sessão atual.

Solução:
```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```
Ou fecha e abre o terminal de novo.

### 6.3 winget trava em "Aguardando conclusão de outra instalação"

Causa: `msiexec` anterior preso esperando prompt UAC (em modo `--silent` o UAC não aparece). Acontece com GitHub CLI MSI.

Solução: usar o **zip portátil do gh CLI** (ver 2.2). Para outras MSIs que travarem, abrir Gerenciador de Tarefas e finalizar processos `msiexec`/`winget` velhos.

### 6.4 `git status` mostra arquivos LFS como modified após clone

Causa: o repo tem arquivos em `media/iguacu-2021/` que foram commitados como blobs antes do LFS ser ativado. O filtro LFS smudge insiste em convertê-los em pointers, gerando false-positives.

Solução local (não afeta o remoto):
```powershell
git update-index --skip-worktree media/iguacu-2021/video-03.mp4
git update-index --skip-worktree media/iguacu-2021/video-04-poster.webp
git update-index --skip-worktree media/iguacu-2021/video-04.mp4
```

Para reverter quando for editar esses arquivos:
```powershell
git update-index --no-skip-worktree <arquivo>
```

### 6.5 Teste `test_optimize_cluster_end_to_end_with_synthetic_photos` falha no Windows

Causa: o teste compara `OptimizedItem.src` com `"media/teste-2024/"` (forward slash), mas no Windows `pathlib.Path` produz backslashes — `'media\\teste-2024\\01.webp'`. Bug de portabilidade do teste.

Workaround temporário: rodar `pytest -k "not test_optimize_cluster_end_to_end_with_synthetic_photos"` para pular esse teste.

**Possível impacto em produção:** se o `proposals.json` real produzido no Windows também tiver `\` nos paths, o JSON quebra ao ser renderizado no site (browsers esperam `/`). Antes de aplicar um `proposals.json` gerado no Windows, conferir os campos `src`/`thumb`/`poster` e normalizar com `.replace('\\', '/')` se necessário. Fix definitivo no produto: usar `Path.as_posix()` ao serializar paths.

### 6.6 Token do gh CLI sumiu / `gh auth status` diz "not logged in"

Solução:
```powershell
gh auth login
# refazer o fluxo browser
```

---

## 7. Apêndice — disco e bandwidth

- Clone inicial do repo: **~15 MB** (working tree, sem LFS pull adicional pois objetos LFS estão vazios)
- Dependências Python instaladas (`scikit-learn` + `numpy` + `scipy` + `anthropic` + Google APIs): **~300 MB**
- Espaço livre necessário em `C:\`: **~500 MB** confortável

Limites do GitHub LFS gratuito: **1 GB storage** + **1 GB/mês bandwidth**. Acompanhar em **Settings → Billing → Git LFS data**.
