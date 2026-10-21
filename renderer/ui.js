// ui.js — 渲染进程逻辑
'use strict';

const $ = (s) => document.querySelector(s);
const CODEC_LABEL = { alac: 'ALAC 无损', aac: 'AAC 256K', 'he-aac': 'HE-AAC 64K', atmos: '杜比全景声' };

let settings = null;
let currentResult = null; // { kind, album, tracks, codecs }
let selectedCodec = 'alac';
const queueItems = new Map(); // id -> DOM refs

// ---------- Toast ----------
let toastTimer = null;
function toast(msg, ms = 3000) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- 设置 ----------
async function loadSettings() {
  settings = await window.api.getSettings();
  selectedCodec = settings.codec;
  $('#set-dir').value = settings.downloadDir;
  $('#set-codec').value = settings.codec;
  $('#set-concurrency').value = settings.concurrency;
  $('#set-cover-size').value = settings.coverSize;
  $('#set-cover-format').value = settings.coverFormat || 'jpeg';
  $('#set-lyric-lang').value = settings.lyricLang;
  $('#set-lyric-format').value = settings.lyricFormat || 'lrc';
  $('#set-template').value = settings.nameTemplate;
  $('#set-save-lrc').checked = settings.saveLyrics;
  $('#set-save-cover').checked = settings.saveCover;
  $('#set-album-subfolder').checked = settings.albumSubfolder;
  $('#set-convert-flac').checked = !!settings.convertFlac;
  $('#set-keep-m4a').checked = settings.keepM4a !== false;
  $('#set-sort-order').checked = !!settings.sortOrder;
  $('#set-alac-fix').checked = settings.alacFix !== false;
  const extras = settings.lyricsExtra || [];
  $('#set-lyrics-translation').checked = extras.includes('translation');
  $('#set-lyrics-pronunciation').checked = extras.includes('pronunciation');
  $('#set-wrapper-url').value = settings.wrapperUrl || '';
  $('#set-api-key').value = settings.apiKey || '';
  const fields = settings.embedFields || [];
  document.querySelectorAll('#embed-fields input').forEach(cb => {
    cb.checked = fields.includes(cb.value);
  });
}

async function persistSettings() {
  settings = await window.api.setSettings({
    downloadDir: $('#set-dir').value,
    codec: $('#set-codec').value,
    concurrency: Math.max(1, Math.min(8, +$('#set-concurrency').value || 2)),
    coverSize: Math.max(100, +$('#set-cover-size').value || 600),
    coverFormat: $('#set-cover-format').value,
    lyricLang: $('#set-lyric-lang').value.trim() || 'en',
    lyricFormat: $('#set-lyric-format').value,
    nameTemplate: $('#set-template').value.trim() || '{disc}-{track:02d} {title}',
    saveLyrics: $('#set-save-lrc').checked,
    saveCover: $('#set-save-cover').checked,
    albumSubfolder: $('#set-album-subfolder').checked,
    convertFlac: $('#set-convert-flac').checked,
    keepM4a: $('#set-keep-m4a').checked,
    sortOrder: $('#set-sort-order').checked,
    alacFix: $('#set-alac-fix').checked,
    lyricsExtra: [
      $('#set-lyrics-translation').checked ? 'translation' : null,
      $('#set-lyrics-pronunciation').checked ? 'pronunciation' : null,
    ].filter(Boolean),
    wrapperUrl: $('#set-wrapper-url').value.trim() || undefined,
    apiKey: $('#set-api-key').value.trim(),
    embedFields: [...document.querySelectorAll('#embed-fields input:checked')].map(cb => cb.value),
  });
  selectedCodec = settings.codec;
}

$('#btn-settings').onclick = () => $('#settings-modal').classList.remove('hidden');
$('#btn-settings-close').onclick = async () => {
  await persistSettings();
  $('#settings-modal').classList.add('hidden');
  toast('设置已保存');
};
$('#btn-pick-dir').onclick = async () => {
  const dir = await window.api.pickDir();
  if (dir) $('#set-dir').value = dir;
};
$('#btn-open-dir').onclick = () => window.api.openDownloadDir();

