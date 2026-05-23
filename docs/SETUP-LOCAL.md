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

## 3. Como rodar os testes

```powershell
cd C:\Users\<user>\Dev\viagens
python -m pytest -v
```

Esperado: **~104 testes passam**. Um teste (`test_optimize_cluster_end_to_end_with_synthetic_photos`) falha no Windows por causa de separador de path — ver seção 5 (Troubleshooting).

Schemas:

```powershell
python scripts\validate_schemas.py
```

Esperado: `Tudo válido.`

---

## 4. Como rodar o pipeline de ingestão

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

## 5. Troubleshooting

### 5.1 `python` abre Microsoft Store

Causa: alias `App Execution Alias` do Windows aponta `python.exe` para um stub da Store quando Python real não está instalado.

Solução: depois de `winget install Python.Python.3.11`, o real Python entra no PATH **antes** do stub e isso some sozinho. Se persistir, desative o alias em **Settings → Apps → Advanced app settings → App execution aliases**.

### 5.2 `gh: command not found` depois de instalar

Causa: PowerShell não recarrega PATH na sessão atual.

Solução:
```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
```
Ou fecha e abre o terminal de novo.

### 5.3 winget trava em "Aguardando conclusão de outra instalação"

Causa: `msiexec` anterior preso esperando prompt UAC (em modo `--silent` o UAC não aparece). Acontece com GitHub CLI MSI.

Solução: usar o **zip portátil do gh CLI** (ver 2.2). Para outras MSIs que travarem, abrir Gerenciador de Tarefas e finalizar processos `msiexec`/`winget` velhos.

### 5.4 `git status` mostra arquivos LFS como modified após clone

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

### 5.5 Teste `test_optimize_cluster_end_to_end_with_synthetic_photos` falha no Windows

Causa: o teste compara `OptimizedItem.src` com `"media/teste-2024/"` (forward slash), mas no Windows `pathlib.Path` produz backslashes — `'media\\teste-2024\\01.webp'`. Bug de portabilidade do teste.

Workaround temporário: rodar `pytest -k "not test_optimize_cluster_end_to_end_with_synthetic_photos"` para pular esse teste.

**Possível impacto em produção:** se o `proposals.json` real produzido no Windows também tiver `\` nos paths, o JSON quebra ao ser renderizado no site (browsers esperam `/`). Antes de aplicar um `proposals.json` gerado no Windows, conferir os campos `src`/`thumb`/`poster` e normalizar com `.replace('\\', '/')` se necessário. Fix definitivo no produto: usar `Path.as_posix()` ao serializar paths.

### 5.6 Token do gh CLI sumiu / `gh auth status` diz "not logged in"

Solução:
```powershell
gh auth login
# refazer o fluxo browser
```

---

## 6. Apêndice — disco e bandwidth

- Clone inicial do repo: **~15 MB** (working tree, sem LFS pull adicional pois objetos LFS estão vazios)
- Dependências Python instaladas (`scikit-learn` + `numpy` + `scipy` + `anthropic` + Google APIs): **~300 MB**
- Espaço livre necessário em `C:\`: **~500 MB** confortável

Limites do GitHub LFS gratuito: **1 GB storage** + **1 GB/mês bandwidth**. Acompanhar em **Settings → Billing → Git LFS data**.
