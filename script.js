/* ==========================
   IndexedDB wrapper
   ========================== */
const DB_NAME = 'vinyl-player-db';
const STORE_NAME = 'tracks';
let db = null;

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        d.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
}

function addTrackToDb(meta, blob) {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const entry = Object.assign({}, meta, { blob });
    const req = store.add(entry);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function getAllTracksFromDb() {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function deleteTrackFromDb(id) {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => res();
    req.onerror = () => rej(req.error);
  });
}

/* ==========================
   Core variables
   ========================== */
const audioEl = document.getElementById('audioA');
const labelVideo = document.getElementById('labelVideo');
const labelImg = document.getElementById('labelImg');
const playBtn = document.getElementById('play');
const tonearmEl = document.getElementById('tonearm');
const appEl = document.getElementById('app');
const dustEl = document.getElementById('dust');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');

const visualizerCanvas = document.getElementById('visualizerCanvas');
const vCtx = visualizerCanvas.getContext('2d');
const waveformCanvas = document.getElementById('waveformCanvas');
const wCtx = waveformCanvas.getContext('2d');

let tracks = [];
let currentIndex = -1;
let followMedia = null;
let rotation = 0;
let vinylSpeed = 0;
let maxSpeed = 0.12;
let shuffle = false;
let loopTrack = false;

/* ==========================
   Audio context & visualizer
   ========================== */
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 128;
let sourceNode = null;

function connectVisualizer(mediaEl) {
  if (sourceNode) return;
  try {
    sourceNode = audioCtx.createMediaElementSource(mediaEl);
    sourceNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  } catch (e) { console.warn('Visualizer connect error', e); }
}

function drawVisualizer() {
  requestAnimationFrame(drawVisualizer);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteFrequencyData(dataArray);
  vCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);

  const barWidth = visualizerCanvas.width / bufferLength;
  for (let i = 0; i < bufferLength; i++) {
    const barHeight = dataArray[i] / 255 * visualizerCanvas.height;
    vCtx.fillStyle = 'rgba(255,77,77,0.7)';
    vCtx.fillRect(i * barWidth, visualizerCanvas.height - barHeight, Math.max(barWidth - 2, 1), barHeight);
  }

  const waveformData = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(waveformData);
  wCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
  wCtx.beginPath();
  const sliceWidth = waveformCanvas.width / waveformData.length;
  waveformData.forEach((v, i) => {
    const y = (v / 128) * waveformCanvas.height / 2;
    if (i === 0) wCtx.moveTo(i * sliceWidth, y);
    else wCtx.lineTo(i * sliceWidth, y);
  });
  wCtx.strokeStyle = '#ff4d4d';
  wCtx.lineWidth = 2;
  wCtx.stroke();
}
drawVisualizer();

/* ==========================
   UI toggles
   ========================== */
const shuffleSwitch = document.getElementById('shuffleSwitch');
const loopSwitch = document.getElementById('loopSwitch');

function setSwitch(el, on) { el.classList.toggle('on', on); }

shuffleSwitch.addEventListener('click', () => {
  shuffle = !shuffle;
  setSwitch(shuffleSwitch, shuffle);
  saveUIState();
});
loopSwitch.addEventListener('click', () => {
  loopTrack = !loopTrack;
  setSwitch(loopSwitch, loopTrack);
  saveUIState();
});

function saveUIState() {
  localStorage.setItem('vp_ui', JSON.stringify({ shuffle, loopTrack }));
}
function loadUIState() {
  try {
    const raw = localStorage.getItem('vp_ui');
    if (!raw) return;
    const s = JSON.parse(raw);
    shuffle = !!s.shuffle;
    loopTrack = !!s.loopTrack;
    setSwitch(shuffleSwitch, shuffle);
    setSwitch(loopSwitch, loopTrack);
  } catch (e) { }
}
loadUIState();

/* ==========================
   Dust particles
   ========================== */
function createDustParticles() {
  dustEl.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const sp = document.createElement('span');
    const size = 1 + Math.random() * 3;
    sp.style.width = `${size}px`;
    sp.style.height = `${size}px`;
    sp.style.left = `${10 + Math.random() * 80}%`;
    sp.style.top = `${10 + Math.random() * 80}%`;
    sp.style.opacity = (0.03 + Math.random() * 0.09).toFixed(2);
    sp.style.animationDuration = `${6 + Math.random() * 6}s`;
    dustEl.appendChild(sp);
  }
}
createDustParticles();

/* ==========================
   Helpers
   ========================== */
