// AM Downloader 自研版 — Electron 主进程
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const dl = require('./downloader');

const WASM_PATH = path.join(__dirname, 'temari.wasm');
// 打包后 ffmpeg 在 resources 下（extraResources），开发时在 app 目录
const FFMPEG_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'ffmpeg.exe')
  : path.join(__dirname, 'ffmpeg.exe');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
  downloadDir: path.join(app.getPath('music'), '章鱼AM解密工具'),
  concurrency: 2,
  codec: 'alac',
  coverSize: 600,
  coverFormat: 'jpeg',      // jpeg | png | original
  saveLyrics: true,
  lyricFormat: 'lrc',       // lrc | ttml
  saveCover: true,
  lyricLang: 'en',
  nameTemplate: '{disc}-{track:02d} {title}',
  albumSubfolder: true,
  embedFields: ['title', 'artist', 'album', 'albumArtist', 'composer', 'genre',
    'year', 'trackNumber', 'discNumber', 'lyrics', 'cover', 'isrc',
    'copyright', 'recordLabel', 'upc', 'rating', 'songId', 'albumId', 'artistId'],
  sortOrder: false,     // 写入排序字段（sonm/soar/soal/soco/soaa）
  lyricsExtra: [],      // 歌词附加内容：translation 翻译 / pronunciation 发音
  alacFix: true,        // ALAC 结束标记修复（Apple END-tag 缺陷）
  convertFlac: false,   // ALAC 下载后同时输出 .flac
  keepM4a: true,        // 转 FLAC 后保留 m4a
  wrapperUrl: 'https://wm.wol.moe', // 密钥服务地址（可换自建 wrapper-lite）
  apiKey: '',           // 密钥服务 API Key（Telegram @wm_auth_bot 发 /newkey 获取）
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}
let settings = loadSettings();

// ---------- 文件名 ----------
const sanitize = s => String(s).replace(/[\\/:*?"<>|]/g, '_').trim();
function formatName(tpl, t, extra = {}) {
  const vars = {
    title: t.title, artist: t.artist, album: t.album, album_artist: t.albumArtist,
    composer: t.composer, genre: t.genre, year: t.year, track: t.trackNumber,
    disc: t.discNumber, codec: extra.codec || '', song_id: t.adamId,
  };
  return sanitize(tpl.replace(/\{(\w+)(?::0?(\d+)d)?\}/g, (_, k, pad) => {
    let v = vars[k] ?? '';
    if (pad) v = String(v).padStart(+pad, '0');
    return v;
  }));
}

// ---------- FLAC 转换（仅无损 ALAC 有意义，有损转 FLAC 不会提升音质） ----------
function convertToFlac(m4aPath) {
  return new Promise((resolve, reject) => {
    const out = m4aPath.replace(/\.m4a$/i, '.flac');
    const args = ['-hide_banner', '-v', 'error', '-i', m4aPath,
      '-map', '0:a', '-c:a', 'flac',
      '-map', '0:v?', '-c:v', 'copy', '-disposition:v:0', 'attached_pic',
      '-map_metadata', '0', '-y', out];
    const p = spawn(FFMPEG_PATH, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => err += d);
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0 && fs.existsSync(out)) resolve(out);
      else reject(new Error(err.trim() || `ffmpeg 退出码 ${code}`));
    });
  });
}

// ---------- 下载队列 ----------
let queue = [];
let running = 0;
let win = null;

function sendProgress(item, patch) {
  Object.assign(item, patch);
  win?.webContents.send('dl-progress', {
    id: item.id, status: item.status, phase: item.phase,
    done: item.done, total: item.total, filePath: item.filePath, error: item.error,
  });
}

async function processQueue() {
  while (running < settings.concurrency) {
    const item = queue.find(q => q.status === 'queued');
    if (!item) return;
    running++;
    item.status = 'downloading';
    sendProgress(item, {});
    // 不能在循环里 await，否则并发槽形同虚设；完成后回收槽位并继续调度
    downloadItem(item)
      .catch(e => sendProgress(item, { status: 'error', error: e.message }))
      .finally(() => { running--; processQueue(); });
  }
}

