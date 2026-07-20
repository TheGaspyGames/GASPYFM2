import fs from 'fs';
import path from 'path';

export class JsonStore {
  constructor(filename, fallback) {
    this.file = path.resolve(process.cwd(), 'src/data', filename);
    this.fallback = fallback;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, JSON.stringify(fallback, null, 2));
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return structuredClone(this.fallback);
    }
  }

  write(data) {
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
  }
}
