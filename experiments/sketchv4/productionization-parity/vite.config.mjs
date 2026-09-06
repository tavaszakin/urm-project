import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default {
  root: path.resolve(HERE, "../../.."),
  cacheDir: path.join(os.tmpdir(), "urm-sketchv4-productionization-parity-vite"),
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
  },
};
