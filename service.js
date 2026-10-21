// service.js — Apple Music 解密播放 · 本地 HTTP 服务（P1：AAC 缓冲式 + Range）
// 供安妮主进程挂载。用法：
//   const { createAmService } = require('./service.js');
//   const svc = await createAmService({ wasmPath: '<abs>/temari.wasm', wrapperUrl, apiKey, fetchImpl });
//   svc.url  // 'http://127.0.0.1:PORT'  → 播放地址 `${svc.url}/am/<adamId>?codec=aac`
//   svc.close()
//
// 端点：
//   GET /am/<adamId>?codec=aac   解密音频流（P1 仅 aac；alac 等返回 400 明确提示）
//                                 支持 Range（206 Partial Content），seek 瞬时跳转
//   GET /status                  wrapper-lite 健康检查（透传 /status）
'use strict';
const http = require('node:http');
const dl = require('./downloader.js');

const P1_CODECS = ['aac']; // P1 只放 AAC（缓冲式全量内存，AAC ≈8MB 无压力；无损档待 P2 流式）
const MAX_CACHE = 2;       // 内存缓存最近播放的曲目（seek/重复播放不重下）

async function createAmService(opts = {}) {
  const { wasmPath, wrapperUrl, apiKey, fetchImpl } = opts;
  if (!wasmPath) throw new Error('createAmService: 缺少 opts.wasmPath（temari.wasm 绝对路径）');
  dl.setConfig({
    wrapperUrl: wrapperUrl || 'http://127.0.0.1:12340',
    apiKey: apiKey || '',
    fetchImpl: fetchImpl || null, // 安妮侧传 Electron net.fetch
  });

  const cache = new Map(); // `${adamId}:${codec}` -> { buf, time }
  const inflight = new Map(); // 同曲并发请求合并

  async function getTrackBuffer(adamId, codec) {
    const key = `${adamId}:${codec}`;
    const hit = cache.get(key);
    if (hit) { hit.time = Date.now(); return hit.buf; }
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      // 播放用途：跳过全部标签/封面/歌词（fields:[]），保留 remux（播放器兼容性已验证）
      const track = { adamId, title: '', artist: '', album: '', hasLyrics: false };
      const res = await dl.downloadTrack(track, { codec, wasmPath, fields: [], saveLyrics: false });
      cache.set(key, { buf: res.file, time: Date.now() });
      while (cache.size > MAX_CACHE) { // LRU 淘汰最旧
        let ok, ot = Infinity;
        for (const [k, v] of cache) if (v.time < ot) { ot = v.time; ok = k; }
        cache.delete(ok);
      }
      return res.file;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (u.pathname === '/status') {
      try {
        const s = await dl.wrapperStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(s));
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    const m = u.pathname.match(/^\/am\/(\d+)$/);
    if (!m) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown endpoint' }));
      return;
    }
    const adamId = m[1];
    const codec = u.searchParams.get('codec') || 'aac';
    if (!P1_CODECS.includes(codec)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `P1 阶段在线播放仅支持 AAC（codec=aac）；${codec} 无损档待 P2 流式上线` }));
      return;
    }

    let buf;
    try {
      buf = await getTrackBuffer(adamId, codec);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }

    const base = {
      'Content-Type': 'audio/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    const range = req.headers.range;
    if (range) {
      const rm = /bytes=(\d+)-(\d*)/.exec(range);
      if (rm) {
        const start = +rm[1];
        let end = rm[2] ? +rm[2] : buf.length - 1;
        if (start >= buf.length || start > end) {
          res.writeHead(416, { ...base, 'Content-Range': `bytes */${buf.length}` });
          res.end();
          return;
        }
        end = Math.min(end, buf.length - 1);
        res.writeHead(206, {
          ...base,
          'Content-Range': `bytes ${start}-${end}/${buf.length}`,
          'Content-Length': end - start + 1,
        });
        res.end(buf.subarray(start, end + 1));
        return;
      }
    }
    res.writeHead(200, { ...base, 'Content-Length': buf.length });
    res.end(buf);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    // listen(0)：系统分配空闲端口，避免与 wrapper-lite(12340) 等冲突
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  return {
    server,
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(r => server.close(r)),
  };
}

module.exports = { createAmService };
