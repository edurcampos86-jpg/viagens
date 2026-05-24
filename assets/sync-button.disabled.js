/**
 * @deprecated 2026-05-24 — Sprint 1 T2
 *
 * Este módulo foi DESATIVADO porque armazenava PAT do GitHub em
 * texto claro no localStorage (CVE interno B-N1, ver SPRINT1_FINDINGS.md).
 *
 * O fluxo correto agora é: exportar trips.json via UI → commit manual
 * no GitHub Web. Ver README.md → "Como salvar edições".
 *
 * Automação segura está planejada para sprint futura via OAuth Device
 * Flow ou GitHub Actions com formulários. Ver docs/BACKLOG.md.
 *
 * NÃO RE-HABILITAR sem revisão de segurança.
 */
