import sharp from 'sharp';
import fs from 'fs';
const dir = 'assets/work';
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jpg'))) {
  const src = `${dir}/${f}`;
  const out = src.replace(/\.jpg$/, '.webp');
  const width = f.includes('-mobile') ? 480 : 1000;
  await sharp(src).resize({ width, withoutEnlargement: true }).webp({ quality: 76 }).toFile(out);
  fs.unlinkSync(src);
  console.log(out, (fs.statSync(out).size / 1024).toFixed(0) + 'KB');
}