// ---------- 解析 ----------
function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function doParse() {
  const input = $('#input-link').value.trim();
  if (!input) return;
  const btn = $('#btn-parse');
  btn.disabled = true;
  btn.textContent = '解析中…';
  try {
    const r = await window.api.parse(input);
    currentResult = r;
    renderResult(r);
  } catch (e) {
    toast('解析失败: ' + (e.message || e), 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = '解析';
  }
}

function badge(text, cls) {
  return `<span class="badge-tag ${cls}">${text}</span>`;
}

function traitBadges(t) {
  const out = [];
  const tr = t.audioTraits || [];
  if (tr.includes('hi-res-lossless')) out.push(badge('高解析无损', 'gold'));
  else if (tr.includes('lossless')) out.push(badge('无损', 'gold'));
  if (tr.includes('atmos')) out.push(badge('杜比全景声', 'blue'));
  if (tr.includes('spatial')) out.push(badge('空间音频', 'blue'));
  if (t.isAppleDigitalMaster) out.push(badge('Apple 数字母带', ''));
  if (t.hasLyrics) out.push(badge('歌词', 'gray'));
  if (t.contentRating) out.push(badge('Explicit', 'gray'));
  return out.join('');
}

function metaItem(k, v) {
  if (v === undefined || v === null || v === '') return '';
  return `<div class="meta-item"><span class="k">${k}</span><span class="v"></span></div>`;
}

function fillMeta(pairs) {
  const grid = $('#meta-grid');
  grid.innerHTML = pairs.map(([k, v]) => metaItem(k, v)).join('');
  const items = grid.querySelectorAll('.meta-item');
  pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').forEach(([, v], i) => {
    items[i].querySelector('.v').textContent = v;
    items[i].querySelector('.v').title = v;
  });
}

