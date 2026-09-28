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
      name: 'extension-html',
      /**
       * 去掉 crossorigin，并把模块脚本挪回 body 末尾，
       * 避免扩展页等 head 里的大脚本执行完才首屏绘制。
       */
      transformIndexHtml: {
        order: 'post',
        handler(html) {
          const stripped = html.replace(/ crossorigin/g, '')
          const scripts: string[] = []
          const withoutScripts = stripped.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => {
            scripts.push(tag)
            return ''
          })
          if (scripts.length === 0) {
            return stripped
          }
          return withoutScripts.replace('</body>', `${scripts.join('\n    ')}\n  </body>`)
        }
      }
    }
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    modulePreload: false,
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
