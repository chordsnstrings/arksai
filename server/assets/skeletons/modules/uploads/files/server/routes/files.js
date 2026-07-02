// Authed uploads into data/uploads/ (the data/ convention survives republish). Filenames
// are server-generated (never trust client names); listing + download are auth-gated.
import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(dir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: dir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${nanoid(8)}${path.extname(file.originalname || '').slice(0, 10)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const r = Router();
r.get('/', (_req, res) => {
  const rows = fs.readdirSync(dir).map((f) => {
    const st = fs.statSync(path.join(dir, f));
    return { name: f, bytes: st.size, uploadedAt: st.mtimeMs };
  }).sort((a, b) => b.uploadedAt - a.uploadedAt);
  res.json(rows);
});
r.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file received (multipart field name: "file")' });
  res.json({ name: req.file.filename, bytes: req.file.size });
});
r.get('/:name', (req, res) => {
  const safe = path.basename(req.params.name);
  const abs = path.join(dir, safe);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: 'not_found' });
  res.sendFile(abs);
});
export default r;
