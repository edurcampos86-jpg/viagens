import { defineConfig } from 'vite';

// Vite config conservador: mantém index.html na raiz, preserva pasta `assets/`
// e diretórios estáticos atuais (data/, icons/, previews/). O build emite em `dist/`
// mas o site continua sendo servido por GitHub Pages a partir da raiz — o build
// é opcional e usado apenas para validação local / dev server com HMR.
export default defineConfig({
  root: '.',
  // Não definimos `publicDir` porque os arquivos públicos já são referenciados
  // por caminhos relativos (assets/, icons/, data/) no index.html. Vite copia
  // dependências do grafo de módulos automaticamente.
  publicDir: false,
  server: {
    port: 5173,
    open: false,
    fs: {
      // Permite servir arquivos fora do root (necessário para data/ e icons/).
      strict: false,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: 'index.html',
      },
    },
  },
});