async function downloadItem(item) {
  sendProgress(item, {});
  try {
    const { track, codec } = item;
    const isAlbum = item.albumName && settings.albumSubfolder;
    const dir = isAlbum ? path.join(settings.downloadDir, sanitize(item.albumName)) : settings.downloadDir;
    fs.mkdirSync(dir, { recursive: true });
    const name = formatName(settings.nameTemplate, track, { codec });
    const filePath = path.join(dir, name + '.m4a');

    const { file, cover, lyrics } = await dl.downloadTrack(track, {
      codec, wasmPath: WASM_PATH, coverSize: settings.coverSize,
      coverFormat: settings.coverFormat,
      saveLyrics: settings.saveLyrics, saveCover: settings.saveCover,
      lyricLang: settings.lyricLang, lyricFormat: settings.lyricFormat,
      lyricsExtra: settings.lyricsExtra || [], alacFix: settings.alacFix !== false,
      sortOrder: !!settings.sortOrder,
      fields: settings.embedFields, trackTotal: item.trackTotal || 0,
    }, (pg) => sendProgress(item, { phase: pg.phase, done: pg.done, total: pg.total }));

    fs.writeFileSync(filePath, file);
    if (settings.saveLyrics && lyrics) {
      const ext = settings.lyricFormat === 'ttml' ? '.ttml' : '.lrc';
      const content = settings.lyricFormat === 'ttml' ? lyrics.ttml : lyrics.lrc;
      if (content) fs.writeFileSync(path.join(dir, name + ext), content, 'utf8');
    }
    if (settings.saveCover && cover && isAlbum)
      fs.writeFileSync(path.join(dir, 'cover.' + cover.type), cover.data);

    // ALAC → FLAC（可选）
    let finalPath = filePath;
    if (settings.convertFlac && codec === 'alac') {
      sendProgress(item, { phase: '转码 FLAC', done: 0, total: 1 });
      finalPath = await convertToFlac(filePath);
      if (!settings.keepM4a) fs.unlinkSync(filePath);
    }

    sendProgress(item, { status: 'done', filePath: finalPath, phase: '完成', done: 1, total: 1 });
  } catch (e) {
    sendProgress(item, { status: 'error', error: e.message });
  }
}

// ---------- IPC ----------
ipcMain.handle('parse', async (_e, input) => {
  dl.setConfig({ wrapperUrl: settings.wrapperUrl, apiKey: settings.apiKey });
  const r = await dl.resolve(input);
  // 探测第一首歌可用编码
  let codecs = ['alac'];
  if (r.tracks.length) {
    try { codecs = (await dl.probeCodecs(r.tracks[0].adamId)).codecs; } catch {}
  }
  return { kind: r.kind, album: r.album || null, tracks: r.tracks, codecs };
});

ipcMain.handle('download', (_e, { tracks, codec }) => {
  dl.setConfig({ wrapperUrl: settings.wrapperUrl, apiKey: settings.apiKey });
  const items = tracks.map(t => ({
    id: t.adamId + '-' + Date.now() + Math.random().toString(36).slice(2, 6),
    track: t, codec, albumName: t.album, trackTotal: tracks.length,
    status: 'queued', phase: '排队中', done: 0, total: 1, filePath: null, error: null,
  }));
  queue.push(...items);
  processQueue();
  return items.map(i => ({ id: i.id, adamId: i.track.adamId }));
});

ipcMain.handle('get-settings', () => settings);
ipcMain.handle('set-settings', (_e, s) => { settings = { ...settings, ...s }; saveSettings(settings); return settings; });
ipcMain.handle('pick-dir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('open-path', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('open-download-dir', () => {
  fs.mkdirSync(settings.downloadDir, { recursive: true });
  shell.openPath(settings.downloadDir);
});

// ---------- 窗口 ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1080, height: 780, minWidth: 860, minHeight: 600,
    icon: path.join(__dirname, 'icon.ico'),
    title: '章鱼AM解密工具-章鱼科技版',
    autoHideMenuBar: true,
    backgroundColor: '#12141a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
