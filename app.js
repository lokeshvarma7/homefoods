// Wait for DOM to load
document.addEventListener("DOMContentLoaded", () => {
    // --- 1. Configuration & Undersampling Strategy ---
    const TOTAL_FRAMES = 192;
    const STEP = 2; // Load every 2nd frame for smoother FPS
    
    // The 4 sequence directories and their file naming conventions
    const sequences = [
        { dir: './flax_chapathi/', prefix: 'ezgif-frame-', padding: 3 },
        { dir: './idly/', prefix: '', padding: 5 },
        { dir: './Dosa/', prefix: '', padding: 5 },
        { dir: './oats_smoothie/', prefix: '', padding: 5 }
    ];

    const frames = []; // Will hold all loaded Image objects in order
    let loadedCount = 0;
    
    // Calculate total frames to load based on undersampling
    // 192 / 3 = 64 per sequence. 64 * 4 = 256 total images.
    let expectedFramesCount = 0;
    for (let s = 0; s < sequences.length; s++) {
        for (let i = 1; i <= TOTAL_FRAMES; i += STEP) {
            expectedFramesCount++;
        }
    }

    const percentageEl = document.getElementById('loading-percentage');
    const preloaderEl = document.getElementById('preloader');
    
    // --- 2. Canvas Setup ---
    const canvas = document.getElementById("hero-canvas");
    const context = canvas.getContext("2d");

    // Set canvas resolution (assuming 1920x1080 frames, adjust to match actual aspect ratio)
    canvas.width = 1920;
    canvas.height = 1080;

    // --- 3. Asset Preloader ---
    function pad(num, size) {
        let s = num + "";
        while (s.length < size) s = "0" + s;
        return s;
    }

    function loadImages() {
        // Create an array of promises for sequential loading or parallel loading
        // To maintain order, we'll create the Image objects and assign them to specific indices
        let globalIndex = 0;
        
        sequences.forEach((seq) => {
            for (let i = 1; i <= TOTAL_FRAMES; i += STEP) {
                const img = new Image();
                const filename = seq.prefix + pad(i, seq.padding) + '.png';
                const src = seq.dir + filename;
                
                // Keep track of the target index to preserve order
                const currentIndex = globalIndex;
                globalIndex++;

                img.onload = () => {
                    frames[currentIndex] = img;
                    loadedCount++;
                    updateProgress();
                };

                img.onerror = () => {
                    console.error("Failed to load: " + src);
                    // Still increment to not block the loader
                    loadedCount++; 
                    updateProgress();
                };

                img.src = src;
            }
        });
    }

    function updateProgress() {
        const percent = Math.floor((loadedCount / expectedFramesCount) * 100);
        percentageEl.innerText = percent + "%";

        if (loadedCount === expectedFramesCount) {
            initAnimation();
        }
    }

    let lastRenderedFrame = -1;

    function renderFrame(index) {
        if (index === lastRenderedFrame) return; // Prevent redundant draw calls
        lastRenderedFrame = index;

        if (frames[index]) {
            // Clear and draw image
            context.clearRect(0, 0, canvas.width, canvas.height);
            // Draw covering the canvas with a cinematic crop (zoom) to hide watermarks
            const img = frames[index];
            const canvasRatio = canvas.width / canvas.height;
            const imgRatio = img.width / img.height;
            let drawWidth = canvas.width;
            let drawHeight = canvas.height;

            if (imgRatio > canvasRatio) {
                drawWidth = canvas.height * imgRatio;
            } else {
                drawHeight = canvas.width / imgRatio;
            }

            // Cinematic Zoom Scale to crop out bottom 'veo' watermark (e.g. 15% zoom)
            const zoomScale = 1.15;
            drawWidth *= zoomScale;
            drawHeight *= zoomScale;

            // Center the cropped image
            const offsetX = (canvas.width - drawWidth) / 2;
            const offsetY = (canvas.height - drawHeight) / 2;

            context.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
        }
    }

    // --- 4. GSAP & ScrollTrigger Setup ---
    function initAnimation() {
        // Fade out preloader
        preloaderEl.style.opacity = "0";
        setTimeout(() => {
            preloaderEl.style.visibility = "hidden";
        }, 800);

        // Render first frame immediately
        renderFrame(0);

        // Register ScrollTrigger
        gsap.registerPlugin(ScrollTrigger);

        // We use a proxy object to hold the current frame index
        const playhead = { frame: 0 };
        const maxFrame = expectedFramesCount - 1;

        // Master Timeline
        const tl = gsap.timeline({
            scrollTrigger: {
                trigger: ".scroll-content",
                start: "top top",
                end: "bottom bottom",
                scrub: true, // Fluid, immediate scrubbing to prevent perceived lag
            }
        });

        // Fade out intro hero quickly when scroll starts
        tl.to(".hero-section", { opacity: 0, duration: 0.05 }, 0);

        // Animate the playhead from 0 to maxFrame
        tl.to(playhead, {
            frame: maxFrame,
            snap: "frame", // Ensure frame is an integer
            ease: "none",
            duration: 1, // Explicit duration for relative panel timing
            onUpdate: () => {
                // Use requestAnimationFrame for smooth rendering
                requestAnimationFrame(() => renderFrame(playhead.frame));
            }
        }, 0); // Start at timeline 0

        // Panel Animations
        const panels = gsap.utils.toArray(".panel:not(.finale-panel)");
        const panelDuration = maxFrame / panels.length;

        panels.forEach((panel, i) => {
            // Calculate start and end times for this panel based on playhead frames
            const startTime = i * panelDuration;
            const endTime = (i + 1) * panelDuration;
            
            // Add active class for CSS transforms
            tl.call(() => panel.classList.add("active"), null, startTime / maxFrame * tl.duration());
            tl.call(() => panel.classList.remove("active"), null, endTime / maxFrame * tl.duration());

            // Fade in
            tl.to(panel, { opacity: 1, duration: 0.1 }, startTime / maxFrame * tl.duration());
            // Fade out (except for the last normal panel if we want it to stay a bit, but we want it to fade out for finale)
            tl.to(panel, { opacity: 0, duration: 0.1 }, (endTime - (panelDuration * 0.1)) / maxFrame * tl.duration());
        });

        // Finale Panel (Panel 5)
        const finalePanel = document.querySelector(".finale-panel");
        const finaleStartTime = (maxFrame - (panelDuration * 0.2)) / maxFrame * tl.duration(); // Fade in at the very end

        tl.to(finalePanel, { opacity: 1, duration: 0.2 }, finaleStartTime);
        tl.call(() => finalePanel.classList.add("active"), null, finaleStartTime);
    }

    // Handle Window Resize for Canvas
    window.addEventListener('resize', () => {
        // Re-render current frame on resize to fix stretching issues if we were using window dimensions
        // Currently fixed to 1920x1080 logically, but scaling via CSS.
        // So we don't strictly need to do anything here, CSS object-fit: contain handles it.
    });

    // Start loading
    loadImages();
});
