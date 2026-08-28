import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDir } from './config.js';

// Persistencia simple de estado en JSON. Se escribe de forma atomica
// (archivo temporal + rename) para evitar corrupcion ante cortes.
class JsonStore {
  constructor(fileName, initial) {
    ensureDataDir();
    this.path = path.join(config.dataDir, fileName);
    this.state = this.#load(initial);
  }

  #load(initial) {
    try {
      const raw = fs.readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...initial, ...parsed };
    } catch {
      return { ...initial };
    }
  }

  save() {
    const tmp = this.path + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.path);
  }

  get value() {
    return this.state;
  }
}

export default JsonStore;