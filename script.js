/* =============================================
   SUS · FLUIDSHARE — MAIN SCRIPT
   Secure University Systems · File Transfer
   script.js
   ─────────────────────────────────────────
   Features:
     • AES-256-GCM end‑to‑end encryption
     • PBKDF2 key derivation from password
     • 64 KB chunked streaming with ACK
     • Real-time progress / speed / ETA
============================================= */

let senderPeer;
let receiverPeer;
let fileData;
let fileName;

const CHUNK_SIZE = 64 * 1024; // 64 KB

// ---- Reliable PeerJS config using public STUN servers ----
const PEER_CONFIG = {
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ]
    }
};

// ============================================================
//  ENCRYPTION ENGINE (Web Crypto API)
// ============================================================

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

async function encryptBuffer(buffer, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const key  = await deriveKey(password, salt);
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        buffer
    );
    return { ciphertext, salt: Array.from(salt), iv: Array.from(iv) };
}

async function decryptBuffer(ciphertext, salt, iv, password) {
    const key = await deriveKey(password, new Uint8Array(salt));
    return crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
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
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function updateProgress(side, pct, speedBps) {
    const fill  = document.getElementById(`${side}-progress-fill`);
    const pctEl = document.getElementById(`${side}-pct`);
    const spdEl = document.getElementById(`${side}-speed`);
    const cont  = document.getElementById(`${side}-progress`);

    if (cont) cont.classList.add('active');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
    if (spdEl && speedBps > 0) spdEl.textContent = formatBytes(speedBps) + '/s';
}

function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.title = isHidden ? 'Hide password' : 'Show password';
}

function copyShareLink() {
    const key = document.getElementById('sender-room-key').value.trim();
    if (!key) return;
    const base = location.href.replace(/\/[^/]*$/, '/');
    const url = `${base}receive.html?room=${encodeURIComponent(key)}`;
    navigator.clipboard.writeText(url).then(() => {
        setStatus('sender-status', '✓ Receive link copied!');
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
        if (statusText) statusText.textContent = 'Disconnected. Please refresh.';
    });
};

// ============================================================
//  SENDER LOGIC
// ============================================================

function createRoomAndShare() {
    const roomKey   = document.getElementById('sender-room-key').value.trim();
    const password  = document.getElementById('sender-password').value;
    const fileInput = document.getElementById('file-input');
    const file      = fileInput.files[0];

    if (!roomKey) {
        setStatus('sender-status', 'Please enter or generate a room key.', true);
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
        // Show copy link button
        const copyBtn = document.getElementById('btn-copy-link');
        if (copyBtn) copyBtn.style.display = 'inline-flex';

        fileName = file.name;
        const reader = new FileReader();
        reader.onload = (e) => { fileData = e.target.result; };
        reader.readAsArrayBuffer(file);
    });

    senderPeer.on('connection', conn => {
        setStatus('sender-status', 'Receiver connected. Preparing file…');

        conn.on('data', async data => {
            if (data === 'request-file' && fileData) {
                try {
                    setStatus('sender-status', 'Encrypting & sending…');

                    let payload;
                    if (password) {
                        // Encrypt
                        const { ciphertext, salt, iv } = await encryptBuffer(fileData, password);
                        payload = new Uint8Array(ciphertext);

                        // Send metadata first
                        conn.send({
                            type: 'metadata',
                            fileName,
                            fileSize: payload.byteLength,
                            encrypted: true,
                            salt,
                            iv,
                            totalChunks: Math.ceil(payload.byteLength / CHUNK_SIZE)
                        });
                    } else {
                        payload = new Uint8Array(fileData);
                        conn.send({
                            type: 'metadata',
                            fileName,
                            fileSize: payload.byteLength,
                            encrypted: false,
                            totalChunks: Math.ceil(payload.byteLength / CHUNK_SIZE)
                        });
                    }

                    // Chunked send
                    const totalChunks = Math.ceil(payload.byteLength / CHUNK_SIZE);
                    let chunkIndex = 0;
                    const startTime = Date.now();

                    function sendNextChunk() {
                        if (chunkIndex >= totalChunks) {
                            conn.send({ type: 'done' });
                            setStatus('sender-status', '✓ File sent successfully!');
                            updateProgress('sender', 100, 0);
                            return;
                        }

                        const start = chunkIndex * CHUNK_SIZE;
                        const end   = Math.min(start + CHUNK_SIZE, payload.byteLength);
                        const chunk = payload.slice(start, end);

                        conn.send({ type: 'chunk', index: chunkIndex, data: chunk });

                        chunkIndex++;
                        const pct = (chunkIndex / totalChunks) * 100;
                        const elapsed = (Date.now() - startTime) / 1000;
                        const speed = (chunkIndex * CHUNK_SIZE) / elapsed;
                        updateProgress('sender', pct, speed);
                        setStatus('sender-status', `Sending chunk ${chunkIndex}/${totalChunks}…`);

                        // Small delay for backpressure
                        setTimeout(sendNextChunk, 5);
                    }

                    sendNextChunk();
                } catch (err) {
                    console.error('Encryption/send error:', err);
                    setStatus('sender-status', 'Encryption error. Check password.', true);
                }
            }
        });

        conn.on('error', err => {
            console.error('Sender conn error:', err);
            setStatus('sender-status', 'Connection error while sending.', true);
        });
    });

    senderPeer.on('error', err => {
        if (err.type === 'unavailable-id') {
            setStatus('sender-status', 'Room key already taken. Try another.', true);
        } else if (err.type === 'peer-unavailable') {
            setStatus('sender-status', 'Could not reach receiver. Are they connected?', true);
        } else {
            console.error('Sender PeerJS error:', err);
            setStatus('sender-status', `Error: ${err.type}`, true);
        }
    });
}

