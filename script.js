/* =============================================
   FLUIDSHARE — MAIN SCRIPT
   script.js
============================================= */

let peer;
let fileData;
let fileName;

// ---- Utility: set status message in a status bar ----
const setStatus = (elementId, message, isError = false) => {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = message;
        el.style.color = isError ? '#ef4444' : '#9ca3af';
    }
};

// ---- Attach global connection status listeners to a peer object ----
const attachConnectionListeners = (peerObject) => {
    const statusContainer = document.getElementById('connection-status');
    const statusText      = document.getElementById('connection-status-text');

    peerObject.on('open', id => {
        statusContainer.classList.add('connected');
        statusText.textContent = 'Connected to signaling server';

        // Tell the loader it can dismiss
        if (window.__onPeerReady) window.__onPeerReady();
    });

    peerObject.on('error', err => {
        statusContainer.classList.remove('connected');
        statusText.textContent = `Connection error: ${err.type}. Please refresh.`;
        console.error('PeerJS error:', err);
    });

    peerObject.on('disconnected', () => {
        statusContainer.classList.remove('connected');
        statusText.textContent = 'Disconnected. Please refresh.';
    });
};

// ============================================================
//  SENDER LOGIC
// ============================================================

function createRoomAndShare() {
    const roomKey   = document.getElementById('sender-room-key').value.trim();
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

    // Destroy old peer before creating a new one
    if (peer) peer.destroy();

    peer = new Peer(roomKey);
    attachConnectionListeners(peer);

    peer.on('open', id => {
        setStatus('sender-status', 'Room created. Waiting for receiver…');
        fileName = file.name;

        const reader    = new FileReader();
        reader.onload   = (e) => { fileData = e.target.result; };
        reader.readAsArrayBuffer(file);
    });

    peer.on('connection', conn => {
        setStatus('sender-status', 'Receiver connected. Sending file…');

        conn.on('data', data => {
            if (data === 'request-file' && fileData) {
                conn.send({ fileData, fileName });
                setStatus('sender-status', '✓ File sent successfully!');
                setTimeout(() => conn.close(), 500);
            }
        });

        conn.on('error', err => {
            console.error('Sender conn error:', err);
            setStatus('sender-status', 'Connection error while sending.', true);
        });
    });

    peer.on('error', err => {
        if (err.type === 'unavailable-id') {
            setStatus('sender-status', 'Room key already taken. Try another.', true);
        } else {
            console.error('Sender PeerJS error:', err);
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

    // Initialize receiver peer if needed
    if (!peer || peer.destroyed) {
        peer = new Peer();
        attachConnectionListeners(peer);
    }

    setStatus('receiver-status', 'Connecting to sender…');
    const conn = peer.connect(roomKey);

    conn.on('open', () => {
        setStatus('receiver-status', 'Connected. Requesting file…');
        conn.send('request-file');
    });

    conn.on('data', data => {
        setStatus('receiver-status', 'File received. Starting download…');

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
    });

    conn.on('error', err => {
        console.error('Receiver conn error:', err);
        setStatus('receiver-status', 'Connection failed. Check the room key.', true);
    });
}

// ============================================================
//  UI HELPERS
// ============================================================

// Auto room-key generator
function generateKey() {
    const adjectives = ['arctic','cobalt','velvet','neon','amber','silent','drift','jade','onyx','solar','crystal','ember','nova','storm','lunar'];
    const nouns      = ['wave','crane','shift','gate','spark','ridge','pulse','bloom','tide','zone','flare','peak','core','flux','beam'];
    const key = adjectives[Math.floor(Math.random() * adjectives.length)]
              + '-'
              + Math.floor(Math.random() * 90 + 10);
    document.getElementById('sender-room-key').value = key;
}

// Drop zone drag-and-drop
document.addEventListener('DOMContentLoaded', () => {
    const dropZone  = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileNameEl = document.getElementById('file-name');

    // File selected via click
    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) {
            fileNameEl.textContent     = '📎 ' + fileInput.files[0].name;
            fileNameEl.style.display   = 'block';
        }
    });

    // Drag over
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    // Drag leave
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    // Drop
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (!file) return;

        const dt = new DataTransfer();
        dt.items.add(file);
        fileInput.files = dt.files;

        fileNameEl.textContent   = '📎 ' + file.name;
        fileNameEl.style.display = 'block';
    });

    // Init peer on load (receiver path)
    if (!peer) {
        peer = new Peer();
        attachConnectionListeners(peer);
    }
});