function renderResult(r) {
  $('#empty').classList.add('hidden');
  $('#result').classList.remove('hidden');

  const first = r.tracks[0];
  const isAlbum = r.kind !== 'song';
  $('#result-title').textContent = isAlbum ? (r.album?.name || first.album || '未知') : first.title;

  // 副标题 + 徽章
  if (isAlbum) {
    $('#result-sub').textContent = `${r.album?.artist || first.albumArtist} · ${r.tracks.length} 首`;
    $('#result-badges').innerHTML = badge('专辑', '') + traitBadges(first);
  } else {
    $('#result-sub').textContent = `${first.artist} · ${first.album || ''}`;
    $('#result-badges').innerHTML = badge('单曲', '') + traitBadges(first);
  }

  // 元数据网格
  if (isAlbum && r.album) {
    const totalMs = r.tracks.reduce((a, t) => a + t.durationMs, 0);
    fillMeta([
      ['专辑艺术家', r.album.artist],
      ['流派', (r.album.genres || []).join(' / ')],
      ['发行日期', r.album.releaseDate],
      ['曲目数', r.album.trackTotal + ' 首'],
      ['总时长', fmtDur(totalMs)],
      ['厂牌', r.album.recordLabel],
      ['UPC', r.album.upc],
      ['版权', r.album.copyright],
    ]);
  } else {
    fillMeta([
      ['艺术家', first.artist],
      ['专辑', first.album],
      ['专辑艺术家', first.albumArtist],
      ['作曲家', first.composer],
      ['流派', (first.genres || []).join(' / ')],
      ['发行日期', first.releaseDate],
      ['时长', fmtDur(first.durationMs)],
      ['曲目', first.discNumber > 1 ? `碟 ${first.discNumber} · 第 ${first.trackNumber} 首` : `第 ${first.trackNumber} 首`],
      ['ISRC', first.isrc],
      ['adamId', first.adamId],
    ]);
  }

  const coverUrl = first.artwork;
  $('#result-cover').src = coverUrl ? coverUrl.replace('{w}', '400').replace('{h}', '400') : '../icon.png';

  // 编码 chips
  const chips = $('#codec-chips');
  chips.innerHTML = '';
  const available = r.codecs.length ? r.codecs : ['alac'];
  if (!available.includes(selectedCodec)) selectedCodec = available[0];
  for (const c of available) {
    const el = document.createElement('button');
    el.className = 'chip' + (c === selectedCodec ? ' active' : '');
    el.textContent = CODEC_LABEL[c] || c;
    el.onclick = () => {
      selectedCodec = c;
      chips.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
    };
    chips.appendChild(el);
  }

  // 曲目表
  const tbody = $('#track-list');
  tbody.innerHTML = '';
  r.tracks.forEach((t, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="track-check" data-i="${i}" checked></td>
      <td class="dim">${t.discNumber > 1 ? t.discNumber + '-' : ''}${t.trackNumber || i + 1}</td>
      <td class="track-title"></td>
      <td class="dim"></td>
      <td class="dim">${fmtDur(t.durationMs)}</td>`;
    tr.children[2].textContent = t.title;
    tr.children[3].textContent = t.artist;
    tbody.appendChild(tr);
  });
}

$('#btn-parse').onclick = doParse;
$('#input-link').addEventListener('keydown', (e) => { if (e.key === 'Enter') doParse(); });
$('#check-all').onchange = (e) => {
  document.querySelectorAll('.track-check').forEach(c => c.checked = e.target.checked);
};

// ---------- 下载 ----------
$('#btn-download').onclick = async () => {
  if (!currentResult) return;
  const checks = [...document.querySelectorAll('.track-check')];
  const tracks = currentResult.tracks.filter((_, i) => checks[i]?.checked);
  if (!tracks.length) return toast('请先勾选曲目');
  const items = await window.api.download({ tracks, codec: selectedCodec });
  $('#queue-section').classList.remove('hidden');
  for (const it of items) {
    const track = tracks.find(t => t.adamId === it.adamId);
    addQueueItem(it.id, track, selectedCodec);
  }
  toast(`已加入 ${items.length} 个下载任务`);
};

function addQueueItem(id, track, codec) {
  const el = document.createElement('div');
  el.className = 'queue-item';
  el.innerHTML = `
    <div class="queue-top">
      <div class="queue-name"></div>
      <div class="queue-status">排队中</div>
    </div>
    <div class="progress-track"><div class="progress-bar"></div></div>`;
  el.querySelector('.queue-name').textContent = `${track.title} — ${track.artist} [${CODEC_LABEL[codec] || codec}]`;
  $('#queue-list').prepend(el);
  queueItems.set(id, {
    el,
    status: el.querySelector('.queue-status'),
    bar: el.querySelector('.progress-bar'),
  });
}

window.api.onProgress((d) => {
  const item = queueItems.get(d.id);
  if (!item) return;
  const pct = d.total > 0 ? Math.round((d.done / d.total) * 100) : 0;
  item.bar.style.width = pct + '%';
  if (d.status === 'done') {
    item.status.textContent = '完成 ✓ 点击打开';
    item.status.className = 'queue-status done';
    item.bar.classList.add('done');
    item.bar.style.width = '100%';
    item.status.onclick = () => window.api.openPath(d.filePath);
  } else if (d.status === 'error') {
    item.status.textContent = '失败: ' + (d.error || '');
    item.status.className = 'queue-status error';
    item.status.title = d.error || '';
  } else if (d.status === 'downloading') {
    item.status.textContent = d.total > 1 ? `${d.phase} ${d.done}/${d.total}` : d.phase;
    item.status.className = 'queue-status';
  } else {
    item.status.textContent = d.phase || '排队中';
  }
});

// ---------- 启动 ----------
loadSettings();
