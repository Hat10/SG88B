import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import vaer from './api/vaer'
import kalender from './api/kalender'
import price from './api/price'
import tommeplan from './api/tommeplan'
import nordlys from './api/nordlys'

// Adapts a Node http response to the minimal Vercel-style `res` API that the
// /api handlers use, so the dev server runs the exact same handler code that
// ships to production — no parallel copy in this file that can drift.
function vercelRes(res: any) {
  return {
    statusCode: 200,
    status(code: number) { this.statusCode = code; return this; },
    setHeader(key: string, value: string) { res.setHeader(key, value); return this; },
    json(body: unknown) {
      res.writeHead(this.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    },
  };
}

export default defineConfig(({ mode }) => {
  // Vite only auto-exposes VITE_-prefixed vars to client code (import.meta.env).
  // The /api handlers below run as plain Node middleware in this same process
  // and read process.env directly (process.env.CAL_ANDREAS etc.) — without
  // this, .env.local's non-VITE_ vars are invisible to them in dev, and every
  // calendar feed silently comes back empty.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        manifest: {
          name: 'SG88B',
          short_name: 'SG88B',
          description: 'SG88B — Andreas & Taran',
          theme_color: '#ffffff',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        },
      }),
      {
        name: 'api-routes',
        configureServer(server) {
          server.middlewares.use('/api/vaer',      (req: any, res: any) => { void vaer(req, vercelRes(res)); });
          server.middlewares.use('/api/kalender',  (req: any, res: any) => { void kalender(req, vercelRes(res)); });
          server.middlewares.use('/api/tommeplan', (req: any, res: any) => { void tommeplan(req, vercelRes(res)); });
          server.middlewares.use('/api/nordlys',   (req: any, res: any) => { void nordlys(req, vercelRes(res)); });
          server.middlewares.use('/api/price',    (req: any, res: any) => {
            const url = new URL(req.url, 'http://localhost').searchParams.get('url') ?? undefined;
            void price({ query: { url } } as any, vercelRes(res));
          });
        },
      },
    ],
  };
})
