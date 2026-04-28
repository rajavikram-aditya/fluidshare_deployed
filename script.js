/* =============================================
   SUS · FLUIDSHARE — MAIN SCRIPT  v2.0
   Secure University Systems · File Transfer
   script.js
   ─────────────────────────────────────────
   Features:
     • AES-256-GCM end‑to‑end encryption
     • PBKDF2 key derivation from password
     • Per-chunk encryption with unique IVs
     • Lazy file.slice() streaming (no full RAM load)
     • ACK-based flow control
     • Real-time progress / speed / ETA
     • Robust STUN/TURN ICE configuration
============================================= */

let senderPeer;
let receiverPeer;

const CHUNK_SIZE = 64 * 1024; // 64 KB

// ---- Robust ICE config: multiple STUN + free TURN fallback ----
const PEER_CONFIG = {
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
            { urls: 'stun:stun.relay.metered.ca:80' },
            // Free TURN relay fallback (for restrictive NATs/firewalls)
            {
                urls: 'turn:a.relay.metered.ca:80',
                username: 'e8dd65b92a0d42e5a034e627',
                credential: 'mIB+aem1m/GYZQ8t'
            },
            {
                urls: 'turn:a.relay.metered.ca:443',
                username: 'e8dd65b92a0d42e5a034e627',
                credential: 'mIB+aem1m/GYZQ8t'
            },
            {
                urls: 'turn:a.relay.metered.ca:443?transport=tcp',
                username: 'e8dd65b92a0d42e5a034e627',
                credential: 'mIB+aem1m/GYZQ8t'
            }
        ]
    }
};

// ============================================================
//  ENCRYPTION ENGINE (Web Crypto API) — Per‑Chunk
// ============================================================

/**
 * Derive an AES-256-GCM key from a password + salt.
 * Uses PBKDF2 with 310,000 iterations (OWASP recommended).
 */
async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypt a single chunk. Each chunk gets its own random 12-byte IV,
 * which is prepended to the ciphertext for self-contained transport.
 * Format: [12-byte IV | ciphertext+tag]
 */
async function encryptChunk(chunkBuffer, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        chunkBuffer
    );
    // Combine IV + ciphertext into one ArrayBuffer for transport
    const combined = new Uint8Array(12 + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), 12);
    return combined.buffer;
}

/**
 * Decrypt a single chunk. Extracts the 12-byte IV prefix, then decrypts.
 */
async function decryptChunk(encryptedBuffer, key) {
    const data = new Uint8Array(encryptedBuffer);
    const iv = data.slice(0, 12);
    const ciphertext = data.slice(12);
    return crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
    );
}

// ============================================================
//  UTILITY HELPERS
// ============================================================

const setStatus = (elementId, message, isError = false) => {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = message;
        el.style.color = isError ? '#FF4D4D' : '';
    }
};

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatETA(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '';
    if (seconds < 60) return `~${Math.ceil(seconds)}s left`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return `~${mins}m ${secs}s left`;
}

function updateProgress(side, pct, speedBps, etaSeconds) {
    const fill  = document.getElementById(`${side}-progress-fill`);
    const pctEl = document.getElementById(`${side}-pct`);
    const spdEl = document.getElementById(`${side}-speed`);
    const cont  = document.getElementById(`${side}-progress`);

    if (cont) cont.classList.add('active');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
    if (spdEl) {
        let info = '';
        if (speedBps > 0) info += formatBytes(speedBps) + '/s';
        if (etaSeconds) info += '  ' + formatETA(etaSeconds);
        spdEl.textContent = info;
    }
}

function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.title = isHidden ? 'Hide password' : 'Show password';
}

function getShareUrl() {
    const key = document.getElementById('sender-room-key').value.trim();
    if (!key) return '';
    return `${location.origin}/receive.html?room=${encodeURIComponent(key)}`;
}

function copyShareLink() {
    const url = getShareUrl();
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
        setStatus('sender-status', '✓ Receive link copied!');
        setTimeout(() => setStatus('sender-status', ''), 3000);
    });
}

function copyShareCode() {
    const keyInput = document.getElementById('sender-room-key');
    if (!keyInput || !keyInput.value) {
        setStatus('sender-status', 'Generate a share code first.', true);
        return;
    }
    navigator.clipboard.writeText(keyInput.value).then(() => {
        setStatus('sender-status', '✓ Share code copied!');
        setTimeout(() => setStatus('sender-status', ''), 3000);
    }).catch(err => {
        console.error('Copy failed', err);
        setStatus('sender-status', 'Failed to copy to clipboard.', true);
    });
}