function isVideoTrack(t) { return t && t.type && t.type.startsWith('video'); }
function formatTime(seconds) {
  if (!isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/* ==========================
   Vinyl spin & tonearm
   ========================== */
function updateTonearm() {
  if (!followMedia || !followMedia.duration) return;
  const pct = Math.min(followMedia.currentTime / followMedia.duration, 1);
  const deg = -25 + 30 * pct;
  tonearmEl.style.transform = `rotate(${deg}deg)`;
}

function spin() {
  if (followMedia && followMedia.readyState > 2) {
    if (!followMedia.paused) vinylSpeed += (maxSpeed - vinylSpeed) * 0.1;
    else { vinylSpeed *= 0.95; if (Math.abs(vinylSpeed) < 0.001) vinylSpeed = 0; }
    rotation += vinylSpeed * 10;
    document.getElementById('vinylDisc').style.transform = `rotate(${rotation}deg)`;
    document.getElementById('vinylLabel').style.transform = `translate(-50%,-50%) rotate(${rotation * 0.98}deg)`;
    updateTonearm();
  }
  requestAnimationFrame(spin);
}
spin();

/* ==========================
   Playlist UI
   ========================== */
function renderPlaylist() {
  const playlistEl = document.getElementById('playlist');
  playlistEl.innerHTML = '';
  tracks.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'track-item';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '10px';

    const img = document.createElement('img');
    img.src = t.art || '';
    img.style.width = '36px';
    img.style.height = '36px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '6px';
    img.onerror = () => img.style.visibility = 'hidden';

    const meta = document.createElement('div');
    meta.innerHTML = `<div style="font-weight:600">${t.name}</div><div class="small">${t.artist || ''}</div>`;

    left.appendChild(img);
    left.appendChild(meta);

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '8px';

    const play = document.createElement('button');
    play.className = 'btn';
    play.textContent = 'Play';
    play.addEventListener('click', () => playIndex(i));

    const del = document.createElement('button');
    del.className = 'btn';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      if (t.dbId) { await deleteTrackFromDb(t.dbId); }
      URL.revokeObjectURL(t.url);
      tracks.splice(i, 1);
      if (currentIndex === i) { currentIndex = -1; audioEl.pause(); audioEl.src = ''; followMedia = null; tonearmEl.classList.add('lifted'); }
      else if (currentIndex > i) currentIndex--;
      savePlaylistOrder();
      renderPlaylist();
    });

    buttons.appendChild(play);
    buttons.appendChild(del);

    el.appendChild(left);
    el.appendChild(buttons);
    playlistEl.appendChild(el);
  });
}

/* ==========================
   Restore from DB
   ========================== */
async function restoreFromDb() {
  try {
    await openDb();
    const saved = await getAllTracksFromDb();
    for (const item of saved) {
      const blob = item.blob;
      const url = URL.createObjectURL(blob);
      tracks.push({
        id: item.id,
        name: item.name,
        artist: item.artist,
        type: item.type,
        art: item.art || '',
        url,
        dbId: item.id
      });
    }
    renderPlaylist();
    restorePlaylistOrder();
  } catch (e) { console.warn('restore db failed', e); }
}
restoreFromDb();

/* ==========================
   Extract album art
   ========================== */
function extractAlbumArt(file) {
  return new Promise((res) => {
    try {
      window.jsmediatags.read(file, {
        onSuccess: function (tag) {
          const picture = tag.tags.picture;
          if (!picture) { res(null); return; }
          let base64String = "";
          for (let i = 0; i < picture.data.length; i++) base64String += String.fromCharCode(picture.data[i]);
          const mime = picture.format || 'image/jpeg';
          const dataUrl = `data:${mime};base64,${btoa(base64String)}`;
          res(dataUrl);
        },
        onError: function () { res(null); }
      });
    } catch (e) { res(null); }
  });
}

/* ==========================
   Add file
   ========================== */
async function addFile(file) {
  const art = await extractAlbumArt(file);
  const meta = { name: file.name, artist: file.artist || 'Local', type: file.type, art: art || '' };
  const dbId = await addTrackToDb(meta, file);
  const url = URL.createObjectURL(file);
  const track = { id: Date.now() + Math.random(), name: file.name, artist: meta.artist, type: file.type, art: meta.art, url, dbId };
  tracks.push(track);
  renderPlaylist();
  savePlaylistOrder();
  if (currentIndex === -1) playIndex(tracks.length - 1);
}

/* Drag & drop */
document.addEventListener('dragover', e => { e.preventDefault(); appEl.classList.add('drop-active'); });
document.addEventListener('dragleave', e => { e.preventDefault(); appEl.classList.remove('drop-active'); });
document.addEventListener('drop', e => {
  e.preventDefault();
  appEl.classList.remove('drop-active');
  const files = Array.from(e.dataTransfer.files || []);
  files.forEach(f => addFile(f));
});

/* File input */
document.getElementById('file').addEventListener('change', e => { Array.from(e.target.files).forEach(f => addFile(f)); });

/* ==========================
   Play / Pause / Next / Prev
   ========================== */
function updatePlayButton() { playBtn.textContent = audioEl.paused ? 'Play' : 'Pause'; }

playBtn.addEventListener('click', () => {
  if (!audioEl.src) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  if (audioEl.paused) {
    // drop needle
    tonearmEl.classList.remove('lifted');
    setTimeout(() => {
      tonearmEl.classList.add('lowered');
      audioEl.play();
      if (isVideoTrack(tracks[currentIndex])) labelVideo.play();
      followMedia = audioEl;
    }, 500);
  } else {
    // lift needle
    tonearmEl.classList.remove('lowered');
    setTimeout(() => {
      tonearmEl.classList.add('lifted');
      audioEl.pause();
      if (isVideoTrack(tracks[currentIndex])) labelVideo.pause();
    }, 300);
  }

  updatePlayButton();
});

