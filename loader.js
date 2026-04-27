/* =============================================
   FLUIDSHARE — LOADER SCRIPT
   loader.js
   Runs the animated loading sequence and
   dismisses the loader once PeerJS is ready.
============================================= */

(function () {
    const isRepeatVisit = sessionStorage.getItem('fluidshare_visited');
    sessionStorage.setItem('fluidshare_visited', 'true');
    const delayMultiplier = isRepeatVisit ? 0.25 : 1.0;

    // ---- Spawn falling particles ----
    const container = document.getElementById('particles');
    if (container) {
        for (let i = 0; i < 18; i++) {
            const p      = document.createElement('div');
            p.className  = 'particle';
            const height = Math.random() * 60 + 40;

            p.style.cssText = `
                left:               ${Math.random() * 100}%;
                height:             ${height}px;
                animation-name:     particleFall;
                animation-duration: ${Math.random() * 4 + 3}s;
                animation-delay:    ${Math.random() * 5}s;
                animation-iteration-count: infinite;
                animation-timing-function: linear;
                opacity: 0;
            `;

            // Alternate between accent green and send purple
            if (Math.random() > 0.6) {
                p.style.background = 'linear-gradient(to bottom, transparent, #a78bfa, transparent)';
            }

            container.appendChild(p);
        }
    }

    // ---- Loading step sequence ----
    const steps = [
        { text: 'Initializing engine…',   progress: 20,  dot: 0 },
        { text: 'Connecting to network…', progress: 55,  dot: 1 },
        { text: 'Establishing peer…',     progress: 80,  dot: 2 },
        { text: 'Ready.',                 progress: 100, dot: 2 },
    ];

    const bar    = document.getElementById('loader-bar');
    const msgEl  = document.getElementById('loader-message');
    const dots   = [
        document.getElementById('dot-0'),
        document.getElementById('dot-1'),
        document.getElementById('dot-2'),
    ];

    let currentStep = 0;

    function advanceStep() {
        if (currentStep >= steps.length) return;

        const { text, progress, dot } = steps[currentStep];

        // Fade message out → update → fade in
        if (msgEl) {
            msgEl.style.opacity = '0';
            setTimeout(() => {
                msgEl.textContent   = text;
                msgEl.style.opacity = '1';
            }, 200);
        }

        // Move progress bar
        if (bar) bar.style.width = progress + '%';

        // Update step dots
        dots.forEach((d, i) => {
            if (!d) return;
            d.classList.remove('active', 'done');
            if (i < dot)  d.classList.add('done');
            if (i === dot) d.classList.add('active');
        });

        currentStep++;
    }

    // Kick off immediately, then at timed intervals
    advanceStep();
    setTimeout(advanceStep, 900 * delayMultiplier);
    setTimeout(advanceStep, 1800 * delayMultiplier);
    setTimeout(advanceStep, 2800 * delayMultiplier);

    // ---- Dismiss the loader ----
    const loader = document.getElementById('loader');
    const app    = document.getElementById('app');

    function dismissLoader() {
        if (!loader) return;
        loader.classList.add('hidden');
        if (app) app.classList.add('visible');
    }

    // script.js calls window.__onPeerReady() when PeerJS opens.
    // If it fires before the minimum display time, we wait anyway.
    let peerReady    = false;
    let minTimePassed = false;

    function tryDismiss() {
        if (peerReady && minTimePassed) dismissLoader();
    }

    window.__onPeerReady = () => {
        peerReady = true;
        tryDismiss();
    };

    // Minimum display time: 2.5 seconds (feels intentional, not like a flash)
    setTimeout(() => {
        minTimePassed = true;
        tryDismiss();
    }, 2500);

    // Hard fallback: always dismiss after 4 seconds no matter what
    setTimeout(dismissLoader, 4000);

})();