// ---- Attach connection status listeners ----
const attachConnectionListeners = (peerObject) => {
    const statusContainer = document.getElementById('connection-status');
    const statusText = document.getElementById('connection-status-text');

    peerObject.on('open', id => {
        if (statusContainer) statusContainer.classList.add('connected');
        if (statusText) statusText.textContent = 'Connected to signaling server';
        if (window.__onPeerReady) window.__onPeerReady();
    });

    peerObject.on('error', err => {
        if (statusContainer) statusContainer.classList.remove('connected');
        if (statusText) statusText.textContent = `Connection error: ${err.type}. Please refresh.`;
        console.error('PeerJS error:', err);
    });

    peerObject.on('disconnected', () => {
        if (statusContainer) statusContainer.classList.remove('connected');
        if (statusText) statusText.textContent = 'Disconnected. Attempting reconnect…';
        // Auto-reconnect on disconnect
        try { peerObject.reconnect(); } catch (e) { /* already destroyed */ }
    });
};

// ============================================================
//  SENDER LOGIC — Streaming + Per‑Chunk Encryption
// ============================================================

function createRoomAndShare() {
    const roomKey   = document.getElementById('sender-room-key').value.trim();
    const password  = document.getElementById('sender-password').value;
    const fileInput = document.getElementById('file-input');
    const file      = fileInput.files[0];

    if (!roomKey) {
        setStatus('sender-status', 'Please enter or generate a share code.', true);
        return;
    }
    if (!file) {
        setStatus('sender-status', 'Please select a file first.', true);
        return;
    }

    // Destroy old sender peer before creating a new one
    if (senderPeer && !senderPeer.destroyed) senderPeer.destroy();

    senderPeer = new Peer(roomKey, PEER_CONFIG);
    attachConnectionListeners(senderPeer);

    senderPeer.on('open', id => {
        setStatus('sender-status', 'Room created. Waiting for receiver…');

        // Show share link section
        const shareSection = document.getElementById('share-link-section');
        if (shareSection) shareSection.style.display = 'block';

        // Generate QR code
        const shareUrl = getShareUrl();
        const qrWrap = document.getElementById('qr-wrap');
        const qrEl = document.getElementById('qr-code');
        if (qrWrap && qrEl && typeof QRCode !== 'undefined' && shareUrl) {
            qrEl.innerHTML = '';
            new QRCode(qrEl, {
                text: shareUrl,
                width: 120,
                height: 120,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
            qrWrap.style.display = 'block';
            const qrLabel = document.getElementById('qr-label');
            if (qrLabel) qrLabel.style.display = 'block';
        }
    });

    senderPeer.on('connection', conn => {
        setStatus('sender-status', 'Receiver connected. Preparing file…');

        // ---- State machine for ACK-driven streaming ----
        let sendNextChunk = null;  // set after metadata ACK

        conn.on('data', async data => {
            // ① Receiver requested the file → send metadata
            if (data === 'request-file') {
                try {
                    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
                    const encrypted = !!password;

                    // Derive key once if password is set
                    let cryptoKey = null;
                    let salt = null;
                    if (encrypted) {
                        salt = crypto.getRandomValues(new Uint8Array(16));
                        cryptoKey = await deriveKey(password, salt);
                        setStatus('sender-status', 'Key derived. Sending metadata…');
                    }

                    // Send metadata
                    conn.send({
                        type: 'metadata',
                        fileName: file.name,
                        fileSize: file.size,
                        encrypted,
                        salt: salt ? Array.from(salt) : null,
                        totalChunks
                    });

                    // Prepare the chunk streamer (called on each ACK)
                    let chunkIndex = 0;
                    const startTime = Date.now();

                    sendNextChunk = async () => {
                        if (chunkIndex >= totalChunks) {
                            conn.send({ type: 'done' });
                            setStatus('sender-status', '✓ File sent successfully!');
                            updateProgress('sender', 100, 0);
                            sendNextChunk = null; // prevent further sends
                            return;
                        }

                        const start = chunkIndex * CHUNK_SIZE;
                        const end   = Math.min(start + CHUNK_SIZE, file.size);

                        // ★ Lazy read: only load THIS chunk from disk
                        const slice = file.slice(start, end);
                        let chunkBuffer = await slice.arrayBuffer();

                        // ★ Per-chunk encryption (IV is embedded in payload)
                        if (encrypted) {
                            chunkBuffer = await encryptChunk(chunkBuffer, cryptoKey);
                        }

                        conn.send({
                            type: 'chunk',
                            index: chunkIndex,
                            data: new Uint8Array(chunkBuffer)
                        });

                        chunkIndex++;
                        const pct = (chunkIndex / totalChunks) * 100;
                        const elapsed = (Date.now() - startTime) / 1000;
                        const bytesSent = Math.min(chunkIndex * CHUNK_SIZE, file.size);
                        const speed = elapsed > 0 ? bytesSent / elapsed : 0;
                        const remaining = file.size - bytesSent;
                        const eta = speed > 0 ? remaining / speed : 0;

                        updateProgress('sender', pct, speed, eta);
                        setStatus('sender-status', `Sending ${chunkIndex}/${totalChunks} · ${formatBytes(bytesSent)} of ${formatBytes(file.size)}`);
                    };

                } catch (err) {
                    console.error('Encryption/send error:', err);
                    setStatus('sender-status', 'Encryption error. Check password.', true);
                }
                return;
            }

            // ② ACK received → send next chunk
            if (data === 'ack' || (data && data.type === 'ack')) {
                if (sendNextChunk) {
                    await sendNextChunk();
                }
                return;
            }
        });

        conn.on('error', err => {
            console.error('Sender conn error:', err);
            setStatus('sender-status', 'Connection error while sending.', true);
        });
    });

    senderPeer.on('error', err => {
        if (err.type === 'unavailable-id') {
            setStatus('sender-status', 'Share code already taken. Try another.', true);
        } else if (err.type === 'peer-unavailable') {
            setStatus('sender-status', 'Could not reach receiver. Are they connected?', true);
        } else {
            console.error('Sender PeerJS error:', err);
            setStatus('sender-status', `Error: ${err.type}`, true);
        }
    });
}

// ============================================================
//  RECEIVER LOGIC — Per‑Chunk Decryption + ACK Flow
// ============================================================

function connectAndDownload() {
    const roomKey  = document.getElementById('receiver-room-key').value.trim();
    const password = document.getElementById('receiver-password').value;

    if (!roomKey) {
        setStatus('receiver-status', 'Please enter the sender\'s room key.', true);
        return;
    }

    // Always create a fresh receiver peer to avoid stale state
    if (receiverPeer && !receiverPeer.destroyed) receiverPeer.destroy();

    receiverPeer = new Peer(PEER_CONFIG);  // random ID for receiver
    attachConnectionListeners(receiverPeer);

    const ph = document.getElementById('recv-placeholder');
    if (ph) {
        ph.classList.add('loading');
        const span = ph.querySelector('span');
        if (span) span.innerText = 'connecting...';
    }

    // Speed tracking state
    let bytesThisSecond = 0;
    let speedInterval = null;
    const speedEl = document.getElementById('recv-speed');

    let connTimeout = setTimeout(() => {
        setStatus('receiver-status', 'Could not reach sender. Check room key or ask sender to refresh.', true);
        if (ph) {
            ph.classList.remove('loading');
            const span = ph.querySelector('span');
            if (span) span.innerText = 'awaiting connection';
        }
        if (receiverPeer && !receiverPeer.destroyed) receiverPeer.destroy();
    }, 10000);

    receiverPeer.on('open', () => {
        setStatus('receiver-status', 'Connecting to sender…');
        const conn = receiverPeer.connect(roomKey, { reliable: true });

        let metadata = null;
        const decryptedChunks = [];
        let startTime;
        let cryptoKey = null;

        conn.on('open', () => {
            clearTimeout(connTimeout);
            if (ph) {
                ph.classList.remove('loading');
                const span = ph.querySelector('span');
                if (span) span.innerText = 'receiving stream';
            }
            setStatus('receiver-status', 'Connected. Requesting file…');

            // Start speed tracking interval
            speedInterval = setInterval(() => {
                if (speedEl) {
                    const mbps = bytesThisSecond / 1048576;
                    speedEl.textContent = mbps > 0 ? `${mbps.toFixed(1)} MB/s` : '';
                }
                bytesThisSecond = 0;
            }, 1000);

            conn.send('request-file');
        });

        conn.on('data', async data => {
            // ---- Handle metadata ----
            if (data && data.type === 'metadata') {
                metadata = data;
                decryptedChunks.length = 0;
                startTime = Date.now();

                // Derive decryption key once if file is encrypted
                if (metadata.encrypted) {
                    if (!password) {
                        setStatus('receiver-status', 'This file is encrypted. Please enter a password.', true);
                        conn.close();
                        return;
                    }
                    try {
                        cryptoKey = await deriveKey(password, new Uint8Array(metadata.salt));
                    } catch (err) {
                        setStatus('receiver-status', 'Key derivation failed. Check password.', true);
                        conn.close();
                        return;
                    }
                }

                setStatus('receiver-status', `Receiving: ${metadata.fileName} (${formatBytes(metadata.fileSize)})`);
                // ACK metadata — tells sender to start streaming
                conn.send('ack');
                return;
            }

            // ---- Handle chunk ----
            if (data && data.type === 'chunk') {
                try {
                    let plainChunk;
                    if (metadata.encrypted) {
                        // Per-chunk decryption (IV is embedded in first 12 bytes)
                        try {
                            plainChunk = await decryptChunk(data.data.buffer || data.data, cryptoKey);
                        } catch (decErr) {
                            console.error('Decryption failed:', decErr);
                            setStatus('receiver-status', 'Wrong password — decryption failed.', 'error');
                            if (speedInterval) clearInterval(speedInterval);
                            if (speedEl) speedEl.textContent = '';
                            conn.close();
                            return;
                        }
                    } else {
                        plainChunk = data.data.buffer || data.data;
                    }

                    decryptedChunks.push(plainChunk);

                    // Track bytes for speed display
                    bytesThisSecond += plainChunk.byteLength;

                    const chunksReceived = data.index + 1;
                    const pct = (chunksReceived / metadata.totalChunks) * 100;
                    const elapsed = (Date.now() - startTime) / 1000;
                    const bytesReceived = chunksReceived * CHUNK_SIZE;
                    const speed = elapsed > 0 ? bytesReceived / elapsed : 0;
                    const remaining = metadata.fileSize - bytesReceived;
                    const eta = speed > 0 ? remaining / speed : 0;

                    updateProgress('receiver', pct, speed, eta);
                    setStatus('receiver-status', `Receiving ${chunksReceived}/${metadata.totalChunks} · ${formatBytes(bytesReceived)} of ${formatBytes(metadata.fileSize)}`);

                    // ACK this chunk — tells sender to send next
                    conn.send('ack');
                } catch (err) {
                    console.error('Chunk processing error:', err);
                    setStatus('receiver-status', 'Decryption failed. Wrong password?', true);
                    if (speedInterval) clearInterval(speedInterval);
                    if (speedEl) speedEl.textContent = '';
                    conn.close();
                }
                return;
            }

            // ---- Handle done ----
            if (data && data.type === 'done') {
                try {
                    // Stop speed tracking
                    if (speedInterval) clearInterval(speedInterval);
                    if (speedEl) speedEl.textContent = '';

                    setStatus('receiver-status', 'Assembling file…');

                    // Combine all decrypted chunks
                    const totalLength = decryptedChunks.reduce((s, c) => s + c.byteLength, 0);
                    const combined = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const chunk of decryptedChunks) {
                        combined.set(new Uint8Array(chunk), offset);
                        offset += chunk.byteLength;
                    }

                    // Trigger download
                    const blob = new Blob([combined], { type: 'application/octet-stream' });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href     = url;
                    a.download = metadata.fileName || 'downloaded_file';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);

                    // Clean up object URL after a short delay
                    setTimeout(() => URL.revokeObjectURL(url), 3000);

                    updateProgress('receiver', 100, 0);
                    setStatus('receiver-status', '✓ Download complete!');

                    // Show transfer complete summary card
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    if (ph) {
                        ph.innerHTML = `
                            <div class="transfer-summary">
                                <div class="transfer-summary-icon">✓</div>
                                <div class="transfer-summary-title">Transfer complete</div>
                                <div class="transfer-summary-row"><span>File</span><span>${metadata.fileName}</span></div>
                                <div class="transfer-summary-row"><span>Size</span><span>${formatBytes(metadata.fileSize)}</span></div>
                                <div class="transfer-summary-row"><span>Time</span><span>${elapsed}s</span></div>
                                <button class="btn btn-recv btn-full" onclick="resetReceiverForm()" style="margin-top:12px; font-size:12px;">Transfer Another</button>
                            </div>
                        `;
                        ph.style.borderColor = 'rgba(0, 207, 255, 0.35)';
                    }

                    conn.close();
                } catch (err) {
                    console.error('Assembly error:', err);
                    setStatus('receiver-status', 'File assembly failed.', true);
                    if (speedInterval) clearInterval(speedInterval);
                    if (speedEl) speedEl.textContent = '';
                }
                return;
            }

            // Legacy: handle old-style single-object transfer
            if (data && data.fileData) {
                setStatus('receiver-status', 'File received (legacy). Downloading…');
                const blob = new Blob([data.fileData], { type: 'application/octet-stream' });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement('a');
                a.href     = url;
                a.download = data.fileName || 'downloaded_file';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                setStatus('receiver-status', '✓ Download complete!');
                if (ph && ph.querySelector('span')) ph.querySelector('span').innerText = 'transfer complete';
                conn.close();
            }
        });

        conn.on('error', err => {
            clearTimeout(connTimeout);
            if (ph) {
                ph.classList.remove('loading');
                const span = ph.querySelector('span');
                if (span) span.innerText = 'awaiting connection';
            }
            console.error('Receiver conn error:', err);
            setStatus('receiver-status', 'Connection failed. Check the share code.', true);
        });
    });

    receiverPeer.on('error', err => {
        clearTimeout(connTimeout);
        if (ph) {
            ph.classList.remove('loading');
            const span = ph.querySelector('span');
            if (span) span.innerText = 'awaiting connection';
        }
        console.error('Receiver peer error:', err);
        if (err.type === 'peer-unavailable') {
            setStatus('receiver-status', 'Sender not found. Is the share code correct?', true);
        } else {
            setStatus('receiver-status', `Error: ${err.type}. Please try again.`, true);
        }
    });
}

