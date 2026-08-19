import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/**
 * 将 extract / sandbox 打成扩展可加载的静态资源。
 * background.js 与 manifest.json 放在 public/，构建时原样拷到 dist 根目录。
 */
export default defineConfig({
  base: './',
  publicDir: 'public',
  plugins: [
    {
      name: 'strip-crossorigin',
      transformIndexHtml(html) {
        return html.replace(/ crossorigin/g, '')
      }
    }
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        extract: resolve(__dirname, 'extract.html'),
        sandbox: resolve(__dirname, 'sandbox.html')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
})
