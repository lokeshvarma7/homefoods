// Wait for DOM to load
document.addEventListener("DOMContentLoaded", () => {
    // --- 1. Configuration & Undersampling Strategy ---
    const TOTAL_FRAMES = 192;
    const STEP = 2; // Load every 2nd frame for highly detailed, complete animations (96 frames per sequence)
    
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
    // 192 / 2 = 96 per sequence. 96 * 4 = 384 total images.
    let expectedFramesCount = 0;
    for (let s = 0; s < sequences.length; s++) {
        for (let i = 1; i <= TOTAL_FRAMES; i += STEP) {
            expectedFramesCount++;
        }
    }

    // Calculate sequence length dynamically based on STEP
    const seqLen = Math.floor(expectedFramesCount / sequences.length);

    // Declared early for resolution-independent high-DPI canvas resizing support
    let lastRenderedFrame = -1;



    const percentageEl = document.getElementById('loading-percentage');
    const preloaderEl = document.getElementById('preloader');
    
    // --- 2. Canvas Setup ---
    const canvas = document.getElementById("hero-canvas");
    const context = canvas.getContext("2d");

    // --- 3. Progressive Loading Strategy ---
    let isAnimationInitialized = false;

    // Dynamic High-DPI (Retina) Resolution Auto-Rescaler
    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        
        // Upscale canvas drawing buffer to match physical device pixels
        // This delivers pin-sharp native-resolution rendering instead of blurry upscale interpolation!
        canvas.width = Math.round(window.innerWidth * dpr);
        canvas.height = Math.round(window.innerHeight * dpr);

        // Instantly force redraw the current active frame at the high-DPI resolution
        if (isAnimationInitialized && lastRenderedFrame !== -1) {
            renderFrame(lastRenderedFrame, true);
        }
    }

    // Initialize high-DPI sizing and listen for resize events
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);


    function pad(num, size) {
        let s = num + "";
        while (s.length < size) s = "0" + s;
        return s;
    }

    // Helper to load a single frame with GPU pre-decoding
    function loadSingleFrame(seqIdx, frameVal, onFrameLoaded) {
        const seq = sequences[seqIdx];
        const img = new Image();
        const filename = seq.prefix + pad(frameVal, seq.padding) + '.webp';
        const src = seq.dir + filename;
        
        // Calculate global frame index
        const currentIndex = (seqIdx * seqLen) + Math.floor((frameVal - 1) / STEP);

        img.onload = () => {
            img.decode().then(() => {
                frames[currentIndex] = img;
                onFrameLoaded(true);
            }).catch((err) => {
                console.warn("Decode failed, falling back: ", err);
                frames[currentIndex] = img;
                onFrameLoaded(true);
            });
        };

        img.onerror = () => {
            console.error("Failed to load: " + src);
            onFrameLoaded(false);
        };

        img.src = src;
    }

    function loadImages() {
        // Critical frames: Sequence 0 (Flax Chapathi) all frames, and first frame of sequences 1, 2, 3
        const criticalTasks = [];
        const backgroundTasks = [];

        sequences.forEach((seq, seqIdx) => {
            for (let i = 1; i <= TOTAL_FRAMES; i += STEP) {
                const isCritical = (seqIdx === 0) || (seqIdx > 0 && i === 1);
                const task = { seqIdx, frameVal: i };
                if (isCritical) {
                    criticalTasks.push(task);
                } else {
                    backgroundTasks.push(task);
                }
            }
        });

        const totalCritical = criticalTasks.length;
        let loadedCritical = 0;

        // Load critical frames concurrently so the site starts immediately
        criticalTasks.forEach(task => {
            loadSingleFrame(task.seqIdx, task.frameVal, (success) => {
                loadedCritical++;
                
                // Show loading progress of the initial landing assets
                const percent = Math.min(100, Math.floor((loadedCritical / totalCritical) * 100));
                percentageEl.innerText = percent + "%";

                if (loadedCritical === totalCritical && !isAnimationInitialized) {
                    isAnimationInitialized = true;
                    initAnimation();
                    
                    // Preload the remaining frames sequence-by-sequence in background
                    loadBackgroundSequentially(backgroundTasks);
                }
            });
        });
    }

    function loadBackgroundSequentially(tasks) {
        if (tasks.length === 0) return;

        // Group tasks by sequence
        const seqGroups = {};
        tasks.forEach(task => {
            if (!seqGroups[task.seqIdx]) {
                seqGroups[task.seqIdx] = [];
            }
            seqGroups[task.seqIdx].push(task);
        });

        const seqIndices = Object.keys(seqGroups).map(Number).sort((a, b) => a - b);

        function loadNextSeq(index) {
            if (index >= seqIndices.length) {
                console.log("Cinematic cache primed: All background sequences loaded smoothly!");
                return;
            }

            const seqIdx = seqIndices[index];
            const groupTasks = seqGroups[seqIdx];
            let groupLoaded = 0;

            groupTasks.forEach(task => {
                loadSingleFrame(task.seqIdx, task.frameVal, () => {
                    groupLoaded++;
                    loadedCount++;
                    if (groupLoaded === groupTasks.length) {
                        // Current sequence loaded, proceed to the next sequence
                        loadNextSeq(index + 1);
                    }
                });
            });
        }

        loadNextSeq(0);
    }

    // Sequence-bounded fallback to find the closest loaded frame
    function getClosestLoadedFrameIndex(targetIndex) {
        if (frames[targetIndex]) return targetIndex;

        const seqLen = Math.floor(expectedFramesCount / sequences.length);
        const seqIndex = Math.floor(targetIndex / seqLen);
        const minIdx = seqIndex * seqLen;
        const maxIdx = minIdx + seqLen - 1;

        let offset = 1;
        while (offset < seqLen) {
            const left = targetIndex - offset;
            const right = targetIndex + offset;

            if (left < minIdx && right > maxIdx) break;

            if (right <= maxIdx && frames[right]) return right;
            if (left >= minIdx && frames[left]) return left;

            offset++;
        }

        // If no frames in this sequence are loaded, check globally
        for (let i = 0; i < expectedFramesCount; i++) {
            if (frames[i]) return i;
        }
        return -1;
    }

    let lastRenderTime = 0;
    const RENDER_INTERVAL = 16; // Caps drawing to exactly 60 FPS to match screen refresh perfectly


    function renderFrame(index, force = false) {
        const now = performance.now();
        if (!force && now - lastRenderTime < RENDER_INTERVAL) {
            return; // Skip drawing this frame to keep the CPU cool
        }
        lastRenderTime = now;

        const resolvedIndex = getClosestLoadedFrameIndex(index);
        if (resolvedIndex === -1) return;
        if (resolvedIndex === lastRenderedFrame) return; // Prevent redundant draw calls
        lastRenderedFrame = resolvedIndex;

        const img = frames[resolvedIndex];
        if (img) {
            context.clearRect(0, 0, canvas.width, canvas.height);
            
            const canvasRatio = canvas.width / canvas.height;
            const imgRatio = img.width / img.height;
            let drawWidth = canvas.width;
            let drawHeight = canvas.height;

            if (imgRatio > canvasRatio) {
                drawWidth = canvas.height * imgRatio;
            } else {
                drawHeight = canvas.width / imgRatio;
            }

            // Cinematic Zoom Scale to crop out bottom watermarks (e.g. 15% zoom)
            const zoomScale = 1.15;
            drawWidth *= zoomScale;
            drawHeight *= zoomScale;

            // Center the cropped image with exact integer alignment to prevent sub-pixel shimmering
            const offsetX = Math.round((canvas.width - drawWidth) / 2);
            const offsetY = Math.round((canvas.height - drawHeight) / 2);
            const finalWidth = Math.round(drawWidth);
            const finalHeight = Math.round(drawHeight);

            context.drawImage(img, offsetX, offsetY, finalWidth, finalHeight);
        }
    }

    // --- 4. Slideshow Controller Setup ---
    let currentSlide = 0;
    let isTransitioning = false;
    let autoplayTimer = null;
    const AUTOPLAY_DELAY = 2.0; // Snappy 2.0 seconds reading pause for fast-paced commercial flow!
    const playhead = { frame: 0 };

    // Define slide states and dynamic target frames
    const slides = [
        { id: 'hero-section', frame: 0, el: document.querySelector('.hero-section') },
        { id: 'panel-1', frame: seqLen - 1, el: document.getElementById('panel-1') },
        { id: 'panel-2', frame: (seqLen * 2) - 1, el: document.getElementById('panel-2') },
        { id: 'panel-3', frame: (seqLen * 3) - 1, el: document.getElementById('panel-3') },
        { id: 'panel-4', frame: (seqLen * 4) - 1, el: document.getElementById('panel-4') },
        { id: 'panel-5', frame: (seqLen * 4) - 1, el: document.getElementById('panel-5') }
    ];

    const dots = document.querySelectorAll('.nav-dot');

    function goToSlide(index, manual = false) {
        if (index === currentSlide && isTransitioning) return; // Prevent transition collisions
        if (index === currentSlide && manual) return;
        
        isTransitioning = true;
        stopAutoplay(); // Clear active autoplay timer immediately on transition start

        const currentSlideObj = slides[currentSlide];
        const nextSlideObj = slides[index];

        // Kinetic transition sweep durations: 0.8s for autoplay, 0.6s for fast manual response!
        const tweenDuration = manual ? 0.6 : 0.8;

        // Create unified GSAP timeline for gorgeous synchronized, overlapping card transitions
        gsap.killTweensOf(playhead);
        
        const tl = gsap.timeline({
            onComplete: () => {
                // Force render target frame to ensure perfect final focus
                renderFrame(nextSlideObj.frame, true);

                currentSlide = index;
                isTransitioning = false;

                // Always resume autoplay dynamically! Manual interactions hold for 3.5s, autoplay for 2.0s.
                startAutoplay(manual ? 3.5 : AUTOPLAY_DELAY);
            }
        });


        // 1. Instantly fade out the current active card elements
        if (currentSlideObj.id === 'hero-section') {
            tl.to(currentSlideObj.el, { 
                opacity: 0, 
                duration: 0.2, 
                ease: "power2.inOut",
                onComplete: () => {
                    currentSlideObj.el.style.pointerEvents = 'none';
                    currentSlideObj.el.classList.remove('active');
                }
            });
        } else {
            const currentCard = currentSlideObj.el.querySelector('.card');
            if (currentCard) {
                tl.to(currentCard, { 
                    opacity: 0, 
                    y: -20, 
                    duration: 0.2, 
                    ease: "power2.in" 
                });
            }
            tl.to(currentSlideObj.el, { 
                opacity: 0, 
                duration: 0.2,
                onComplete: () => {
                    currentSlideObj.el.classList.remove('active');
                }
            }, "<");
        }

        // 2. Play background camera frame sweep with dramatic decelerating ease
        tl.to(playhead, {
            frame: nextSlideObj.frame,
            duration: tweenDuration,
            ease: "power2.out", // High-fidelity cinematic ease
            onUpdate: () => {
                renderFrame(Math.round(playhead.frame));
            }
        }, "-=0.1"); // Overlap slightly with fade-out for visual tightness

        // 3. Anticipatory Early Fade-in of the new active card (starts halfway through the sweep!)
        const fadeStartOffset = `-=${tweenDuration * 0.5}`;
        
        if (nextSlideObj.id === 'hero-section') {
            tl.to(nextSlideObj.el, { 
                opacity: 1, 
                duration: 0.4, 
                ease: "power2.out", 
                onStart: () => {
                    nextSlideObj.el.style.pointerEvents = 'auto';
                    nextSlideObj.el.classList.add('active');
                }
            }, fadeStartOffset);
        } else {
            const nextCard = nextSlideObj.el.querySelector('.card');
            if (nextCard) {
                // Prime the starting state of the glass card for a smooth, short slide-up
                gsap.set(nextCard, { opacity: 0, y: 20 });
                gsap.set(nextSlideObj.el, { opacity: 1 });
                
                tl.to(nextCard, { 
                    opacity: 1, 
                    y: 0, 
                    duration: 0.4, 
                    ease: "power2.out",
                    onStart: () => {
                        nextSlideObj.el.classList.add('active');
                    }
                }, fadeStartOffset);
            }
        }

        // 4. Highlight navigation dot early for instant feedback
        dots.forEach((dot, dIdx) => {
            if (dIdx === index) dot.classList.add('active');
            else dot.classList.remove('active');
        });
    }

    // Autoplay loop plays infinitely (resumes automatically after custom delays!)
    function startAutoplay(delay = AUTOPLAY_DELAY) {
        stopAutoplay();
        autoplayTimer = setTimeout(() => {
            let nextIndex = (currentSlide + 1) % slides.length;
            goToSlide(nextIndex);
        }, delay * 1000);
    }

    function stopAutoplay() {
        if (autoplayTimer) {
            clearTimeout(autoplayTimer);
            autoplayTimer = null;
        }
    }

    function initAnimation() {
        // Fade out preloader
        preloaderEl.style.opacity = "0";
        setTimeout(() => {
            preloaderEl.style.visibility = "hidden";
        }, 800);

        // Force render first frame immediately bypassing throttle
        renderFrame(0, true);

        // Initialize slide elements state
        slides.forEach((slide, idx) => {
            if (idx === 0) {
                slide.el.style.opacity = '1';
                slide.el.style.pointerEvents = 'auto';
                slide.el.classList.add('active');
            } else {
                slide.el.classList.remove('active');
                const card = slide.el.querySelector('.card');
                if (card) {
                    gsap.set(card, { opacity: 0, y: 20 });
                }
            }
        });

        // Set up interactive dot click handlers
        dots.forEach((dot, index) => {
            dot.addEventListener('click', () => {
                goToSlide(index, true);
            });
        });

        // Start infinite autoplay loop
        startAutoplay();
    }

    // --- 5. Interactive Scroll & Touch Swipe Gestures ---
    let lastScrollTime = 0;
    const SCROLL_COOLDOWN = 1000; // ms to debounce transitions for premium, non-jittery sweeps

    function handleScroll(delta) {
        if (isTransitioning) return;

        const now = performance.now();
        if (now - lastScrollTime < SCROLL_COOLDOWN) return;
        lastScrollTime = now;

        if (delta > 0) {
            // Scroll down or right -> transition to the next slide (loops back infinitely!)
            let nextIndex = (currentSlide + 1) % slides.length;
            goToSlide(nextIndex, true); // Treated as manual interaction (longer pause, then autoplay resumes!)
        } else if (delta < 0) {
            // Scroll up or left -> transition to the previous slide (loops back infinitely!)
            let prevIndex = (currentSlide - 1 + slides.length) % slides.length;
            goToSlide(prevIndex, true);
        }
    }

    // Custom mouse wheel listener (supports vertical and horizontal trackpad/wheel scrolls!)
    window.addEventListener("wheel", (e) => {
        // Choose the dominant scroll direction
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (Math.abs(delta) > 5) {
            handleScroll(delta);
        }
    }, { passive: true });

    // Custom touch swipe listener for vertical and horizontal mobile swiping
    let touchStartX = 0;
    let touchStartY = 0;

    window.addEventListener("touchstart", (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    window.addEventListener("touchend", (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchStartX - touchEndX;
        const diffY = touchStartY - touchEndY;

        // Choose the dominant swipe direction
        const swipeDiff = Math.abs(diffX) > Math.abs(diffY) ? diffX : diffY;

        // Enforce a minimum 40px swipe threshold to confirm intentional swipe navigation
        if (Math.abs(swipeDiff) > 40) {
            handleScroll(swipeDiff);
        }
    }, { passive: true });


    // Start loading images
    loadImages();
});
