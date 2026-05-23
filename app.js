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
            
            const isPortrait = canvas.width < canvas.height;
            const canvasRatio = canvas.width / canvas.height;
            const imgRatio = img.width / img.height;

            if (isPortrait) {
                // --- Mobile Portrait: Ambient Glow & Sharp Centered Showcase ---
                // 1. Draw the blurred, darkened ambient background to cover 100% of the tall viewport
                context.save();
                if (context.filter !== undefined) {
                    context.filter = "blur(40px) brightness(0.35) saturate(140%)";
                }
                
                let bgWidth = canvas.height * imgRatio;
                let bgHeight = canvas.height;
                let bgOffsetX = Math.round((canvas.width - bgWidth) / 2);
                let bgOffsetY = 0;
                
                context.drawImage(img, bgOffsetX, bgOffsetY, Math.round(bgWidth), Math.round(bgHeight));
                context.restore();

                // 2. Draw the sharp, beautifully balanced foreground centered in the viewport
                // Scaled to 1.4x of the width for an immersive close-up that fits mobile perfectly
                let fgWidth = canvas.width * 1.4;
                let fgHeight = fgWidth / imgRatio;
                
                let fgOffsetX = Math.round((canvas.width - fgWidth) / 2);
                // Offset upward by 5% of screen height to leave gorgeous, clean breathing room for bottom text cards!
                let fgOffsetY = Math.round((canvas.height - fgHeight) / 2) - Math.round(canvas.height * 0.05);
                
                context.drawImage(img, fgOffsetX, fgOffsetY, Math.round(fgWidth), Math.round(fgHeight));
            } else {
                // --- Desktop Landscape: Clean Fullscreen Cinematic Crop ---
                let drawWidth = canvas.width;
                let drawHeight = canvas.height;

                if (imgRatio > canvasRatio) {
                    drawWidth = canvas.height * imgRatio;
                } else {
                    drawHeight = canvas.width / imgRatio;
                }

                const zoomScale = 1.15; // 15% cinematic crop to cover edges/watermarks
                drawWidth *= zoomScale;
                drawHeight *= zoomScale;

                const offsetX = Math.round((canvas.width - drawWidth) / 2);
                const offsetY = Math.round((canvas.height - drawHeight) / 2);
                const finalWidth = Math.round(drawWidth);
                const finalHeight = Math.round(drawHeight);

                context.drawImage(img, offsetX, offsetY, finalWidth, finalHeight);
            }
        }
    }

    // --- 4. Slideshow Controller Setup & Cinematic Showcase Engine ---
    let currentSlide = 0;
    let isTransitioning = false;
    let autoplayTimer = null;
    let showcaseTween = null;
    const playhead = { frame: 0 };

    // Define slide states, elements, and their fast-transition target frames (the start of beauty showcase)
    const slides = [
        { id: 'hero-section', frame: 0, el: document.querySelector('.hero-section'), seqIdx: -1 },
        { id: 'panel-1', frame: 30, el: document.getElementById('panel-1'), seqIdx: 0 },
        { id: 'panel-2', frame: seqLen + 30, el: document.getElementById('panel-2'), seqIdx: 1 },
        { id: 'panel-3', frame: (seqLen * 2) + 30, el: document.getElementById('panel-3'), seqIdx: 2 },
        { id: 'panel-4', frame: (seqLen * 3) + 30, el: document.getElementById('panel-4'), seqIdx: 3 },
        { id: 'panel-5', frame: (seqLen * 3) + 30, el: document.getElementById('panel-5'), seqIdx: 3 }
    ];

    const dots = document.querySelectorAll('.nav-dot');

    // Controls the slow, beautiful, cinematic close-up beauty shot when active on a slide card
    function playSlideShowcase(index, manual) {
        if (showcaseTween) {
            showcaseTween.kill();
            showcaseTween = null;
        }
        stopAutoplay(); // Clear fallback autoplay timers

        const slide = slides[index];
        if (slide.seqIdx === -1) {
            // Hero Landing Section: hold for 3.0 seconds, then transition to Slide 1
            autoplayTimer = setTimeout(() => {
                goToSlide(1);
            }, 3000);
            return;
        }

        const startFrame = slide.seqIdx * seqLen + 30;
        const endFrame = (slide.seqIdx + 1) * seqLen - 1;

        // Ensure we are locked exactly at the beauty shot start frame
        playhead.frame = startFrame;

        // Slow, premium, linear cinematic beauty pan (takes 4.5 seconds for commercial-grade speed)
        showcaseTween = gsap.to(playhead, {
            frame: endFrame,
            duration: 4.5,
            ease: "none", // Linear ease for solid fluid video-like playback
            onUpdate: () => {
                renderFrame(Math.round(playhead.frame));
            },
            onComplete: () => {
                // "transition smoothly to the other items quickly after animation"
                // Once the cinematic beauty shot completes, transition immediately to the next slide!
                let nextIndex = (index + 1) % slides.length;
                goToSlide(nextIndex);
            }
        });
    }

    function goToSlide(index, manual = false) {
        if (index === currentSlide && isTransitioning) return; // Prevent transition collisions
        if (index === currentSlide && manual) return;
        
        isTransitioning = true;
        stopAutoplay();
        if (showcaseTween) {
            showcaseTween.kill();
            showcaseTween = null;
        }

        const currentSlideObj = slides[currentSlide];
        const nextSlideObj = slides[index];

        // Transitions (sweeps) are extremely fast and dynamic (0.5s autoplay, 0.4s manual clicks/swipes)
        const tweenDuration = manual ? 0.4 : 0.5;

        // Create unified GSAP timeline for gorgeous synchronized, overlapping card transitions
        gsap.killTweensOf(playhead);
        
        const tl = gsap.timeline({
            onComplete: () => {
                // Force render target frame to ensure perfect final focus
                renderFrame(nextSlideObj.frame, true);

                currentSlide = index;
                isTransitioning = false;

                // Start the slow cinematic beauty showcase shot on the new slide!
                playSlideShowcase(index, manual);
            }
        });

        // 1. Instantly fade out the current active card elements
        if (currentSlideObj.id === 'hero-section') {
            tl.to(currentSlideObj.el, { 
                opacity: 0, 
                duration: 0.15, 
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
                    y: -15, 
                    duration: 0.15, 
                    ease: "power2.in" 
                });
            }
            tl.to(currentSlideObj.el, { 
                opacity: 0, 
                duration: 0.15,
                onComplete: () => {
                    currentSlideObj.el.classList.remove('active');
                }
            }, "<");
        }

        // 2. Play background camera frame sweep with extremely fast, energetic ease
        tl.to(playhead, {
            frame: nextSlideObj.frame,
            duration: tweenDuration,
            ease: "power1.inOut", // Smooth transition curve
            onUpdate: () => {
                renderFrame(Math.round(playhead.frame));
            }
        }, "-=0.1"); // Overlap slightly with fade-out for visual tightness

        // 3. Anticipatory Early Fade-in of the new active card (starts halfway through the sweep!)
        const fadeStartOffset = `-=${tweenDuration * 0.5}`;
        
        if (nextSlideObj.id === 'hero-section') {
            tl.to(nextSlideObj.el, { 
                opacity: 1, 
                duration: 0.3, 
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
                gsap.set(nextCard, { opacity: 0, y: 15 });
                gsap.set(nextSlideObj.el, { opacity: 1 });
                
                tl.to(nextCard, { 
                    opacity: 1, 
                    y: 0, 
                    duration: 0.3, 
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

    // Fallback autoplay loop (loops back to Slide 0!)
    function startAutoplay() {
        stopAutoplay();
        // Since playSlideShowcase handles transitions upon completion, this serves as a robust fallback
        autoplayTimer = setTimeout(() => {
            let nextIndex = (currentSlide + 1) % slides.length;
            goToSlide(nextIndex);
        }, 6000);
    }

    // Clear active autoplay fallback timers
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
                    gsap.set(card, { opacity: 0, y: 15 });
                }
            }
        });

        // Set up interactive dot click handlers
        dots.forEach((dot, index) => {
            dot.addEventListener('click', () => {
                goToSlide(index, true);
            });
        });

        // Start showcase for Hero Landing section
        playSlideShowcase(0, false);
    }

    // --- 5. Interactive Scroll & Touch Swipe Gestures ---
    let lastScrollTime = 0;
    const SCROLL_COOLDOWN = 800; // ms to debounce transitions for premium, non-jittery sweeps

    function handleScroll(delta) {
        if (isTransitioning) return;

        const now = performance.now();
        if (now - lastScrollTime < SCROLL_COOLDOWN) return;
        lastScrollTime = now;

        if (delta > 0) {
            // Scroll down or right -> transition to the next slide (loops back infinitely!)
            let nextIndex = (currentSlide + 1) % slides.length;
            goToSlide(nextIndex, true); 
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