document.getElementById('prev').addEventListener('click', () => {
  if (tracks.length) playIndex((currentIndex - 1 + tracks.length) % tracks.length);
});
document.getElementById('next').addEventListener('click', () => {
  if (tracks.length) playIndex((currentIndex + 1) % tracks.length);
});

/* Volume / Speed */
document.getElementById('volume').addEventListener('input', e => { audioEl.volume = e.target.value; });

// Speed slider syncing both audio & video
document.getElementById('speed').addEventListener('input', e => {
  const rate = parseFloat(e.target.value);
  audioEl.playbackRate = rate;
  if (isVideoTrack(tracks[currentIndex]) && labelVideo) labelVideo.playbackRate = rate;
});

/* ==========================
   Progress bar seeking
   ========================== */
progressBar.addEventListener('click', e => {
  if (currentIndex === -1) return;
  const track = tracks[currentIndex];
  if (!audioEl.duration || !track) return;

  const rect = progressBar.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const newTime = pct * audioEl.duration;

  audioEl.currentTime = newTime;
  if (isVideoTrack(track)) {
    try { labelVideo.currentTime = newTime; } catch (e) { console.warn('Video sync error', e); }
  }
  progressFill.style.width = `${pct * 100}%`;
});

setInterval(() => {
  if (!audioEl || !audioEl.duration || currentIndex === -1) return;
  const pct = audioEl.currentTime / audioEl.duration;
  progressFill.style.width = `${pct * 100}%`;
  document.getElementById('current').textContent = formatTime(audioEl.currentTime);
  document.getElementById('duration').textContent = formatTime(audioEl.duration || 0);
}, 250);

/* ==========================
   Play a specific track
   ========================== */
async function playIndex(i) {
  if (i < 0 || i >= tracks.length) return;
  currentIndex = i;
  const track = tracks[i];
  if (!track) return;

  tonearmEl.classList.remove('lifted');
  followMedia = audioEl;

  document.getElementById('title').textContent = track.name;
  document.getElementById('artist').textContent = track.artist || '';

  audioEl.pause();
  audioEl.src = track.url;
  audioEl.load();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  connectVisualizer(audioEl);

  try { await audioEl.play(); } catch (e) { console.warn('Audio play error', e); }
  updatePlayButton();

  if (isVideoTrack(track)) {
    labelVideo.src = track.url;
    labelVideo.style.display = 'block';
    labelVideo.playbackRate = audioEl.playbackRate; // sync speed
    labelImg.style.display = 'none';
    try { labelVideo.currentTime = audioEl.currentTime; } catch (e) { }
    if (!audioEl.paused) labelVideo.play().catch(() => { });
  } else {
    labelImg.src = track.art || '';
    labelVideo.pause();
    labelVideo.style.display = 'none';
    labelImg.style.display = 'block';
  }
}

/* ==========================
   Auto-play next
   ========================== */
audioEl.addEventListener('ended', () => {
  tonearmEl.classList.remove('lowered');
  setTimeout(() => tonearmEl.classList.add('lifted'), 400);

  if (loopTrack) {
    audioEl.currentTime = 0;
    audioEl.play();
    if (isVideoTrack(tracks[currentIndex])) {
      labelVideo.currentTime = 0;
      labelVideo.play();
    }
    return;
  }

  if (tracks.length === 0) return;
  if (shuffle) playIndex(Math.floor(Math.random() * tracks.length));
  else playIndex((currentIndex + 1) % tracks.length);
});

audioEl.addEventListener('play', () => { updatePlayButton(); if (isVideoTrack(tracks[currentIndex])) labelVideo.play().catch(() => { }); });
audioEl.addEventListener('pause', () => { updatePlayButton(); if (isVideoTrack(tracks[currentIndex])) labelVideo.pause(); });

/* ==========================
   Playlist order save/restore
   ========================== */
function savePlaylistOrder() {
  try {
    const order = tracks.map(t => t.dbId || null).filter(Boolean);
    localStorage.setItem('vp_order', JSON.stringify(order));
  } catch (e) { }
}

async function restorePlaylistOrder() {
  try {
    const raw = localStorage.getItem('vp_order');
    if (!raw) return;
    const order = JSON.parse(raw);
    if (tracks.length && order.length) {
      const map = new Map(tracks.map(t => [t.dbId, t]));
      const ordered = [];
      for (const id of order) if (map.has(id)) ordered.push(map.get(id));
      for (const t of tracks) if (!ordered.includes(t)) ordered.push(t);
      tracks = ordered;
      renderPlaylist();
    }
  } catch (e) { }
}

/* ==========================
   Cleanup on unload
   ========================== */
window.addEventListener('beforeunload', () => {
  tracks.forEach(t => { try { URL.revokeObjectURL(t.url); } catch (e) { } });
});