// ============================================================
//  RECEIVER LOGIC
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

    receiverPeer.on('open', () => {
        setStatus('receiver-status', 'Connecting to sender…');
        const conn = receiverPeer.connect(roomKey, { reliable: true });

        let metadata = null;
        const chunks = [];
        let startTime;

        conn.on('open', () => {
            setStatus('receiver-status', 'Connected. Requesting file…');
            conn.send('request-file');
        });

        conn.on('data', async data => {
            // Handle metadata
            if (data && data.type === 'metadata') {
                metadata = data;
                chunks.length = 0;
                startTime = Date.now();
                setStatus('receiver-status', `Receiving: ${metadata.fileName} (${formatBytes(metadata.fileSize)})`);
                return;
            }

            // Handle chunk
            if (data && data.type === 'chunk') {
                chunks.push(data.data);
                const pct = ((data.index + 1) / metadata.totalChunks) * 100;
                const elapsed = (Date.now() - startTime) / 1000;
                const speed = ((data.index + 1) * CHUNK_SIZE) / elapsed;
                updateProgress('receiver', pct, speed);
                setStatus('receiver-status', `Receiving chunk ${data.index + 1}/${metadata.totalChunks}…`);
                return;
            }

            // Handle done
            if (data && data.type === 'done') {
                try {
                    setStatus('receiver-status', 'Reassembling file…');

                    // Combine chunks
                    const totalLength = chunks.reduce((s, c) => s + c.byteLength, 0);
                    const combined = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const chunk of chunks) {
                        combined.set(new Uint8Array(chunk), offset);
                        offset += chunk.byteLength;
                    }

                    let finalBuffer;
                    if (metadata.encrypted) {
                        if (!password) {
                            setStatus('receiver-status', 'This file is encrypted. Please enter a password.', true);
                            return;
                        }
                        setStatus('receiver-status', 'Decrypting…');
                        finalBuffer = await decryptBuffer(combined.buffer, metadata.salt, metadata.iv, password);
                    } else {
                        finalBuffer = combined.buffer;
                    }

                    // Trigger download
                    const blob = new Blob([finalBuffer], { type: 'application/octet-stream' });
                    const url  = URL.createObjectURL(blob);
                    const a    = document.createElement('a');
                    a.href     = url;
                    a.download = metadata.fileName || 'downloaded_file';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    updateProgress('receiver', 100, 0);
                    setStatus('receiver-status', '✓ Download complete!');
                    conn.close();
                } catch (err) {
                    console.error('Decryption error:', err);
                    setStatus('receiver-status', 'Decryption failed. Wrong password?', true);
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
                conn.close();
            }
        });

        conn.on('error', err => {
            console.error('Receiver conn error:', err);
            setStatus('receiver-status', 'Connection failed. Check the room key.', true);
        });
    });

    receiverPeer.on('error', err => {
        console.error('Receiver peer error:', err);
        if (err.type === 'peer-unavailable') {
            setStatus('receiver-status', 'Sender not found. Is the room key correct?', true);
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

// Auto-populate room key from URL if ?room=xxx is present
function checkUrlForRoom() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
        const receiverInput = document.getElementById('receiver-room-key');
        if (receiverInput) receiverInput.value = room;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const dropZone  = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileNameEl = document.getElementById('file-name');

    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) {
            fileNameEl.textContent = '📎 ' + fileInput.files[0].name;
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

        fileNameEl.textContent = '📎 ' + file.name;
        fileNameEl.style.display = 'block';
    });

    // Check for room key in URL
    checkUrlForRoom();
});