// ============================================================
//  UI HELPERS
// ============================================================

function generateKey() {
    const adjectives = ['arctic','cobalt','velvet','neon','amber','silent','drift','jade','onyx','solar','crystal','ember','nova','storm','lunar'];
    const key = adjectives[Math.floor(Math.random() * adjectives.length)]
              + '-'
              + Math.floor(Math.random() * 90 + 10);
    document.getElementById('sender-room-key').value = key;
}

// Reset receiver form for another transfer
function resetReceiverForm() {
    const ph = document.getElementById('recv-placeholder');
    if (ph) {
        ph.innerHTML = `
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="8" y1="12" x2="16" y2="12"/>
                <line x1="12" y1="8" x2="12" y2="16"/>
            </svg>
            <span>awaiting connection</span>
        `;
        ph.style.borderColor = '';
    }
    document.getElementById('receiver-room-key').value = '';
    document.getElementById('receiver-password').value = '';
    setStatus('receiver-status', 'Ready to connect…');

    // Reset progress
    const progContainer = document.getElementById('receiver-progress');
    if (progContainer) progContainer.classList.remove('active');
    const fill = document.getElementById('receiver-progress-fill');
    if (fill) fill.style.width = '0%';
    const pctEl = document.getElementById('receiver-pct');
    if (pctEl) pctEl.textContent = '0%';
    const spdEl = document.getElementById('receiver-speed');
    if (spdEl) spdEl.textContent = '';
    const recvSpd = document.getElementById('recv-speed');
    if (recvSpd) recvSpd.textContent = '';
}

// Auto-populate room key from URL if ?room=xxx is present
function checkUrlForRoom() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
        const receiverInput = document.getElementById('receiver-room-key');
        if (receiverInput) {
            receiverInput.value = room;
            const connectBtn = document.getElementById('btn-connect');
            if (connectBtn) connectBtn.focus();
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const dropZone  = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileNameEl = document.getElementById('file-name');

    // Guard: only bind drop-zone events on send page
    if (!dropZone || !fileInput || !fileNameEl) {
        checkUrlForRoom();
        return;
    }

    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) {
            const f = fileInput.files[0];
            fileNameEl.textContent = '📎 ' + f.name + ' (' + formatBytes(f.size) + ')';
            fileNameEl.style.display = 'block';
        }
    });

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (!file) return;

        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;

        fileNameEl.textContent = '📎 ' + file.name + ' (' + formatBytes(file.size) + ')';
        fileNameEl.style.display = 'block';
    });

    // Check for room key in URL
    checkUrlForRoom();
});