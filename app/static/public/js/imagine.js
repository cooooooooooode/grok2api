(() => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearBtn = document.getElementById('clearBtn');
  const promptInput = document.getElementById('promptInput');
  const ratioSelect = document.getElementById('ratioSelect');
  const concurrentSelect = document.getElementById('concurrentSelect');
  const autoScrollToggle = document.getElementById('autoScrollToggle');
  const autoDownloadToggle = document.getElementById('autoDownloadToggle');
  const reverseInsertToggle = document.getElementById('reverseInsertToggle');
  const autoFilterToggle = document.getElementById('autoFilterToggle');
  const nsfwSelect = document.getElementById('nsfwSelect');
  const selectFolderBtn = document.getElementById('selectFolderBtn');
  const folderPath = document.getElementById('folderPath');
  const statusText = document.getElementById('statusText');
  const countValue = document.getElementById('countValue');
  const activeValue = document.getElementById('activeValue');
  const latencyValue = document.getElementById('latencyValue');
  const modeButtons = document.querySelectorAll('.mode-btn');
  const waterfall = document.getElementById('waterfall');
  const emptyState = document.getElementById('emptyState');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightboxImg');
  const closeLightbox = document.getElementById('closeLightbox');

  let wsConnections = [];
  let sseConnections = [];
  let imageCount = 0;
  let totalLatency = 0;
  let latencyCount = 0;
  let lastRunId = '';
  let isRunning = false;
  let connectionMode = 'ws';
  let modePreference = 'auto';
  const MODE_STORAGE_KEY = 'imagine_mode';
  let pendingFallbackTimer = null;
  let currentTaskIds = [];
  let directoryHandle = null;
  let useFileSystemAPI = false;
  let isSelectionMode = false;
  let selectedImages = new Set();
  let streamSequence = 0;
  const streamImageMap = new Map();
  let finalMinBytesDefault = 100000;
  let batchSize = 12;  // 每批生成数量
  let currentBatchCount = 0;  // 当前批次已生成数量
  let isPausedByBatch = false;  // 是否因批次限制而暂停
  let savedPrompt = '';  // 保存的提示词
  let savedRatio = '';  // 保存的宽高比
  let savedConcurrent = 1;  // 保存的并发数
  let savedNsfw = true;  // 保存的 NSFW 设置
  let lastPromptTitle = '';  // 上次使用的提示词标题

  function restoreImagesFromStorage() {
    if (typeof imagineStorage !== 'undefined' && waterfall) {
      const savedImages = imagineStorage.getAllImages();
      if (savedImages && savedImages.length > 0) {
        savedImages.forEach(img => {
          const item = document.createElement('div');
          item.className = 'waterfall-item';

          const checkbox = document.createElement('div');
          checkbox.className = 'image-checkbox';

          const imgEl = document.createElement('img');
          imgEl.loading = 'lazy';
          imgEl.decoding = 'async';
          imgEl.alt = img.sequence ? `image-${img.sequence}` : 'image';
          imgEl.src = img.imageData;

          const metaBar = document.createElement('div');
          metaBar.className = 'waterfall-meta';
          const left = document.createElement('div');
          left.textContent = img.sequence ? `#${img.sequence}` : '#';
          const rightWrap = document.createElement('div');
          rightWrap.className = 'meta-right';
          const status = document.createElement('span');
          status.className = 'image-status done';
          status.textContent = '完成';
          const right = document.createElement('span');
          if (img.elapsedMs) {
            right.textContent = `${img.elapsedMs}ms`;
          } else {
            right.textContent = '';
          }

          rightWrap.appendChild(status);
          rightWrap.appendChild(right);
          metaBar.appendChild(left);
          metaBar.appendChild(rightWrap);

          item.appendChild(checkbox);
          item.appendChild(imgEl);
          item.appendChild(metaBar);

          item.dataset.imageUrl = img.imageData;
          item.dataset.prompt = img.prompt || 'image';
          item.dataset.storageId = img.id;

          if (isSelectionMode) {
            item.classList.add('selection-mode');
          }

          waterfall.appendChild(item);
          
          imageCount += 1;
          streamSequence = Math.max(streamSequence, img.sequence || 0);
        });
        
        updateCount(imageCount);
        
        if (emptyState) {
          emptyState.style.display = 'none';
        }
      }
    }
  }

  function toast(message, type) {
    if (typeof showToast === 'function') {
      showToast(message, type);
    }
  }

  function setStatus(state, text) {
    if (!statusText) return;
    statusText.textContent = text || '未连接';
    statusText.classList.remove('connected', 'connecting', 'error', 'paused');
    if (state) {
      statusText.classList.add(state);
    }
  }

  function setButtons(connected) {
    if (!startBtn || !stopBtn) return;
    if (connected) {
      startBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
    } else {
      startBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
      startBtn.disabled = false;
    }
  }

  function updateCount(value) {
    if (countValue) {
      countValue.textContent = String(value);
    }
  }

  function updateActive() {
    if (!activeValue) return;
    if (connectionMode === 'sse') {
      const active = sseConnections.filter(es => es && es.readyState === EventSource.OPEN).length;
      activeValue.textContent = String(active);
      return;
    }
    const active = wsConnections.filter(ws => ws && ws.readyState === WebSocket.OPEN).length;
    activeValue.textContent = String(active);
  }

  function setModePreference(mode, persist = true) {
    if (!['auto', 'ws', 'sse'].includes(mode)) return;
    modePreference = mode;
    modeButtons.forEach(btn => {
      if (btn.dataset.mode === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    if (persist) {
      try {
        localStorage.setItem(MODE_STORAGE_KEY, mode);
      } catch (e) {
        // ignore
      }
    }
    updateModeValue();
  }

  function updateModeValue() {}

  async function loadFilterDefaults() {
    try {
      const res = await fetch('/v1/public/imagine/config', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const value = parseInt(data && data.final_min_bytes, 10);
      if (Number.isFinite(value) && value >= 0) {
        finalMinBytesDefault = value;
      }
      if (nsfwSelect && typeof data.nsfw === 'boolean') {
        nsfwSelect.value = data.nsfw ? 'true' : 'false';
      }
    } catch (e) {
      // ignore
    }
  }


  function updateLatency(value) {
    if (value) {
      totalLatency += value;
      latencyCount += 1;
      const avg = Math.round(totalLatency / latencyCount);
      if (latencyValue) {
        latencyValue.textContent = `${avg} ms`;
      }
    } else {
      if (latencyValue) {
        latencyValue.textContent = '-';
      }
    }
  }

  function updateError(value) {}

  function setImageStatus(item, state, label) {
    if (!item) return;
    const statusEl = item.querySelector('.image-status');
    if (!statusEl) return;
    statusEl.textContent = label;
    statusEl.classList.remove('running', 'done', 'error');
    if (state) {
      statusEl.classList.add(state);
    }
  }

  function isLikelyBase64(raw) {
    if (!raw) return false;
    if (raw.startsWith('data:')) return true;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return false;
    const head = raw.slice(0, 16);
    if (head.startsWith('/9j/') || head.startsWith('iVBOR') || head.startsWith('R0lGOD')) return true;
    return /^[A-Za-z0-9+/=\s]+$/.test(raw);
  }

  function inferMime(base64) {
    if (!base64) return 'image/jpeg';
    if (base64.startsWith('iVBOR')) return 'image/png';
    if (base64.startsWith('/9j/')) return 'image/jpeg';
    if (base64.startsWith('R0lGOD')) return 'image/gif';
    return 'image/jpeg';
  }

  function estimateBase64Bytes(raw) {
    if (!raw) return null;
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return null;
    }
    if (raw.startsWith('/') && !isLikelyBase64(raw)) {
      return null;
    }
    let base64 = raw;
    if (raw.startsWith('data:')) {
      const comma = raw.indexOf(',');
      base64 = comma >= 0 ? raw.slice(comma + 1) : '';
    }
    base64 = base64.replace(/\s/g, '');
    if (!base64) return 0;
    let padding = 0;
    if (base64.endsWith('==')) padding = 2;
    else if (base64.endsWith('=')) padding = 1;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
  }

  function getFinalMinBytes() {
    return Number.isFinite(finalMinBytesDefault) && finalMinBytesDefault >= 0 ? finalMinBytesDefault : 100000;
  }

  function dataUrlToBlob(dataUrl) {
    const parts = (dataUrl || '').split(',');
    if (parts.length < 2) return null;
    const header = parts[0];
    const b64 = parts.slice(1).join(',');
    const match = header.match(/data:(.*?);base64/);
    const mime = match ? match[1] : 'application/octet-stream';
    try {
      const byteString = atob(b64);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      return new Blob([ab], { type: mime });
    } catch (e) {
      return null;
    }
  }

  async function createImagineTask(prompt, ratio, authHeader, nsfwEnabled) {
    const res = await fetch('/v1/public/imagine/start', {
      method: 'POST',
      headers: {
        ...buildAuthHeaders(authHeader),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt, aspect_ratio: ratio, nsfw: nsfwEnabled })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Failed to create task');
    }
    const data = await res.json();
    return data && data.task_id ? String(data.task_id) : '';
  }

  async function createImagineTasks(prompt, ratio, concurrent, authHeader, nsfwEnabled) {
    const tasks = [];
    for (let i = 0; i < concurrent; i++) {
      const taskId = await createImagineTask(prompt, ratio, authHeader, nsfwEnabled);
      if (!taskId) {
        throw new Error('Missing task id');
      }
      tasks.push(taskId);
    }
    return tasks;
  }

  async function stopImagineTasks(taskIds, authHeader) {
    if (!taskIds || taskIds.length === 0) return;
    try {
      await fetch('/v1/public/imagine/stop', {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(authHeader),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ task_ids: taskIds })
      });
    } catch (e) {
      // ignore
    }
  }

  async function saveToFileSystem(base64, filename) {
    try {
      if (!directoryHandle) {
        return false;
      }
      
      const mime = inferMime(base64);
      const ext = mime === 'image/png' ? 'png' : 'jpg';
      const finalFilename = filename.endsWith(`.${ext}`) ? filename : `${filename}.${ext}`;
      
      const fileHandle = await directoryHandle.getFileHandle(finalFilename, { create: true });
      const writable = await fileHandle.createWritable();
      
      // Convert base64 to blob
      const byteString = atob(base64);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: mime });
      
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) {
      console.error('File System API save failed:', e);
      return false;
    }
  }

  function downloadImage(base64, filename) {
    const mime = inferMime(base64);
    const dataUrl = `data:${mime};base64,${base64}`;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function insertPromptTitle(prompt) {
    if (!waterfall || !prompt) return;
    
    const titleElement = document.createElement('div');
    titleElement.className = 'prompt-title';
    titleElement.textContent = prompt;
    
    if (reverseInsertToggle && reverseInsertToggle.checked) {
      waterfall.prepend(titleElement);
    } else {
      waterfall.appendChild(titleElement);
    }
    
    if (autoScrollToggle && autoScrollToggle.checked) {
      if (reverseInsertToggle && reverseInsertToggle.checked) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }
    }
  }

  function appendImage(base64, meta) {
    if (!waterfall) return;
    if (autoFilterToggle && autoFilterToggle.checked) {
      const bytes = estimateBase64Bytes(base64 || '');
      const minBytes = getFinalMinBytes();
      if (bytes !== null && bytes < minBytes) {
        return;
      }
    }
    if (emptyState) {
      emptyState.style.display = 'none';
    }

    const item = document.createElement('div');
    item.className = 'waterfall-item';

    const checkbox = document.createElement('div');
    checkbox.className = 'image-checkbox';

    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = meta && meta.sequence ? `image-${meta.sequence}` : 'image';
    const mime = inferMime(base64);
    const dataUrl = `data:${mime};base64,${base64}`;
    img.src = dataUrl;

    const metaBar = document.createElement('div');
    metaBar.className = 'waterfall-meta';
    const left = document.createElement('div');
    left.textContent = meta && meta.sequence ? `#${meta.sequence}` : '#';
    const rightWrap = document.createElement('div');
    rightWrap.className = 'meta-right';
    const status = document.createElement('span');
    status.className = 'image-status done';
    status.textContent = '完成';
    const right = document.createElement('span');
    if (meta && meta.elapsed_ms) {
      right.textContent = `${meta.elapsed_ms}ms`;
    } else {
      right.textContent = '';
    }

    rightWrap.appendChild(status);
    rightWrap.appendChild(right);
    metaBar.appendChild(left);
    metaBar.appendChild(rightWrap);

    item.appendChild(checkbox);
    item.appendChild(img);
    item.appendChild(metaBar);

    const prompt = (meta && meta.prompt) ? String(meta.prompt) : (promptInput ? promptInput.value.trim() : '');
    item.dataset.imageUrl = dataUrl;
    item.dataset.prompt = prompt || 'image';
    
    // Save to storage
    if (typeof imagineStorage !== 'undefined') {
      const storageId = imagineStorage.addImage({
        prompt: prompt,
        grokUrl: meta && meta.url ? meta.url : '',
        imageData: dataUrl,
        imageId: meta && meta.image_id ? meta.image_id : '',
        aspectRatio: ratioSelect ? ratioSelect.value : '2:3',
        elapsedMs: meta && meta.elapsed_ms ? meta.elapsed_ms : 0,
        nsfw: nsfwSelect ? nsfwSelect.value === 'true' : false,
        sequence: meta && meta.sequence ? meta.sequence : 0
      });
      item.dataset.storageId = storageId;
    }
    
    if (isSelectionMode) {
      item.classList.add('selection-mode');
    }
    
    if (reverseInsertToggle && reverseInsertToggle.checked) {
      waterfall.prepend(item);
    } else {
      waterfall.appendChild(item);
    }

    if (autoScrollToggle && autoScrollToggle.checked) {
      if (reverseInsertToggle && reverseInsertToggle.checked) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }
    }

    if (autoDownloadToggle && autoDownloadToggle.checked) {
      const timestamp = Date.now();
      const seq = meta && meta.sequence ? meta.sequence : 'unknown';
      const ext = mime === 'image/png' ? 'png' : 'jpg';
      const filename = `imagine_${timestamp}_${seq}.${ext}`;
      
      if (useFileSystemAPI && directoryHandle) {
        saveToFileSystem(base64, filename).catch(() => {
          downloadImage(base64, filename);
        });
      } else {
        downloadImage(base64, filename);
      }
    }

    currentBatchCount++;
    checkBatchLimit();
  }

  function upsertStreamImage(raw, meta, imageId, isFinal) {
    if (!waterfall || !raw) return;
    if (emptyState) {
      emptyState.style.display = 'none';
    }

    if (isFinal && autoFilterToggle && autoFilterToggle.checked) {
      const bytes = estimateBase64Bytes(raw);
      const minBytes = getFinalMinBytes();
      if (bytes !== null && bytes < minBytes) {
        const existing = imageId ? streamImageMap.get(imageId) : null;
        if (existing) {
          if (selectedImages.has(existing)) {
            selectedImages.delete(existing);
            updateSelectedCount();
          }
          existing.remove();
          streamImageMap.delete(imageId);
          if (imageCount > 0) {
            imageCount -= 1;
            updateCount(imageCount);
          }
        }
        return;
      }
    }

    const isDataUrl = typeof raw === 'string' && raw.startsWith('data:');
    const looksLikeBase64 = typeof raw === 'string' && isLikelyBase64(raw);
    const isHttpUrl = typeof raw === 'string' && (raw.startsWith('http://') || raw.startsWith('https://') || (raw.startsWith('/') && !looksLikeBase64));
    const mime = isDataUrl || isHttpUrl ? '' : inferMime(raw);
    const dataUrl = isDataUrl || isHttpUrl ? raw : `data:${mime};base64,${raw}`;

    let item = imageId ? streamImageMap.get(imageId) : null;
    let isNew = false;
    if (!item) {
      isNew = true;
      streamSequence += 1;
      const sequence = streamSequence;

      item = document.createElement('div');
      item.className = 'waterfall-item';

      const checkbox = document.createElement('div');
      checkbox.className = 'image-checkbox';

      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = imageId ? `image-${imageId}` : 'image';
      img.src = dataUrl;

      const metaBar = document.createElement('div');
      metaBar.className = 'waterfall-meta';
      const left = document.createElement('div');
      left.textContent = `#${sequence}`;
      const rightWrap = document.createElement('div');
      rightWrap.className = 'meta-right';
      const status = document.createElement('span');
      status.className = `image-status ${isFinal ? 'done' : 'running'}`;
      status.textContent = isFinal ? '完成' : '生成中';
      const right = document.createElement('span');
      right.textContent = '';
      if (meta && meta.elapsed_ms) {
        right.textContent = `${meta.elapsed_ms}ms`;
      }

      rightWrap.appendChild(status);
      rightWrap.appendChild(right);
      metaBar.appendChild(left);
      metaBar.appendChild(rightWrap);

      item.appendChild(checkbox);
      item.appendChild(img);
      item.appendChild(metaBar);

      const prompt = (meta && meta.prompt) ? String(meta.prompt) : (promptInput ? promptInput.value.trim() : '');
      item.dataset.imageUrl = dataUrl;
      item.dataset.prompt = prompt || 'image';

      if (isSelectionMode) {
        item.classList.add('selection-mode');
      }

      if (reverseInsertToggle && reverseInsertToggle.checked) {
        waterfall.prepend(item);
      } else {
        waterfall.appendChild(item);
      }

      if (imageId) {
        streamImageMap.set(imageId, item);
      }

      imageCount += 1;
      updateCount(imageCount);
      
      // 保存到 storage
      if (typeof imagineStorage !== 'undefined') {
        if (!item.dataset.storageId) {
          // 第一次保存（预览图）
          const storageId = imagineStorage.addImage({
            prompt: prompt,
            grokUrl: meta && meta.url ? meta.url : '',
            imageData: dataUrl,
            imageId: imageId || '',
            aspectRatio: ratioSelect ? ratioSelect.value : '2:3',
            elapsedMs: meta && meta.elapsed_ms ? meta.elapsed_ms : 0,
            nsfw: nsfwSelect ? nsfwSelect.value === 'true' : false,
            sequence: sequence
          });
          item.dataset.storageId = storageId;
        } else if (isFinal) {
          // 更新为最终图（高清图 + Grok URL）
          imagineStorage.updateImage(item.dataset.storageId, {
            grokUrl: meta && meta.url ? meta.url : '',
            imageData: dataUrl,
            imageId: imageId || '',
            elapsedMs: meta && meta.elapsed_ms ? meta.elapsed_ms : 0
          });
        }
      }
      
      // 只在图片完全生成完成时才计入批次
      if (isFinal) {
        currentBatchCount++;
        checkBatchLimit();
      }
    } else {
      const img = item.querySelector('img');
      if (img) {
        img.src = dataUrl;
      }
      item.dataset.imageUrl = dataUrl;
      const right = item.querySelector('.waterfall-meta .meta-right span:last-child');
      if (right && meta && meta.elapsed_ms) {
        right.textContent = `${meta.elapsed_ms}ms`;
      }
    }

    setImageStatus(item, isFinal ? 'done' : 'running', isFinal ? '完成' : '生成中');
    updateError('');

    if (isNew && autoScrollToggle && autoScrollToggle.checked) {
      if (reverseInsertToggle && reverseInsertToggle.checked) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }
    }

    if (isFinal && autoDownloadToggle && autoDownloadToggle.checked) {
      const timestamp = Date.now();
      const ext = mime === 'image/png' ? 'png' : 'jpg';
      const filename = `imagine_${timestamp}_${imageId || streamSequence}.${ext}`;

      if (useFileSystemAPI && directoryHandle) {
        saveToFileSystem(raw, filename).catch(() => {
          downloadImage(raw, filename);
        });
      } else {
        downloadImage(raw, filename);
      }
    }
  }

  function handleMessage(raw) {
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!data || typeof data !== 'object') return;

    if (data.type === 'image_generation.partial_image' || data.type === 'image_generation.completed') {
      const imageId = data.image_id || data.imageId;
      const payload = data.b64_json || data.url || data.image;
      if (!payload || !imageId) {
        return;
      }
      const isFinal = data.type === 'image_generation.completed' || data.stage === 'final';
      upsertStreamImage(payload, data, imageId, isFinal);
    } else if (data.type === 'image') {
      imageCount += 1;
      updateCount(imageCount);
      updateLatency(data.elapsed_ms);
      updateError('');
      appendImage(data.b64_json, data);
    } else if (data.type === 'status') {
      if (data.status === 'running') {
        setStatus('connected', '生成中');
        lastRunId = data.run_id || '';
      } else if (data.status === 'stopped') {
        if (data.run_id && lastRunId && data.run_id !== lastRunId) {
          return;
        }
        setStatus('', '已停止');
      }
    } else if (data.type === 'error' || data.error) {
      const message = data.message || (data.error && data.error.message) || '生成失败';
      const errorImageId = data.image_id || data.imageId;
      if (errorImageId && streamImageMap.has(errorImageId)) {
        setImageStatus(streamImageMap.get(errorImageId), 'error', '失败');
      }
      updateError(message);
      toast(message, 'error');
    }
  }

  function stopAllConnections() {
    wsConnections.forEach(ws => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'stop' }));
        } catch (e) {
          // ignore
        }
      }
      try {
        ws.close(1000, 'client stop');
      } catch (e) {
        // ignore
      }
    });
    wsConnections = [];

    sseConnections.forEach(es => {
      try {
        es.close();
      } catch (e) {
        // ignore
      }
    });
    sseConnections = [];
    updateActive();
    updateModeValue();
  }

  function normalizeAuthHeader(authHeader) {
    if (!authHeader) return '';
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    return authHeader;
  }

  function buildSseUrl(taskId, index, rawPublicKey) {
    const httpProtocol = window.location.protocol === 'https:' ? 'https' : 'http';
    const base = `${httpProtocol}://${window.location.host}/v1/public/imagine/sse`;
    const params = new URLSearchParams();
    params.set('task_id', taskId);
    params.set('t', String(Date.now()));
    if (typeof index === 'number') {
      params.set('conn', String(index));
    }
    if (rawPublicKey) {
      params.set('public_key', rawPublicKey);
    }
    return `${base}?${params.toString()}`;
  }

  function startSSE(taskIds, rawPublicKey) {
    connectionMode = 'sse';
    stopAllConnections();
    updateModeValue();

    setStatus('connected', '生成中 (SSE)');
    setButtons(true);
    toast(`已启动 ${taskIds.length} 个并发任务 (SSE)`, 'success');

    for (let i = 0; i < taskIds.length; i++) {
      const url = buildSseUrl(taskIds[i], i, rawPublicKey);
      const es = new EventSource(url);

      es.onopen = () => {
        updateActive();
      };

      es.onmessage = (event) => {
        handleMessage(event.data);
      };

      es.onerror = () => {
        updateActive();
        const remaining = sseConnections.filter(e => e && e.readyState === EventSource.OPEN).length;
        if (remaining === 0) {
          setStatus('error', '连接错误');
          setButtons(false);
          isRunning = false;
          startBtn.disabled = false;
          updateModeValue();
        }
      };

      sseConnections.push(es);
    }
  }

  async function startConnection() {
    if (!isPausedByBatch) {
      currentBatchCount = 0;
    }
    
    const prompt = promptInput ? promptInput.value.trim() : '';
    if (!prompt) {
      toast('请输入提示词', 'error');
      return;
    }

    if (prompt && prompt !== lastPromptTitle) {
      insertPromptTitle(prompt);
      lastPromptTitle = prompt;
    }

    const authHeader = await ensurePublicKey();
    if (authHeader === null) {
      toast('请先配置 Public Key', 'error');
      window.location.href = '/login';
      return;
    }
    const rawPublicKey = normalizeAuthHeader(authHeader);

    const concurrent = concurrentSelect ? parseInt(concurrentSelect.value, 10) : 1;
    const ratio = ratioSelect ? ratioSelect.value : '2:3';
    const nsfwEnabled = nsfwSelect ? nsfwSelect.value === 'true' : true;
    
    if (isRunning) {
      toast('已在运行中', 'warning');
      return;
    }

    isRunning = true;
    setStatus('connecting', '连接中');
    startBtn.disabled = true;

    if (pendingFallbackTimer) {
      clearTimeout(pendingFallbackTimer);
      pendingFallbackTimer = null;
    }

    let taskIds = [];
    try {
      taskIds = await createImagineTasks(prompt, ratio, concurrent, authHeader, nsfwEnabled);
    } catch (e) {
      setStatus('error', '创建任务失败');
      startBtn.disabled = false;
      isRunning = false;
      return;
    }
    currentTaskIds = taskIds;

    if (modePreference === 'sse') {
      startSSE(taskIds, rawPublicKey);
      return;
    }

    connectionMode = 'ws';
    stopAllConnections();
    updateModeValue();

    let opened = 0;
    let fallbackDone = false;
    let fallbackTimer = null;
    if (modePreference === 'auto') {
      fallbackTimer = setTimeout(() => {
        if (!fallbackDone && opened === 0) {
          fallbackDone = true;
          startSSE(taskIds, rawPublicKey);
        }
      }, 1500);
    }
    pendingFallbackTimer = fallbackTimer;

    wsConnections = [];

    for (let i = 0; i < taskIds.length; i++) {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const params = new URLSearchParams({ task_id: taskIds[i] });
      if (rawPublicKey) {
        params.set('public_key', rawPublicKey);
      }
      const wsUrl = `${protocol}://${window.location.host}/v1/public/imagine/ws?${params.toString()}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        opened += 1;
        updateActive();
        if (i === 0) {
          setStatus('connected', '生成中');
          setButtons(true);
          toast(`已启动 ${concurrent} 个并发任务`, 'success');
        }
        sendStart(prompt, ws);
      };

      ws.onmessage = (event) => {
        handleMessage(event.data);
      };

      ws.onclose = () => {
        updateActive();
        if (connectionMode !== 'ws') {
          return;
        }
        const remaining = wsConnections.filter(w => w && w.readyState === WebSocket.OPEN).length;
        if (remaining === 0 && !fallbackDone) {
          setStatus('', '未连接');
          setButtons(false);
          isRunning = false;
          updateModeValue();
        }
      };

      ws.onerror = () => {
        updateActive();
        if (modePreference === 'auto' && opened === 0 && !fallbackDone) {
          fallbackDone = true;
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
          }
          startSSE(taskIds, rawPublicKey);
          return;
        }
        if (i === 0 && wsConnections.filter(w => w && w.readyState === WebSocket.OPEN).length === 0) {
          setStatus('error', '连接错误');
          startBtn.disabled = false;
          isRunning = false;
          updateModeValue();
        }
      };

      wsConnections.push(ws);
    }
  }

  function sendStart(promptOverride, targetWs) {
    const ws = targetWs || wsConnections[0];
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const prompt = promptOverride || (promptInput ? promptInput.value.trim() : '');
    const ratio = ratioSelect ? ratioSelect.value : '2:3';
    const nsfwEnabled = nsfwSelect ? nsfwSelect.value === 'true' : true;
    const payload = {
      type: 'start',
      prompt,
      aspect_ratio: ratio,
      nsfw: nsfwEnabled
    };
    ws.send(JSON.stringify(payload));
    updateError('');
  }

  async function stopConnection() {
    isPausedByBatch = false;
    currentBatchCount = 0;
    
    const loadingHint = document.getElementById('batchLoadingHint');
    if (loadingHint) {
      loadingHint.style.display = 'none';
    }
    
    if (pendingFallbackTimer) {
      clearTimeout(pendingFallbackTimer);
      pendingFallbackTimer = null;
    }

    const authHeader = await ensurePublicKey();
    if (authHeader !== null && currentTaskIds.length > 0) {
      await stopImagineTasks(currentTaskIds, authHeader);
    }

    stopAllConnections();
    currentTaskIds = [];
    isRunning = false;
    updateActive();
    updateModeValue();
    setButtons(false);
    setStatus('', '未连接');
  }

  function checkBatchLimit() {
    if (currentBatchCount >= batchSize && isRunning && !isPausedByBatch) {
      pauseByBatch();
    }
  }

  async function pauseByBatch() {
    isPausedByBatch = true;
    
    savedPrompt = promptInput ? promptInput.value.trim() : '';
    savedRatio = ratioSelect ? ratioSelect.value : '2:3';
    savedConcurrent = concurrentSelect ? parseInt(concurrentSelect.value, 10) : 1;
    savedNsfw = nsfwSelect ? nsfwSelect.value === 'true' : true;
    
    const authHeader = await ensurePublicKey();
    if (authHeader !== null && currentTaskIds.length > 0) {
      await stopImagineTasks(currentTaskIds, authHeader);
    }
    
    stopAllConnections();
    currentTaskIds = [];
    isRunning = false;
    updateActive();
    
    const loadingHint = document.getElementById('batchLoadingHint');
    if (loadingHint) {
      loadingHint.style.display = 'none';
    }
    
    setStatus('paused', `已生成 ${currentBatchCount} 张 - 滚动到底部继续`);
    setButtons(false);
    
    if (startBtn) {
      startBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        继续
      `;
    }
    
    toast(`已生成 ${currentBatchCount} 张图片，滚动到底部查看更多`, 'info');
  }

  async function resumeByBatch() {
    if (!isPausedByBatch) return;
    
    const loadingHint = document.getElementById('batchLoadingHint');
    if (loadingHint) {
      loadingHint.style.display = 'flex';
    }
    
    isPausedByBatch = false;
    currentBatchCount = 0;
    
    if (startBtn) {
      startBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        开始
      `;
    }
    
    if (promptInput) promptInput.value = savedPrompt;
    if (ratioSelect) ratioSelect.value = savedRatio;
    if (concurrentSelect) concurrentSelect.value = String(savedConcurrent);
    if (nsfwSelect) nsfwSelect.value = savedNsfw ? 'true' : 'false';
    
    await startConnection();
  }

  function isScrolledToBottom() {
    const threshold = 300;
    return (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - threshold);
  }

  function clearImages() {
    isPausedByBatch = false;
    currentBatchCount = 0;
    lastPromptTitle = '';
    
    const loadingHint = document.getElementById('batchLoadingHint');
    if (loadingHint) {
      loadingHint.style.display = 'none';
    }
    
    if (waterfall) {
      waterfall.innerHTML = '';
    }
    
    // Clear storage
    if (typeof imagineStorage !== 'undefined') {
      imagineStorage.clear();
    }
    
    streamImageMap.clear();
    streamSequence = 0;
    imageCount = 0;
    totalLatency = 0;
    latencyCount = 0;
    updateCount(imageCount);
    updateLatency('');
    updateError('');
    if (emptyState) {
      emptyState.style.display = 'block';
    }
  }

  if (startBtn) {
    startBtn.addEventListener('click', () => startConnection());
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      stopConnection();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => clearImages());
  }

  if (promptInput) {
    promptInput.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        startConnection();
      }
    });
  }

  loadFilterDefaults();
  restoreImagesFromStorage();

  if (ratioSelect) {
    ratioSelect.addEventListener('change', () => {
      if (isRunning) {
        if (connectionMode === 'sse') {
          stopConnection().then(() => {
            setTimeout(() => startConnection(), 50);
          });
          return;
        }
        wsConnections.forEach(ws => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            sendStart(null, ws);
          }
        });
      }
    });
  }

  if (modeButtons.length > 0) {
    const saved = (() => {
      try {
        return localStorage.getItem(MODE_STORAGE_KEY);
      } catch (e) {
        return null;
      }
    })();
    if (saved) {
      setModePreference(saved, false);
    } else {
      setModePreference('auto', false);
    }

    modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (!mode) return;
        setModePreference(mode);
        if (isRunning) {
          stopConnection().then(() => {
            setTimeout(() => startConnection(), 50);
          });
        }
      });
    });
  }

  // File System API support check
  if ('showDirectoryPicker' in window) {
    if (selectFolderBtn) {
      selectFolderBtn.disabled = false;
      selectFolderBtn.addEventListener('click', async () => {
        try {
          directoryHandle = await window.showDirectoryPicker({
            mode: 'readwrite'
          });
          useFileSystemAPI = true;
          if (folderPath) {
            folderPath.textContent = directoryHandle.name;
            selectFolderBtn.style.color = '#059669';
          }
          toast('已选择文件夹: ' + directoryHandle.name, 'success');
        } catch (e) {
          if (e.name !== 'AbortError') {
            toast('选择文件夹失败', 'error');
          }
        }
      });
    }
  }

  // Enable/disable folder selection based on auto-download
  if (autoDownloadToggle && selectFolderBtn) {
    autoDownloadToggle.addEventListener('change', () => {
      if (autoDownloadToggle.checked && 'showDirectoryPicker' in window) {
        selectFolderBtn.disabled = false;
      } else {
        selectFolderBtn.disabled = true;
      }
    });
  }

  // Collapsible cards - 点击"连接状态"标题控制所有卡片
  const statusToggle = document.getElementById('statusToggle');

  if (statusToggle) {
    statusToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const cards = document.querySelectorAll('.imagine-card-collapsible');
      const allCollapsed = Array.from(cards).every(card => card.classList.contains('collapsed'));
      
      cards.forEach(card => {
        if (allCollapsed) {
          card.classList.remove('collapsed');
        } else {
          card.classList.add('collapsed');
        }
      });
    });
  }

  // Batch download functionality
  const batchDownloadBtn = document.getElementById('batchDownloadBtn');
  const selectionToolbar = document.getElementById('selectionToolbar');
  const toggleSelectAllBtn = document.getElementById('toggleSelectAllBtn');
  const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');
  
  function enterSelectionMode() {
    isSelectionMode = true;
    selectedImages.clear();
    selectionToolbar.classList.remove('hidden');
    
    const items = document.querySelectorAll('.waterfall-item');
    items.forEach(item => {
      item.classList.add('selection-mode');
    });
    
    updateSelectedCount();
  }
  
  function exitSelectionMode() {
    isSelectionMode = false;
    selectedImages.clear();
    selectionToolbar.classList.add('hidden');
    
    const items = document.querySelectorAll('.waterfall-item');
    items.forEach(item => {
      item.classList.remove('selection-mode', 'selected');
    });
  }
  
  function toggleSelectionMode() {
    if (isSelectionMode) {
      exitSelectionMode();
    } else {
      enterSelectionMode();
    }
  }
  
  function toggleImageSelection(item) {
    if (!isSelectionMode) return;
    
    if (item.classList.contains('selected')) {
      item.classList.remove('selected');
      selectedImages.delete(item);
    } else {
      item.classList.add('selected');
      selectedImages.add(item);
    }
    
    updateSelectedCount();
  }
  
  function updateSelectedCount() {
    const countSpan = document.getElementById('selectedCount');
    if (countSpan) {
      countSpan.textContent = selectedImages.size;
    }
    if (downloadSelectedBtn) {
      downloadSelectedBtn.disabled = selectedImages.size === 0;
    }
    
    // Update toggle select all button text
    if (toggleSelectAllBtn) {
      const items = document.querySelectorAll('.waterfall-item');
      const allSelected = items.length > 0 && selectedImages.size === items.length;
      toggleSelectAllBtn.textContent = allSelected ? '取消全选' : '全选';
    }
  }
  
  function toggleSelectAll() {
    const items = document.querySelectorAll('.waterfall-item');
    const allSelected = items.length > 0 && selectedImages.size === items.length;
    
    if (allSelected) {
      // Deselect all
      items.forEach(item => {
        item.classList.remove('selected');
      });
      selectedImages.clear();
    } else {
      // Select all
      items.forEach(item => {
        item.classList.add('selected');
        selectedImages.add(item);
      });
    }
    
    updateSelectedCount();
  }
  
  async function downloadSelectedImages() {
    if (selectedImages.size === 0) {
      toast('请先选择要下载的图片', 'warning');
      return;
    }
    
    if (typeof JSZip === 'undefined') {
      toast('JSZip 库加载失败，请刷新页面重试', 'error');
      return;
    }
    
    toast(`正在打包 ${selectedImages.size} 张图片...`, 'info');
    downloadSelectedBtn.disabled = true;
    downloadSelectedBtn.textContent = '打包中...';
    
    const zip = new JSZip();
    const imgFolder = zip.folder('images');
    let processed = 0;
    
    try {
      for (const item of selectedImages) {
        const url = item.dataset.imageUrl;
        const prompt = item.dataset.prompt || 'image';
        
        try {
          let blob = null;
          if (url && url.startsWith('data:')) {
            blob = dataUrlToBlob(url);
          } else if (url) {
            const response = await fetch(url);
            blob = await response.blob();
          }
          if (!blob) {
            throw new Error('empty blob');
          }
          const filename = `${prompt.substring(0, 30).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_${processed + 1}.png`;
          imgFolder.file(filename, blob);
          processed++;
          
          // Update progress
          downloadSelectedBtn.innerHTML = `打包中... (${processed}/${selectedImages.size})`;
        } catch (error) {
          console.error('Failed to fetch image:', error);
        }
      }
      
      if (processed === 0) {
        toast('没有成功获取任何图片', 'error');
        return;
      }
      
      // Generate zip file
      downloadSelectedBtn.textContent = '生成压缩包...';
      const content = await zip.generateAsync({ type: 'blob' });
      
      // Download zip
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `imagine_${new Date().toISOString().slice(0, 10)}_${Date.now()}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
      
      toast(`成功打包 ${processed} 张图片`, 'success');
      exitSelectionMode();
    } catch (error) {
      console.error('Download failed:', error);
      toast('打包失败，请重试', 'error');
    } finally {
    downloadSelectedBtn.disabled = false;
    downloadSelectedBtn.innerHTML = `下载 <span id="selectedCount" class="selected-count">${selectedImages.size}</span>`;
    }
  }
  
  if (batchDownloadBtn) {
    batchDownloadBtn.addEventListener('click', toggleSelectionMode);
  }
  
  if (toggleSelectAllBtn) {
    toggleSelectAllBtn.addEventListener('click', toggleSelectAll);
  }
  
  if (downloadSelectedBtn) {
    downloadSelectedBtn.addEventListener('click', downloadSelectedImages);
  }
  
  
  if (waterfall) {
    waterfall.addEventListener('click', (e) => {
      const item = e.target.closest('.waterfall-item');
      if (!item) return;
      
      if (isSelectionMode) {
        toggleImageSelection(item);
      } else {
        if (e.target.closest('.waterfall-item img')) {
          const storageId = item.dataset.storageId;
          if (storageId) {
            openImageModal(storageId);
          }
        }
      }
    });
  }

  // Lightbox for image preview with navigation
  const lightboxPrev = document.getElementById('lightboxPrev');
  const lightboxNext = document.getElementById('lightboxNext');
  let currentImageIndex = -1;
  
  function getAllImages() {
    return Array.from(document.querySelectorAll('.waterfall-item img'));
  }
  
  function updateLightbox(index) {
    const images = getAllImages();
    if (index < 0 || index >= images.length) return;
    
    currentImageIndex = index;
    lightboxImg.src = images[index].src;
    
    // Update navigation buttons state
    if (lightboxPrev) lightboxPrev.disabled = (index === 0);
    if (lightboxNext) lightboxNext.disabled = (index === images.length - 1);
  }
  
  function showPrevImage() {
    if (currentImageIndex > 0) {
      updateLightbox(currentImageIndex - 1);
    }
  }
  
  function showNextImage() {
    const images = getAllImages();
    if (currentImageIndex < images.length - 1) {
      updateLightbox(currentImageIndex + 1);
    }
  }
  
  if (lightbox && closeLightbox) {
    closeLightbox.addEventListener('click', (e) => {
      e.stopPropagation();
      lightbox.classList.remove('active');
      currentImageIndex = -1;
    });

    lightbox.addEventListener('click', () => {
      lightbox.classList.remove('active');
      currentImageIndex = -1;
    });

    // Prevent closing when clicking on the image
    if (lightboxImg) {
      lightboxImg.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }
    
    // Navigation buttons
    if (lightboxPrev) {
      lightboxPrev.addEventListener('click', (e) => {
        e.stopPropagation();
        showPrevImage();
      });
    }
    
    if (lightboxNext) {
      lightboxNext.addEventListener('click', (e) => {
        e.stopPropagation();
        showNextImage();
      });
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (!lightbox.classList.contains('active')) return;
      
      if (e.key === 'Escape') {
        lightbox.classList.remove('active');
        currentImageIndex = -1;
      } else if (e.key === 'ArrowLeft') {
        showPrevImage();
      } else if (e.key === 'ArrowRight') {
        showNextImage();
      }
    });
  }

  window.addEventListener('scroll', () => {
    if (isPausedByBatch && isScrolledToBottom()) {
      resumeByBatch();
    }
  });

  // Make floating actions draggable
  const floatingActions = document.getElementById('floatingActions');
  if (floatingActions) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    
    floatingActions.style.touchAction = 'none';
    
    floatingActions.addEventListener('pointerdown', (e) => {
      if (e.target.tagName.toLowerCase() === 'button' || e.target.closest('button')) return;
      
      e.preventDefault();
      isDragging = true;
      floatingActions.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;
      
      const rect = floatingActions.getBoundingClientRect();
      
      if (!floatingActions.style.left || floatingActions.style.left === '') {
        floatingActions.style.left = rect.left + 'px';
        floatingActions.style.top = rect.top + 'px';
        floatingActions.style.transform = 'none';
        floatingActions.style.bottom = 'auto';
      }
      
      initialLeft = parseFloat(floatingActions.style.left);
      initialTop = parseFloat(floatingActions.style.top);
      
      floatingActions.classList.add('shadow-xl');
    });
    
    document.addEventListener('pointermove', (e) => {
      if (!isDragging) return;
      
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      
      floatingActions.style.left = `${initialLeft + dx}px`;
      floatingActions.style.top = `${initialTop + dy}px`;
    });
    
    document.addEventListener('pointerup', (e) => {
      if (isDragging) {
        isDragging = false;
        floatingActions.releasePointerCapture(e.pointerId);
        floatingActions.classList.remove('shadow-xl');
      }
    });
  }

  const modal = document.getElementById('imageDetailModal');
  const modalOverlay = modal?.querySelector('.modal-overlay');
  const modalClose = modal?.querySelector('.modal-close');
  const modalImage = document.getElementById('modalImage');
  const modalPrevBtn = document.getElementById('modalPrevBtn');
  const modalNextBtn = document.getElementById('modalNextBtn');
  const modalNavIndicator = document.getElementById('modalNavIndicator');
  const copyPromptBtn = document.getElementById('copyPromptBtn');
  const copyGrokUrlBtn = document.getElementById('copyGrokUrlBtn');
  const downloadImageBtn = document.getElementById('downloadImageBtn');
  
  let currentModalImageId = null;
  let allModalImages = [];
  
  function openImageModal(storageId) {
    if (!modal || typeof imagineStorage === 'undefined') return;
    
    const imageData = imagineStorage.getImage(storageId);
    if (!imageData) return;
    
    allModalImages = imagineStorage.getAllImages();
    const currentIndex = allModalImages.findIndex(img => img.id === storageId);
    if (currentIndex === -1) return;
    
    currentModalImageId = storageId;
    
    if (modalImage) modalImage.src = imageData.imageData;
    const modalPrompt = document.getElementById('modalPrompt');
    const modalGrokUrl = document.getElementById('modalGrokUrl');
    const modalSequence = document.getElementById('modalSequence');
    const modalElapsedMs = document.getElementById('modalElapsedMs');
    const modalAspectRatio = document.getElementById('modalAspectRatio');
    const modalNsfw = document.getElementById('modalNsfw');
    const modalImageId = document.getElementById('modalImageId');
    
    if (modalPrompt) modalPrompt.textContent = imageData.prompt || '无';
    if (modalGrokUrl) modalGrokUrl.textContent = imageData.grokUrl || '无';
    if (modalSequence) modalSequence.textContent = imageData.sequence || '-';
    if (modalElapsedMs) modalElapsedMs.textContent = imageData.elapsedMs ? `${imageData.elapsedMs}ms` : '-';
    if (modalAspectRatio) modalAspectRatio.textContent = imageData.aspectRatio || '-';
    if (modalNsfw) modalNsfw.textContent = imageData.nsfw ? '是' : '否';
    if (modalImageId) modalImageId.textContent = imageData.imageId || '-';
    
    const imageToImagePrompt = document.getElementById('imageToImagePrompt');
    if (imageToImagePrompt) {
      imageToImagePrompt.value = imageData.prompt || '';
    }
    
    if (modalNavIndicator) {
      modalNavIndicator.textContent = `${currentIndex + 1}/${allModalImages.length}`;
    }
    
    if (modalPrevBtn) modalPrevBtn.disabled = currentIndex === 0;
    if (modalNextBtn) modalNextBtn.disabled = currentIndex === allModalImages.length - 1;
    
    const modalEditHistory = document.getElementById('modalEditHistory');
    const editHistoryThumbnails = document.getElementById('editHistoryThumbnails');
    
    if (modalEditHistory && editHistoryThumbnails) {
      let historyImages = [];
      
      if (imageData.edits && imageData.edits.length > 0) {
        historyImages.push(imageData);
        imageData.edits.forEach(editId => {
          const editImage = imagineStorage.getImage(editId);
          if (editImage) historyImages.push(editImage);
        });
      }
      else if (imageData.parentId) {
        const parent = imagineStorage.getImage(imageData.parentId);
        if (parent) {
          historyImages.push(parent);
          if (parent.edits && parent.edits.length > 0) {
            parent.edits.forEach(editId => {
              const editImage = imagineStorage.getImage(editId);
              if (editImage) historyImages.push(editImage);
            });
          }
        }
      }
      
      if (historyImages.length > 1) {
        editHistoryThumbnails.innerHTML = '';
        historyImages.forEach(img => {
          const thumb = document.createElement('div');
          thumb.className = 'edit-history-thumbnail';
          if (img.id === storageId) {
            thumb.classList.add('active');
          }
          
          const thumbImg = document.createElement('img');
          thumbImg.src = img.imageData;
          thumbImg.alt = 'thumbnail';
          thumb.appendChild(thumbImg);
          
          thumb.addEventListener('click', () => {
            openImageModal(img.id);
          });
          
          editHistoryThumbnails.appendChild(thumb);
        });
        
        modalEditHistory.style.display = 'block';
      } else {
        modalEditHistory.style.display = 'none';
      }
    }
    
    modal.style.display = 'block';
  }
  
  function closeImageModal() {
    if (!modal) return;
    modal.style.display = 'none';
    currentModalImageId = null;
  }
  
  function navigateModal(direction) {
    if (!currentModalImageId || allModalImages.length === 0) return;
    
    const currentIndex = allModalImages.findIndex(img => img.id === currentModalImageId);
    if (currentIndex === -1) return;
    
    let newIndex = currentIndex;
    if (direction === 'prev' && currentIndex > 0) {
      newIndex = currentIndex - 1;
    } else if (direction === 'next' && currentIndex < allModalImages.length - 1) {
      newIndex = currentIndex + 1;
    }
    
    if (newIndex !== currentIndex) {
      openImageModal(allModalImages[newIndex].id);
    }
  }
  
  if (modalClose) modalClose.addEventListener('click', closeImageModal);
  if (modalOverlay) modalOverlay.addEventListener('click', closeImageModal);
  if (modalPrevBtn) modalPrevBtn.addEventListener('click', () => navigateModal('prev'));
  if (modalNextBtn) modalNextBtn.addEventListener('click', () => navigateModal('next'));
  
  document.addEventListener('keydown', (e) => {
    if (modal?.style.display === 'block') {
      if (e.key === 'Escape') closeImageModal();
      else if (e.key === 'ArrowLeft') navigateModal('prev');
      else if (e.key === 'ArrowRight') navigateModal('next');
    }
  });
  
  if (copyPromptBtn) {
    copyPromptBtn.addEventListener('click', async () => {
      const prompt = document.getElementById('modalPrompt')?.textContent;
      if (prompt && prompt !== '无') {
        try {
          await navigator.clipboard.writeText(prompt);
          toast('提示词已复制', 'success');
        } catch (err) {
          toast('复制失败', 'error');
        }
      }
    });
  }
  
  if (copyGrokUrlBtn) {
    copyGrokUrlBtn.addEventListener('click', async () => {
      const url = document.getElementById('modalGrokUrl')?.textContent;
      if (url && url !== '无') {
        try {
          await navigator.clipboard.writeText(url);
          toast('URL 已复制', 'success');
        } catch (err) {
          toast('复制失败', 'error');
        }
      }
    });
  }
  
  if (downloadImageBtn) {
    downloadImageBtn.addEventListener('click', () => {
      if (!currentModalImageId) return;
      const imageData = imagineStorage.getImage(currentModalImageId);
      if (!imageData) return;
      
      const a = document.createElement('a');
      a.href = imageData.imageData;
      a.download = `imagine_${imageData.sequence}_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast('图片已下载', 'success');
    });
  }
  
  const imageToImageGenerateBtn = document.getElementById('imageToImageGenerateBtn');
  const imageToImagePrompt = document.getElementById('imageToImagePrompt');
  const imageToImageLoading = document.getElementById('imageToImageLoading');
  
  if (imageToImageGenerateBtn) {
    imageToImageGenerateBtn.addEventListener('click', async () => {
      if (!currentModalImageId) return;
      
      const imageData = imagineStorage.getImage(currentModalImageId);
      if (!imageData) return;
      
      const prompt = imageToImagePrompt ? imageToImagePrompt.value.trim() : '';
      if (!prompt) {
        toast('请输入提示词', 'error');
        return;
      }
      
      const grokUrl = imageData.grokUrl;
      if (!grokUrl) {
        toast('当前图片缺少 Grok URL，无法进行图生图', 'error');
        return;
      }
      
      const authHeader = await ensurePublicKey();
      if (authHeader === null) {
        toast('请先配置 Public Key', 'error');
        return;
      }
      
      imageToImageGenerateBtn.disabled = true;
      if (imageToImageLoading) imageToImageLoading.style.display = 'block';
      
      try {
        const aspectRatio = imageData.aspectRatio || '2:3';
        const nsfw = imageData.nsfw || false;
        
        const response = await fetch('/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader
          },
          body: JSON.stringify({
            model: 'grok-imagine-1.0-edit',
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: grokUrl
                  }
                },
                {
                  type: 'text',
                  text: prompt
                }
              ]
            }],
            image_config: {
              n: 1,
              size: aspectRatio,
              response_format: 'url'
            }
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(errorText || '生成失败');
        }
        
        const data = await response.json();
        const choice = data.choices && data.choices[0];
        if (!choice || !choice.message || !choice.message.content) {
          throw new Error('响应格式错误');
        }
        
        const content = choice.message.content;
        let newGrokUrl = '';
        let newImageData = '';
        let newImageId = '';
        
        if (typeof content === 'string') {
          try {
            const parsed = JSON.parse(content);
            newGrokUrl = parsed.url || '';
            newImageData = parsed.b64_json ? `data:image/png;base64,${parsed.b64_json}` : '';
            newImageId = parsed.image_id || '';
          } catch (e) {
            newGrokUrl = content;
          }
        } else if (Array.isArray(content)) {
          for (const item of content) {
            if (item.type === 'image_url' && item.image_url) {
              newGrokUrl = item.image_url.url || '';
            }
          }
        }
        
        if (!newGrokUrl && !newImageData) {
          throw new Error('未获取到生成的图片');
        }
        
        if (newGrokUrl && !newImageData) {
          const imgResponse = await fetch(newGrokUrl);
          const blob = await imgResponse.blob();
          const reader = new FileReader();
          await new Promise((resolve, reject) => {
            reader.onloadend = () => {
              newImageData = reader.result;
              resolve();
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
        
        const newId = imagineStorage.addEdit(currentModalImageId, {
          prompt: prompt,
          grokUrl: newGrokUrl,
          imageData: newImageData,
          imageId: newImageId,
          aspectRatio: aspectRatio,
          elapsedMs: 0,
          nsfw: nsfw,
          sequence: imageCount + 1
        });
        
        if (!newId) {
          throw new Error('保存图片失败');
        }
        
        const base64 = newImageData.split(',')[1] || newImageData;
        appendImage(base64, {
          prompt: prompt,
          url: newGrokUrl,
          image_id: newImageId,
          elapsed_ms: 0,
          sequence: imageCount
        });
        
        toast('图生图生成成功', 'success');
        
        setTimeout(() => {
          openImageModal(newId);
        }, 100);
        
      } catch (error) {
        console.error('Image-to-image generation failed:', error);
        toast(error.message || '图生图生成失败', 'error');
      } finally {
        imageToImageGenerateBtn.disabled = false;
        if (imageToImageLoading) imageToImageLoading.style.display = 'none';
      }
    });
  }
  
  const generateVideoBtn = document.getElementById('generateVideoBtn');
  
  if (generateVideoBtn) {
    generateVideoBtn.addEventListener('click', () => {
      if (!currentModalImageId) return;
      
      const imageData = imagineStorage.getImage(currentModalImageId);
      if (!imageData) return;
      
      const grokUrl = imageData.grokUrl;
      if (!grokUrl) {
        toast('当前图片缺少 Grok URL，无法生成视频', 'error');
        return;
      }
      
      const prompt = imageData.prompt || '';
      
      // 构造 URL 参数
      const params = new URLSearchParams();
      params.set('image', grokUrl);
      if (prompt) {
        params.set('prompt', prompt);
      }
      
      // 跳转到 video 页面
      window.location.href = `/video?${params.toString()}`;
    });
  }
})();
