/* =============================================
   FLUIDSHARE — MAIN SCRIPT (FIXED)
   script.js
============================================= */

let senderPeer;
let receiverPeer;
let fileData;
let fileName;

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

// ---- Utility: set status message ----
const setStatus = (elementId, message, isError = false) => {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = message;
        el.style.color = isError ? '#ef4444' : '#9ca3af';
    }
};

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
    const roomKey = document.getElementById('sender-room-key').value.trim();
    const fileInput = document.getElementById('file-input');
    const file = fileInput.files[0];

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

    // ✅ FIX: Pass PEER_CONFIG for reliable STUN
    senderPeer = new Peer(roomKey, PEER_CONFIG);
    attachConnectionListeners(senderPeer);

    senderPeer.on('open', id => {
        setStatus('sender-status', 'Room created. Waiting for receiver…');
        fileName = file.name;

        const reader = new FileReader();
        reader.onload = (e) => { fileData = e.target.result; };
        reader.readAsArrayBuffer(file);
    });

    senderPeer.on('connection', conn => {
        setStatus('sender-status', 'Receiver connected. Sending file…');

        conn.on('open', () => {
            // Wait for data event before sending
        });

        conn.on('data', data => {
            if (data === 'request-file' && fileData) {
                conn.send({ fileData, fileName });
                setStatus('sender-status', '✓ File sent successfully!');
                setTimeout(() => conn.close(), 1000);
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
    const roomKey = document.getElementById('receiver-room-key').value.trim();

    if (!roomKey) {
        setStatus('receiver-status', 'Please enter the sender\'s room key.', true);
        return;
    }

    // ✅ FIX: Always create a fresh receiver peer to avoid stale state
    if (receiverPeer && !receiverPeer.destroyed) receiverPeer.destroy();

    receiverPeer = new Peer(PEER_CONFIG);  // random ID for receiver
    attachConnectionListeners(receiverPeer);

    // ✅ FIX: Wait for peer to open before connecting
    receiverPeer.on('open', () => {
        setStatus('receiver-status', 'Connecting to sender…');
        const conn = receiverPeer.connect(roomKey, { reliable: true });

        conn.on('open', () => {
            setStatus('receiver-status', 'Connected. Requesting file…');
            conn.send('request-file');
        });

        conn.on('data', data => {
            setStatus('receiver-status', 'File received. Starting download…');

            const blob = new Blob([data.fileData], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = data.fileName || 'downloaded_file';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setStatus('receiver-status', '✓ Download complete!');
            conn.close();
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

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
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

    // ✅ FIX: Don't auto-init a peer on load — only create when actually needed
    // (avoids wasting a connection slot on every page load)
});