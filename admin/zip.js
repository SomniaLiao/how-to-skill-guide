// 下載用 ZIP 的產生（規格書 10、11.5、D-19、D-40）。
// 結構與 tools/build-zips.sh 相同：技能資料夾為最上層，只放檔案，不放資料夾項目。
// 只使用 fflate 的同步模式。非同步模式會動態建立背景程式，後台的內容安全政策不允許

import { zipSync } from './vendor/fflate-0.8.2.mjs';

export const ZIP_SKILLS = ['japanese-qa-practice', 'japanese-tts-grammar-coach'];
export const zipPath = (skill) => `downloads/${skill}.zip`;

// 從 GitHub 讀取範本產生 ZIP。listEntries 已排除以「.」開頭的檔案與資料夾（規格書 11.5 第二項）
export async function buildZip(client, skill) {
  const entries = await client.listEntries(`templates/${skill}/`);
  const files = {};
  for (const { path } of entries) {
    const { bytes } = await client.readFile(path);
    files[path.slice('templates/'.length)] = bytes;
  }
  return { bytes: zipSync(files, { level: 9 }), names: Object.keys(files) };
}
