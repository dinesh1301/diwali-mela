import { defineConfig } from 'vite';
import { handle } from './server/topmate.mjs';
import { attachRealtime } from './server/realtime.mjs';

/** Serves the Topmate profile proxy and the realtime (multiplayer) socket during dev and preview. */
const melaServer = () => {
  // Returning nothing matters: a value returned from configureServer is treated as a post hook.
  const mount = (server) => {
    server.middlewares.use('/api/topmate', (req, res) => handle(req, res));
    if (server.httpServer) attachRealtime(server.httpServer, '/ws');
  };
  return { name: 'mela-server', configureServer: mount, configurePreviewServer: mount };
};

// Testing links come through a Cloudflare quick tunnel; Vite refuses unknown hostnames otherwise.
const TUNNEL_HOSTS = ['.trycloudflare.com'];

export default defineConfig({
  plugins: [melaServer()],
  server: { allowedHosts: TUNNEL_HOSTS },
  preview: { allowedHosts: TUNNEL_HOSTS },
  build: {
    // WebGL2 browsers from 2021 on (iOS 15+, Chrome/Android 100+): no down-levelling of modern syntax.
    target: ['es2022', 'chrome100', 'safari15', 'firefox100'],
    // three.js is ~85% of the bundle; a chunk of its own stays cached across deploys of the game code.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three/ }] },
      },
    },
  },
});
