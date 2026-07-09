let offsetX = 0;
let offsetY = 0;
let zoom = 1; // initial zoom level
let animationFrameId = null; // Track animation for cancellation

// Web Worker support
let fractalWorker = null;
let workerSupported = typeof(Worker) !== "undefined";

// Memory optimization: cache arrays to avoid reallocation
let cachedArrays = {
  iterationCounts: null,
  histogram: null,
  lastWidth: 0,
  lastHeight: 0,
  lastMaxIter: 0
};

function getControlsWidth() {
  const controls = document.getElementById("controls");
  return controls ? controls.offsetWidth : 0;
}

const canvas = document.getElementById("fractalCanvas");
const ctx = canvas.getContext("2d");

function getPaletteColor(palette, t) {
  switch (palette) {
    case "fire":
      return [255 * t, 80 * t, 20]; // existing fire

    case "fern":
      // Greens from dark mossy to light lime
      return [34 * t, 139 * t + 50, 34 * t];

    case "retroPlasma":
      // Bright neon plasma style cycling through purples, blues, pinks
      return [
        128 + 127 * Math.sin(6.28 * t),
        128 + 127 * Math.sin(6.28 * t + 2),
        128 + 127 * Math.sin(6.28 * t + 4),
      ];

    case "sunset":
      // Warm sunset hues: deep orange to pink to purple
      return [255 * t, 100 * (1 - t), 180 * (1 - t)];

    case "oceanic":
      // Cool ocean blues and teal gradients
      return [0, 128 + 127 * t, 255 * (1 - t)];

    case "ice":
      return [80 * t, 200 * t, 255 * t];

    case "neon":
      return [255 * (1 - t), 255 * t, 255 * (1 - t)];

    case "pastel":
      return [200 + 55 * t, 180 + 55 * (1 - t), 230];

    case "classic":
    default:
      return [
        128 + 127 * Math.sin(6.28 * t),
        128 + 127 * Math.sin(6.28 * t + 2),
        128 + 127 * Math.sin(6.28 * t + 4),
      ];
  }
}

function renderFractal() {
  const loadingIndicator = document.getElementById("loadingIndicator");

  // Show loading indicator
  if (loadingIndicator) {
    loadingIndicator.classList.add("active");
  }

  // Use Web Worker if supported, otherwise fall back to main thread
  if (workerSupported) {
    renderFractalWorker(() => {
      if (loadingIndicator) {
        loadingIndicator.classList.remove("active");
      }
    });
  } else {
    // Fallback to main thread rendering
    setTimeout(() => {
      try {
        renderFractalCore();
      } finally {
        if (loadingIndicator) {
          loadingIndicator.classList.remove("active");
        }
      }
    }, 10);
  }
}

function renderFractalWorker(callback) {
  const width = canvas.width;
  const height = canvas.height;

  const type = document.getElementById("type").value;
  let cRe = parseFloat(document.getElementById("cReal").value);
  let cIm = parseFloat(document.getElementById("cImag").value);
  let maxIter = parseInt(document.getElementById("iterations").value);
  const coloring = document.getElementById("coloring").value;
  const palette = document.getElementById("palette").value;

  // Input validation
  if (isNaN(cRe) || !isFinite(cRe)) {
    cRe = -0.7;
    document.getElementById("cReal").value = cRe;
  }
  if (isNaN(cIm) || !isFinite(cIm)) {
    cIm = 0.27015;
    document.getElementById("cImag").value = cIm;
  }
  if (isNaN(maxIter) || maxIter < 1) {
    maxIter = 100;
    document.getElementById("iterations").value = maxIter;
  }
  if (maxIter > 10000) {
    maxIter = 10000;
    document.getElementById("iterations").value = maxIter;
  }
  cRe = Math.max(-2, Math.min(2, cRe));
  cIm = Math.max(-2, Math.min(2, cIm));

  // Initialize worker if needed
  if (!fractalWorker) {
    fractalWorker = new Worker('fractal-worker.js');

    fractalWorker.onmessage = function(e) {
      if (e.data.type === 'progress') {
        // Update loading indicator with progress
        const loadingIndicator = document.getElementById("loadingIndicator");
        if (loadingIndicator) {
          const progressText = loadingIndicator.querySelector('div:last-child');
          if (progressText) {
            progressText.textContent = `Rendering... ${Math.floor(e.data.progress)}%`;
          }
        }
      } else if (e.data.type === 'complete') {
        // Create ImageData from the transferred data
        const receivedData = e.data.imageData;
        const messageWidth = e.data.width || canvas.width;
        const messageHeight = e.data.height || canvas.height;
        let imageData;

        // Check if it's already the right size for ImageData
        if (receivedData.length === messageWidth * messageHeight * 4) {
          imageData = new ImageData(new Uint8ClampedArray(receivedData), messageWidth, messageHeight);
        } else {
          console.error('Received imageData with incorrect size:', receivedData.length, 'expected:', messageWidth * messageHeight * 4);
          if (callback) callback();
          return;
        }

        ctx.putImageData(imageData, 0, 0);

        // Reset progress text
        const loadingIndicator = document.getElementById("loadingIndicator");
        if (loadingIndicator) {
          const progressText = loadingIndicator.querySelector('div:last-child');
          if (progressText) {
            progressText.textContent = 'Rendering...';
          }
        }

        if (callback) callback();
      }
    };

    fractalWorker.onerror = function(error) {
      console.error('Worker error:', error);
      workerSupported = false;
      if (callback) callback();
      // Retry with fallback
      renderFractal();
    };
  }

  // Gather fractal-specific parameters
  const newtonPower = parseInt(document.getElementById("newtonPower")?.value) || 3;
  const newtonRelax = parseFloat(document.getElementById("newtonRelax")?.value) || 1.0;
  const sierpinskiPoints = parseInt(document.getElementById("sierpinskiPoints")?.value) || 50000;
  const treeAngle = parseFloat(document.getElementById("treeAngle")?.value) || 25;
  const treeLengthRatio = parseFloat(document.getElementById("treeLengthRatio")?.value) || 0.67;
  const treeDepth = parseInt(document.getElementById("treeDepth")?.value) || 10;
  const treeColor = document.getElementById("treeColor")?.value || 'natural';

  // Send data to worker
  fractalWorker.postMessage({
    width,
    height,
    type,
    cRe,
    cIm,
    maxIter,
    coloring,
    palette,
    offsetX,
    offsetY,
    zoom,
    newtonPower,
    newtonRelax,
    sierpinskiPoints,
    treeAngle,
    treeLengthRatio,
    treeDepth,
    treeColor
  });
}

function renderFractalCore() {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width;
  const height = canvas.height;

  const type = document.getElementById("type").value;
  let cRe = parseFloat(document.getElementById("cReal").value);
  let cIm = parseFloat(document.getElementById("cImag").value);
  let maxIter = parseInt(document.getElementById("iterations").value);
  const coloring = document.getElementById("coloring").value;
  const palette = document.getElementById("palette").value;

  // Input validation
  if (isNaN(cRe) || !isFinite(cRe)) {
    cRe = -0.7;
    document.getElementById("cReal").value = cRe;
  }
  if (isNaN(cIm) || !isFinite(cIm)) {
    cIm = 0.27015;
    document.getElementById("cImag").value = cIm;
  }
  if (isNaN(maxIter) || maxIter < 1) {
    maxIter = 100;
    document.getElementById("iterations").value = maxIter;
  }
  if (maxIter > 10000) {
    maxIter = 10000;
    document.getElementById("iterations").value = maxIter;
  }
  // Clamp Julia constants to reasonable range
  cRe = Math.max(-2, Math.min(2, cRe));
  cIm = Math.max(-2, Math.min(2, cIm));

  const aspectRatio = width / height;
  const scale = 1.5 / zoom;

  const imageData = ctx.createImageData(width, height);

  // Memory optimization: reuse arrays if dimensions haven't changed
  let iterationCounts;
  let histogram;

  const pixelCount = width * height;
  const needNewArrays =
    cachedArrays.lastWidth !== width ||
    cachedArrays.lastHeight !== height ||
    cachedArrays.lastMaxIter !== maxIter;

  if (needNewArrays || !cachedArrays.iterationCounts) {
    iterationCounts = new Float32Array(pixelCount);
    histogram = new Uint32Array(maxIter + 1);

    // Cache for reuse
    cachedArrays.iterationCounts = iterationCounts;
    cachedArrays.histogram = histogram;
    cachedArrays.lastWidth = width;
    cachedArrays.lastHeight = height;
    cachedArrays.lastMaxIter = maxIter;
  } else {
    // Reuse cached arrays
    iterationCounts = cachedArrays.iterationCounts;
    histogram = cachedArrays.histogram;

    // Clear histogram (iterationCounts will be overwritten)
    histogram.fill(0);
  }

  // For orbit trap (example: point trap at origin)
  function orbitTrap(zx, zy) {
    const trapX = 0.0;
    const trapY = 0.0;
    const dist = Math.sqrt((zx - trapX) ** 2 + (zy - trapY) ** 2);
    return dist;
  }

  // For gradient mapping: define a simple gradient palette here (you can extend)
  function gradientMap(t) {
    // simple gradient from blue -> cyan -> green -> yellow -> red
    if (t < 0.25) return [0, 0, 255 + t * 4 * (0 - 255)]; // blue to cyan
    if (t < 0.5) return [0, 255 * (t - 0.25) * 4, 255 * (0.5 - t) * 4]; // cyan to green
    if (t < 0.75) return [255 * (t - 0.5) * 4, 255, 0]; // green to yellow
    return [255, 255 * (1 - (t - 0.75) * 4), 0]; // yellow to red
  }

  // First pass: calculate iterations for each pixel
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let x0 = ((px / width) * 2 - 1) * scale * aspectRatio + offsetX;
      let y0 = ((py / height) * 2 - 1) * scale + offsetY;

      let zx, zy, cx, cy;

      if (type === "mandelbrot") {
        zx = 0;
        zy = 0;
        cx = x0;
        cy = y0;
      } else {
        zx = x0;
        zy = y0;
        cx = cRe;
        cy = cIm;
      }

      let i = 0;
      let minDist = Infinity; // for orbit trap

      while (zx * zx + zy * zy < 4 && i < maxIter) {
        // Orbit trap - track minimum distance to trap point
        if (coloring === "orbitTrap") {
          let dist = orbitTrap(zx, zy);
          if (dist < minDist) minDist = dist;
        }

        const xtemp = zx * zx - zy * zy + cx;
        zy = 2 * zx * zy + cy;
        zx = xtemp;
        i++;
      }

      // For histogram coloring tally
      if (coloring === "histogram") {
        if (i < maxIter) histogram[i]++;
        else histogram[maxIter]++;
      }

      iterationCounts[px + py * width] =
        i +
        (coloring === "smooth" && i < maxIter
          ? 1 - Math.log(Math.log(Math.sqrt(zx * zx + zy * zy))) / Math.log(2)
          : 0);

      // Save minDist for orbit trap coloring in iterationCounts (reuse array)
      if (coloring === "orbitTrap") {
        iterationCounts[px + py * width] = minDist;
      }
    }
  }

  // For histogram coloring, build cumulative distribution
  let cumulativeHist = null;
  if (coloring === "histogram") {
    cumulativeHist = new Float32Array(histogram.length);
    let cumsum = 0;
    for (let i = 0; i < histogram.length; i++) {
      cumsum += histogram[i];
      cumulativeHist[i] = cumsum;
    }
    // Normalize cumulative histogram (avoid division by zero)
    if (cumsum > 0) {
      for (let i = 0; i < cumulativeHist.length; i++) {
        cumulativeHist[i] /= cumsum;
      }
    }
  }

  // Second pass: color each pixel
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let i = iterationCounts[px + py * width];

      let r, g, b;

      switch (coloring) {
        case "binary":
          // Simple binary: inside set = black, outside = white
          if (i >= maxIter) {
            r = g = b = 0; // inside the set
          } else {
            r = g = b = 255; // outside the set
          }
          break;

        case "escape":
          // Escape time: color based on iteration count (no smoothing)
          if (i >= maxIter) {
            r = g = b = 0;
          } else {
            let t = Math.floor(i) / maxIter;
            [r, g, b] = getPaletteColor(palette, t);
          }
          break;

        case "smooth":
          if (i >= maxIter) {
            r = g = b = 0;
          } else {
            let t = i / maxIter;
            [r, g, b] = getPaletteColor(palette, t);
          }
          break;

        case "histogram":
          if (i >= maxIter) {
            r = g = b = 0;
          } else {
            // Find cumulative histogram value for iteration count
            let iterFloor = Math.floor(i);
            let t = cumulativeHist[iterFloor];
            [r, g, b] = getPaletteColor(palette, t);
          }
          break;

        case "orbitTrap":
          // Color by inverse distance to trap point
          let dist = i; // minDist stored here
          let intensity = Math.min(1, 1 / (dist * 50 + 0.01)); // tweak multiplier for effect
          r = intensity * 255;
          g = intensity * 100;
          b = intensity * 50;
          break;

        case "colorCycle":
          if (i >= maxIter) {
            r = g = b = 0;
          } else {
            let cycle = Math.floor(i) % 30;
            let hue = (cycle / 30) * 360;
            r = 128 + 127 * Math.sin((hue * Math.PI) / 180);
            g = 128 + 127 * Math.sin(((hue + 120) * Math.PI) / 180);
            b = 128 + 127 * Math.sin(((hue + 240) * Math.PI) / 180);
          }
          break;

        case "gradientMap":
          if (i >= maxIter) {
            r = g = b = 0;
          } else {
            let t = i / maxIter;
            [r, g, b] = gradientMap(t);
          }
          break;

        default:
          // fallback to grayscale
          let t = i / maxIter;
          r = g = b = 255 * t;
      }

      const index = (px + py * width) * 4;
      imageData.data[index] = Math.min(255, Math.max(0, Math.floor(r)));
      imageData.data[index + 1] = Math.min(255, Math.max(0, Math.floor(g)));
      imageData.data[index + 2] = Math.min(255, Math.max(0, Math.floor(b)));
      imageData.data[index + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function centerFractal() {
  const width = canvas.width;
  const height = canvas.height;
  const aspectRatio = width / height;

  // Set zoom level first
  zoom = 1;
  offsetX = 0;
  offsetY = 0;

  // Center Mandelbrot in wide screens by shifting offsetX
  offsetX = -0.5 * (aspectRatio - 1.0); // tweak this if needed
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const header = document.querySelector("header");
  const footer = document.querySelector("footer");

  // Calculate available space dynamically
  const controlsWidth = getControlsWidth();
  const cssWidth = window.innerWidth - controlsWidth;
  const cssHeight =
    window.innerHeight -
    (header ? header.offsetHeight : 0) -
    (footer ? footer.offsetHeight : 0);

  canvas.style.width = cssWidth + "px";
  canvas.style.height = cssHeight + "px";

  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;

  ctx.setTransform(1, 0, 0, 1, 0, 0); // reset any transforms
  ctx.scale(dpr, dpr); // scale drawing for HiDPI

  renderFractal();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function animateZoom(
  startZoom,
  endZoom,
  startX,
  endX,
  startY,
  endY,
  duration = 300
) {
  // Cancel any existing animation
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  const startTime = performance.now();

  function animate(time) {
    const t = Math.min(1, (time - startTime) / duration);

    // Smooth ease in/out
    const easedT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

    zoom = lerp(startZoom, endZoom, easedT);
    offsetX = lerp(startX, endX, easedT);
    offsetY = lerp(startY, endY, easedT);

    renderFractal();

    if (t < 1) {
      animationFrameId = requestAnimationFrame(animate);
    } else {
      animationFrameId = null;
    }
  }

  animationFrameId = requestAnimationFrame(animate);
}

function resetView() {
  // Stop any running animation
  if (animationState.isPlaying) {
    stopAnimation();
  }

  // Stop any running export
  if (exportState.isExporting) {
    cancelExport();
  }

  // Reset animation state to defaults
  animationState.loop = true;
  animationState.duration = 30;
  animationState.exportMode = false;
  const animationTypeSelect = document.getElementById('animationType');
  if (animationTypeSelect) {
    animationTypeSelect.value = 'none';
  }
  updateAnimationControls();

  // Use centerFractal to set proper default offsets (handles aspect ratio)
  centerFractal();
  renderFractal();
}

function downloadImage() {
  // Convert canvas to data URL (PNG)
  const dataURL = canvas.toDataURL("image/png");

  // Create a temporary link element
  const link = document.createElement("a");
  link.href = dataURL;
  link.download = "fractal.png"; // file name

  // Trigger the download
  link.click();

  // Clean up (optional)
  link.remove();
}

function zoomFractal(e) {
  // Stop any running animation when user manually interacts
  if (animationState.isPlaying) {
    stopAnimation();
  }

  // Only handle left click (0) and right click (2)
  if (e.button !== 0 && e.button !== 2) {
    return;
  }

  // Disable zoom for certain fractal types
  const fractalType = document.getElementById('type')?.value;
  if (fractalType === 'tree' || fractalType === 'sierpinski') {
    return;  // These fractals don't support zooming
  }

  const isRightClick = e.button === 2;
  const zoomFactor = isRightClick ? 0.5 : 2;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width;
  const height = canvas.height;

  // offsetX and offsetY need to be adjusted for DPR
  const mouseX = e.offsetX * dpr;
  const mouseY = e.offsetY * dpr;

  const aspectRatio = width / height;
  const scale = 1.5 / zoom;

  // Map pixel click to fractal coords
  const clickedX = ((mouseX / width) * 2 - 1) * scale * aspectRatio + offsetX;
  const clickedY = ((mouseY / height) * 2 - 1) * scale + offsetY;

  const newZoom = zoom * zoomFactor;

  // Calculate new scale for target zoom
  const newScale = 1.5 / newZoom;

  // Compute target offset so that clicked point remains under the cursor after zoom
  const targetOffsetX =
    clickedX - ((mouseX / width) * 2 - 1) * newScale * aspectRatio;
  const targetOffsetY = clickedY - ((mouseY / height) * 2 - 1) * newScale;

  animateZoom(
    zoom,
    newZoom,
    offsetX,
    targetOffsetX,
    offsetY,
    targetOffsetY,
    300
  );
}

// Cleanup function for worker
function cleanupWorker() {
  if (fractalWorker) {
    fractalWorker.terminate();
    fractalWorker = null;
  }
}

// Clear cached arrays to free memory
function clearMemoryCache() {
  cachedArrays = {
    iterationCounts: null,
    histogram: null,
    lastWidth: 0,
    lastHeight: 0,
    lastMaxIter: 0
  };
}

// Animation system
let animationState = {
  isPlaying: false,
  type: 'none',
  startTime: 0,
  speed: 1.0,
  frameCount: 0,
  requestId: null,
  duration: 30,
  loop: true
};

// Animation functions
function startAnimation() {
  const animationType = document.getElementById('animationType')?.value;
  if (animationType === 'none' || !animationType) return;

  animationState.isPlaying = true;
  animationState.type = animationType;
  animationState.startTime = performance.now();
  animationState.frameCount = 0;
  animationState.speed = parseFloat(document.getElementById('animationSpeed')?.value) || 1.0;

  // Only read UI values if NOT in export mode (export sets these programmatically)
  if (!animationState.exportMode) {
    animationState.duration = parseFloat(document.getElementById('animationDuration')?.value) || 30;
    animationState.loop = document.getElementById('animationLoop')?.checked || false;
  }

  // Update UI
  const playButton = document.getElementById('playAnimation');
  const stopButton = document.getElementById('stopAnimation');
  const progressContainer = document.querySelector('.animation-progress');
  if (playButton) playButton.style.display = 'none';
  if (stopButton) stopButton.style.display = 'block';
  if (progressContainer) progressContainer.classList.add('active');

  // Update total duration display
  const totalDisplay = document.getElementById('animationTotal');
  if (totalDisplay) totalDisplay.textContent = animationState.duration.toFixed(1);

  // Start animation loop
  window.animateFrame();
}

function stopAnimation() {
  animationState.isPlaying = false;
  if (animationState.requestId) {
    cancelAnimationFrame(animationState.requestId);
    animationState.requestId = null;
  }

  // Update UI
  const playButton = document.getElementById('playAnimation');
  const stopButton = document.getElementById('stopAnimation');
  const progressContainer = document.querySelector('.animation-progress');
  if (playButton) playButton.style.display = 'block';
  if (stopButton) stopButton.style.display = 'none';
  if (progressContainer) progressContainer.classList.remove('active');
}

window.animateFrame = function animateFrame() {
  if (!animationState.isPlaying) return;

  const elapsed = (performance.now() - animationState.startTime) * animationState.speed / 1000; // seconds
  animationState.frameCount++;

  // Update progress UI
  updateAnimationProgress(elapsed);

  // Check if animation should end
  if (elapsed >= animationState.duration) {
    if (animationState.loop) {
      // Restart animation
      animationState.startTime = performance.now();
      animationState.frameCount = 0;
    } else {
      // Stop animation
      stopAnimation();
      return;
    }
  }

  // Apply animation based on type
  const effectiveTime = animationState.loop ? (elapsed % animationState.duration) : elapsed;

  switch (animationState.type) {
    case 'julia':
      animateJulia(effectiveTime);
      break;
    case 'zoom':
      animateZoom(effectiveTime);
      break;
    case 'colorCycle':
      animateColorCycle(effectiveTime);
      break;
    case 'paramSweep':
      animateParameterSweep(effectiveTime);
      break;
  }

  // Continue animation
  animationState.requestId = requestAnimationFrame(window.animateFrame);
};

// Update animation progress display
function updateAnimationProgress(elapsed) {
  const progressBar = document.getElementById('animationProgressBar');
  const timeDisplay = document.getElementById('animationTime');
  const framesDisplay = document.getElementById('animationFrames');

  if (progressBar) {
    const progress = Math.min(100, (elapsed / animationState.duration) * 100);
    progressBar.style.width = progress + '%';
  }

  if (timeDisplay) {
    timeDisplay.textContent = elapsed.toFixed(1);
  }

  if (framesDisplay) {
    framesDisplay.textContent = animationState.frameCount;
  }
}

// Julia set morphing animation
function animateJulia(time) {
  if (!animationState.isPlaying) return;

  const pathType = document.getElementById('juliaPath')?.value || 'circle';
  let cReal, cImag;

  switch (pathType) {
    case 'circle':
      // Circle around origin
      const radius = 0.7;
      cReal = radius * Math.cos(time);
      cImag = radius * Math.sin(time);
      break;

    case 'spiral':
      // Spiral outward
      const spiralRadius = 0.3 + (time % 10) * 0.05;
      cReal = spiralRadius * Math.cos(time * 2);
      cImag = spiralRadius * Math.sin(time * 2);
      break;

    case 'lemniscate':
      // Figure-8 pattern
      const t = time * 0.5;
      const scale = 0.6;
      cReal = scale * Math.sin(t) / (1 + Math.cos(t) * Math.cos(t));
      cImag = scale * Math.sin(t) * Math.cos(t) / (1 + Math.cos(t) * Math.cos(t));
      break;

    case 'random':
      // Smooth random walk using Perlin-like interpolation
      const freq = 0.3;
      cReal = 0.7 * Math.sin(time * freq) * Math.cos(time * freq * 1.3);
      cImag = 0.7 * Math.cos(time * freq * 0.7) * Math.sin(time * freq * 1.7);
      break;
  }

  // Update inputs
  const cRealInput = document.getElementById('cReal');
  const cImagInput = document.getElementById('cImag');
  if (cRealInput) cRealInput.value = cReal.toFixed(4);
  if (cImagInput) cImagInput.value = cImag.toFixed(4);

  // Render
  renderFractal();
}

// Auto zoom animation
function animateZoom(time) {
  const targetType = document.getElementById('zoomTarget')?.value || 'center';

  // Exponential zoom in
  const zoomSpeed = 0.3;
  const newZoom = Math.exp(time * zoomSpeed);
  zoom = newZoom;

  // Interesting points for Mandelbrot
  const interestingPoints = {
    mandelbrot: { x: -0.7, y: 0.0 },
    julia: { x: 0.0, y: 0.0 }
  };

  const fractalType = document.getElementById('type')?.value || 'mandelbrot';

  if (targetType === 'interesting' && interestingPoints[fractalType]) {
    offsetX = interestingPoints[fractalType].x;
    offsetY = interestingPoints[fractalType].y;
  } else if (targetType === 'spiral') {
    const spiralSpeed = 0.1;
    const spiralRadius = 0.5 / Math.sqrt(newZoom);
    offsetX = spiralRadius * Math.cos(time * spiralSpeed);
    offsetY = spiralRadius * Math.sin(time * spiralSpeed);
  }

  renderFractal();
}

// Color cycling animation
let colorCycleOffset = 0;
function animateColorCycle(time) {
  colorCycleOffset = time * 50; // Cycle speed
  renderFractalWithColorOffset(colorCycleOffset);
}

// Parameter sweep animation
function animateParameterSweep(time) {
  const param = document.getElementById('sweepParam')?.value;
  if (!param) return;

  const cycle = Math.sin(time * 0.5) * 0.5 + 0.5; // 0 to 1 oscillating

  switch (param) {
    case 'iterations':
      const minIter = 50;
      const maxIter = 500;
      const iterations = Math.floor(minIter + cycle * (maxIter - minIter));
      const iterInput = document.getElementById('iterations');
      if (iterInput) iterInput.value = iterations;
      break;

    case 'newtonPower':
      const power = Math.floor(2 + cycle * 6); // 2 to 8
      const powerInput = document.getElementById('newtonPower');
      if (powerInput) powerInput.value = power;
      break;

    case 'treeAngle':
      const angle = 10 + cycle * 70; // 10 to 80 degrees
      const angleInput = document.getElementById('treeAngle');
      if (angleInput) angleInput.value = Math.floor(angle);
      break;

    case 'treeLengthRatio':
      const ratio = 0.5 + cycle * 0.35; // 0.5 to 0.85
      const ratioInput = document.getElementById('treeLengthRatio');
      if (ratioInput) ratioInput.value = ratio.toFixed(2);
      break;
  }

  renderFractal();
}

// Render with color offset for cycling effect
function renderFractalWithColorOffset(offset) {
  // This is a simplified version - we'd need to pass offset to worker
  // For now, just trigger a regular render
  renderFractal();
}

// ============================================
// EXPORT SYSTEM
// ============================================

let exportState = {
  isExporting: false,
  format: 'webm',
  mediaRecorder: null,
  recordedChunks: [],
  frameCount: 0,
  frameStep: 1,
  capturedFrames: [],
  stream: null,
  originalAnimateFrame: null,
  exportStartTime: 0
};

// Start export
function startExport() {
  // Validate animation type is selected
  const animationType = document.getElementById('animationType')?.value;
  if (!animationType || animationType === 'none') {
    alert('⚠️ Please select an Animation Type before exporting.\n\nChoose from:\n• Julia Set Morph\n• Auto Zoom\n• Color Cycle\n• Parameter Sweep');
    return;
  }

  const format = document.getElementById('exportFormat')?.value || 'webm';
  exportState.format = format;
  exportState.frameCount = 0;
  exportState.isExporting = true;

  // Show export progress
  const exportProgress = document.querySelector('.export-progress');
  const startButton = document.getElementById('startExport');
  const cancelButton = document.getElementById('cancelExport');
  if (exportProgress) exportProgress.style.display = 'block';
  if (startButton) startButton.style.display = 'none';
  if (cancelButton) cancelButton.style.display = 'block';

  if (format === 'webm') {
    startWebMExport();
  } else if (format === 'png-sequence') {
    startPNGSequenceExport();
  }
}

// Cancel export
function cancelExport() {
  exportState.isExporting = false;

  // Stop media recorder if active
  if (exportState.mediaRecorder && exportState.mediaRecorder.state !== 'inactive') {
    exportState.mediaRecorder.stop();
  }

  // Stop stream
  if (exportState.stream) {
    exportState.stream.getTracks().forEach(track => track.stop());
    exportState.stream = null;
  }

  // Clear captured frames
  exportState.capturedFrames = [];
  exportState.frameCount = 0;

  // Restore original animateFrame function if it was hooked
  if (exportState.originalAnimateFrame) {
    window.animateFrame = exportState.originalAnimateFrame;
    exportState.originalAnimateFrame = null;
  }

  // Reset UI
  const exportProgress = document.querySelector('.export-progress');
  const startButton = document.getElementById('startExport');
  const cancelButton = document.getElementById('cancelExport');
  const statusDisplay = document.getElementById('exportStatus');
  const progressBar = document.getElementById('exportProgressBar');

  if (exportProgress) exportProgress.style.display = 'none';
  if (startButton) startButton.style.display = 'block';
  if (cancelButton) cancelButton.style.display = 'none';
  if (statusDisplay) statusDisplay.textContent = 'Cancelled';
  if (progressBar) progressBar.style.width = '0%';

  // Stop animation if it's running
  if (animationState.isPlaying) {
    stopAnimation();
  }

  // Clear export mode flag
  animationState.exportMode = false;
}

// WebM video export using MediaRecorder API
function startWebMExport() {
  try {
    const statusDisplay = document.getElementById('exportStatus');
    if (statusDisplay) statusDisplay.textContent = 'Initializing recorder...';

    // Get export duration (this is the VIDEO duration, not recording duration)
    const exportDuration = parseFloat(document.getElementById('animationDuration')?.value) || 30;

    // Get canvas stream
    const fps = parseInt(document.getElementById('exportFPS')?.value) || 30;
    exportState.stream = canvas.captureStream(fps);

    // Get quality settings
    const quality = document.getElementById('exportQuality')?.value || 'medium';
    const bitrates = { high: 2500000, medium: 1500000, low: 800000 };
    const bitrate = bitrates[quality];

    // Create media recorder
    const options = {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: bitrate
    };

    // Fallback to vp8 if vp9 not supported
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options.mimeType = 'video/webm;codecs=vp8';
    }

    exportState.mediaRecorder = new MediaRecorder(exportState.stream, options);
    exportState.recordedChunks = [];

    exportState.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        exportState.recordedChunks.push(event.data);
      }
    };

    exportState.mediaRecorder.onstop = () => {
      if (exportState.recordedChunks.length > 0) {
        const blob = new Blob(exportState.recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `fractal-animation-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);

        if (statusDisplay) statusDisplay.textContent = 'Export complete!';
      }

      // Cleanup
      if (exportState.stream) {
        exportState.stream.getTracks().forEach(track => track.stop());
        exportState.stream = null;
      }

      // Reset UI after a delay
      setTimeout(() => {
        const exportProgress = document.querySelector('.export-progress');
        const startButton = document.getElementById('startExport');
        const cancelButton = document.getElementById('cancelExport');

        if (exportProgress) exportProgress.style.display = 'none';
        if (startButton) startButton.style.display = 'block';
        if (cancelButton) cancelButton.style.display = 'none';
      }, 2000);

      exportState.isExporting = false;
    };

    // FORCE animation to run for exact duration
    // Save original animation state
    const originalLoop = animationState.loop;
    const originalDuration = animationState.duration;
    const originalType = animationState.type;

    // Get animation type (already validated in startExport)
    const animationType = document.getElementById('animationType')?.value;

    // Save and set fractal type based on animation
    const fractalTypeSelect = document.getElementById('type');
    const originalFractalType = fractalTypeSelect?.value;

    // Set appropriate fractal type for the animation
    if (animationType === 'julia' && fractalTypeSelect) {
      fractalTypeSelect.value = 'julia';
    }

    // Override for export - set exportMode first so startAnimation sees it
    animationState.exportMode = true;
    animationState.loop = false;
    animationState.duration = exportDuration;
    animationState.type = animationType;

    // Stop any existing animation
    if (animationState.isPlaying) {
      stopAnimation();
    }

    // Start fresh animation before recorder
    startAnimation();

    // Set start time immediately (before setTimeout)
    exportState.exportStartTime = performance.now();

    // Wait for first frame to render, then start recording
    setTimeout(() => {
      exportState.mediaRecorder.start();
      if (statusDisplay) statusDisplay.textContent = 'Recording...';
    }, 300);

    // Monitor export progress and auto-stop
    const monitorInterval = setInterval(() => {
      if (!exportState.isExporting) {
        clearInterval(monitorInterval);
        // Restore original settings
        animationState.loop = originalLoop;
        animationState.duration = originalDuration;
        animationState.type = originalType;
        animationState.exportMode = false;
        if (fractalTypeSelect && originalFractalType) {
          fractalTypeSelect.value = originalFractalType;
        }
        return;
      }

      const exportElapsed = (performance.now() - exportState.exportStartTime) / 1000;
      const frameDisplay = document.getElementById('exportFrameCount');
      const progressBar = document.getElementById('exportProgressBar');

      // Update frame count
      if (frameDisplay) {
        frameDisplay.textContent = Math.floor(exportElapsed * fps);
      }

      // Update progress based on EXPORT duration
      if (progressBar) {
        const progress = Math.min(100, (exportElapsed / exportDuration) * 100);
        progressBar.style.width = progress + '%';
      }

      // Auto-stop when export duration reached
      if (exportElapsed >= exportDuration) {
        // Mark export as complete
        exportState.isExporting = false;

        // Stop recorder
        if (exportState.mediaRecorder && exportState.mediaRecorder.state === 'recording') {
          exportState.mediaRecorder.stop();
        }

        // Stop animation immediately (before restoring loop setting)
        if (animationState.isPlaying) {
          stopAnimation();
        }

        // Restore original settings after animation is stopped
        animationState.loop = originalLoop;
        animationState.duration = originalDuration;
        animationState.type = originalType;
        animationState.exportMode = false;
        if (fractalTypeSelect && originalFractalType) {
          fractalTypeSelect.value = originalFractalType;
        }

        clearInterval(monitorInterval);
      }
    }, 100);

  } catch (error) {
    console.error('WebM export error:', error);
    const statusDisplay = document.getElementById('exportStatus');
    if (statusDisplay) statusDisplay.textContent = 'Error: ' + error.message;
    cancelExport();
  }
}

// PNG sequence export
function startPNGSequenceExport() {
  const statusDisplay = document.getElementById('exportStatus');
  const frameStepInput = document.getElementById('exportFrameStep');
  exportState.frameStep = parseInt(frameStepInput?.value) || 2;
  exportState.capturedFrames = [];
  exportState.frameCount = 0;

  // Get export duration
  const exportDuration = parseFloat(document.getElementById('animationDuration')?.value) || 30;
  exportState.exportStartTime = performance.now();

  if (statusDisplay) statusDisplay.textContent = 'Capturing frames...';

  // Save original animation settings
  const originalLoop = animationState.loop;
  const originalDuration = animationState.duration;
  const originalType = animationState.type;

  // Get animation type (already validated in startExport)
  const animationType = document.getElementById('animationType')?.value;

  // Override for export
  animationState.loop = false;
  animationState.duration = exportDuration;
  animationState.type = animationType;
  animationState.exportMode = true;

  // Hook into animation frame rendering
  exportState.originalAnimateFrame = window.animateFrame;
  let frameCounter = 0;

  window.animateFrame = function() {
    if (exportState.originalAnimateFrame) {
      exportState.originalAnimateFrame.call(this);
    }

    if (!exportState.isExporting) {
      if (exportState.originalAnimateFrame) {
        window.animateFrame = exportState.originalAnimateFrame;
        exportState.originalAnimateFrame = null;
      }
      // Restore original settings
      animationState.loop = originalLoop;
      animationState.duration = originalDuration;
      animationState.type = originalType;
      animationState.exportMode = false;
      return;
    }

    // Capture frame at specified interval
    if (frameCounter % exportState.frameStep === 0) {
      const frameData = canvas.toDataURL('image/png');
      exportState.capturedFrames.push(frameData);
      exportState.frameCount++;

      // Update UI
      const frameDisplay = document.getElementById('exportFrameCount');
      const progressBar = document.getElementById('exportProgressBar');

      if (frameDisplay) {
        frameDisplay.textContent = exportState.frameCount;
      }

      const exportElapsed = (performance.now() - exportState.exportStartTime) / 1000;
      if (progressBar) {
        const progress = Math.min(100, (exportElapsed / exportDuration) * 100);
        progressBar.style.width = progress + '%';
      }
    }

    frameCounter++;

    // Check if duration reached
    const exportElapsed = (performance.now() - exportState.exportStartTime) / 1000;
    if (exportElapsed >= exportDuration) {
      // Restore original function
      window.animateFrame = exportState.originalAnimateFrame;
      exportState.originalAnimateFrame = null;

      // Stop animation
      if (animationState.isPlaying) {
        stopAnimation();
      }

      // Restore original settings
      animationState.loop = originalLoop;
      animationState.duration = originalDuration;
      animationState.type = originalType;
      animationState.exportMode = false;

      // Download all frames
      downloadPNGSequence();
    }
  };

  // Stop any existing animation and start fresh
  if (animationState.isPlaying) {
    stopAnimation();
  }
  startAnimation();
}

// Download PNG sequence as individual files
function downloadPNGSequence() {
  const statusDisplay = document.getElementById('exportStatus');

  if (exportState.capturedFrames.length === 0) {
    if (statusDisplay) statusDisplay.textContent = 'No frames captured';
    cancelExport();
    return;
  }

  if (statusDisplay) statusDisplay.textContent = `Downloading ${exportState.capturedFrames.length} frames...`;

  // Download frames with delay to avoid browser blocking
  let downloadIndex = 0;
  const timestamp = Date.now();

  const downloadNext = () => {
    if (downloadIndex >= exportState.capturedFrames.length) {
      if (statusDisplay) statusDisplay.textContent = 'Export complete!';

      // Show conversion instructions
      showConversionInstructions();

      // Reset UI
      setTimeout(() => {
        const exportProgress = document.querySelector('.export-progress');
        const startButton = document.getElementById('startExport');
        const cancelButton = document.getElementById('cancelExport');

        if (exportProgress) exportProgress.style.display = 'none';
        if (startButton) startButton.style.display = 'block';
        if (cancelButton) cancelButton.style.display = 'none';
      }, 5000);

      exportState.isExporting = false;
      return;
    }

    const frameData = exportState.capturedFrames[downloadIndex];
    const a = document.createElement('a');
    a.href = frameData;
    a.download = `fractal-frame-${timestamp}-${String(downloadIndex).padStart(5, '0')}.png`;
    a.click();

    downloadIndex++;

    // Update progress
    const progressBar = document.getElementById('exportProgressBar');
    if (progressBar) {
      const progress = (downloadIndex / exportState.capturedFrames.length) * 100;
      progressBar.style.width = progress + '%';
    }

    // Continue with next frame (small delay to avoid blocking)
    setTimeout(downloadNext, 50);
  };

  downloadNext();
}

// Show instructions for converting PNG sequence to video
function showConversionInstructions() {
  const statusDisplay = document.getElementById('exportStatus');
  if (statusDisplay) {
    statusDisplay.innerHTML = `
      <strong>Frames saved!</strong><br>
      <small>To convert to AVI/MPG, use FFmpeg:<br>
      <code style="font-size: 0.7rem; background: var(--bg-secondary); padding: 0.25rem; border-radius: 3px; display: block; margin-top: 0.25rem;">
        ffmpeg -framerate 30 -pattern_type glob -i 'fractal-frame-*.png' -c:v mpeg4 output.avi
      </code></small>
    `;
  }
}

// Fractal type descriptions
const fractalDescriptions = {
  mandelbrot: "The famous Mandelbrot set showing infinite complexity at every scale.",
  julia: "Julia sets create beautiful symmetric patterns based on complex constants.",
  burningship: "A variation of Mandelbrot with absolute values, creating ship-like shapes.",
  newton: "Newton's method visualized - colors show which root each point converges to.",
  sierpinski: "Classic fractal triangle created using the chaos game algorithm.",
  tree: "Recursive branching structure resembling natural trees and plants."
};

// Handle fractal type changes
function updateFractalControls() {
  const fractalType = document.getElementById('type')?.value || 'mandelbrot';
  const description = document.getElementById('fractalDesc');

  // Update description
  if (description) {
    description.textContent = fractalDescriptions[fractalType] || '';
  }

  // Hide all fractal-specific controls
  document.querySelectorAll('.fractal-specific').forEach(control => {
    control.classList.remove('active');
  });

  // Show relevant controls for this fractal type
  document.querySelectorAll(`.fractal-specific[data-fractal*="${fractalType}"]`).forEach(control => {
    control.classList.add('active');
  });

  // Auto-render on type change
  renderFractal();
}

// Handle animation type changes
function updateAnimationControls() {
  const animationType = document.getElementById('animationType')?.value || 'none';
  const exportSection = document.querySelector('.export-section');
  const playButton = document.getElementById('playAnimation');
  const stopButton = document.getElementById('stopAnimation');

  // Hide all animation-specific controls
  document.querySelectorAll('.animation-control').forEach(control => {
    control.classList.remove('active');
  });

  // Show/hide controls based on animation type
  if (animationType !== 'none') {
    // Show animation controls
    document.querySelectorAll(`.animation-control[data-animation*="${animationType}"]`).forEach(control => {
      control.classList.add('active');
    });

    // Show export section
    if (exportSection) exportSection.style.display = 'block';

    // Enable play button
    if (playButton) playButton.disabled = false;
  } else {
    // Hide export section when no animation selected
    if (exportSection) exportSection.style.display = 'none';

    // Disable play button
    if (playButton) playButton.disabled = true;

    // Stop any running animation
    if (animationState.isPlaying) {
      stopAnimation();
    }
  }
}

// Update speed display
function updateSpeedDisplay() {
  const speed = document.getElementById('animationSpeed')?.value || 1.0;
  const display = document.getElementById('speedValue');
  if (display) {
    display.textContent = parseFloat(speed).toFixed(1);
  }
}

// Handle export format changes
function updateExportControls() {
  const format = document.getElementById('exportFormat')?.value || 'webm';

  // Hide all export-specific options
  document.querySelectorAll('.export-option').forEach(option => {
    option.style.display = 'none';
  });

  // Show relevant options for this format
  document.querySelectorAll(`.export-option[data-format="${format}"]`).forEach(option => {
    option.style.display = 'block';
  });

  // Update description
  document.querySelectorAll('.export-desc').forEach(desc => {
    desc.style.display = 'none';
  });

  const activeDesc = document.querySelector(`.export-desc[data-format="${format}"]`);
  if (activeDesc) {
    activeDesc.style.display = 'block';
  }
}

// Dark mode toggle
function initializeDarkMode() {
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = themeToggle?.querySelector('.theme-icon');
  const themeText = themeToggle?.querySelector('.theme-text');

  // Check for saved preference or default to light mode
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');

  if (initialTheme === 'dark') {
    document.body.classList.add('dark-mode');
    if (themeIcon) themeIcon.textContent = '☀️';
    if (themeText) themeText.textContent = 'Light Mode';
  }

  // Toggle dark mode
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      const isDark = document.body.classList.contains('dark-mode');

      // Update button
      if (themeIcon) themeIcon.textContent = isDark ? '☀️' : '🌙';
      if (themeText) themeText.textContent = isDark ? 'Light Mode' : 'Dark Mode';

      // Save preference
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });
  }
}

function initializeApp() {
  if (!canvas || !ctx) {
    console.error("Canvas element not found");
    return;
  }

  // Initialize dark mode
  initializeDarkMode();

  // Initialize fractal controls
  updateFractalControls();

  // Log worker support status
  console.log('Web Worker support:', workerSupported ? 'Enabled' : 'Disabled (fallback to main thread)');

  canvas.addEventListener("contextmenu", (e) => e.preventDefault()); // Disable context menu
  canvas.addEventListener("mousedown", (e) => zoomFractal(e));

  const renderButton = document.getElementById("renderButton");
  const resetButton = document.getElementById("resetView");
  const downloadButton = document.getElementById("downloadImage");
  const typeSelect = document.getElementById("type");
  const playButton = document.getElementById("playAnimation");
  const stopButton = document.getElementById("stopAnimation");
  const animationTypeSelect = document.getElementById("animationType");
  const animationSpeedSlider = document.getElementById("animationSpeed");
  const animationDurationInput = document.getElementById("animationDuration");
  const exportFormatSelect = document.getElementById("exportFormat");
  const startExportButton = document.getElementById("startExport");
  const cancelExportButton = document.getElementById("cancelExport");

  if (renderButton) {
    renderButton.addEventListener("click", () => renderFractal());
  }
  if (resetButton) {
    resetButton.addEventListener("click", () => resetView());
  }
  if (downloadButton) {
    downloadButton.addEventListener("click", () => downloadImage());
  }
  if (typeSelect) {
    typeSelect.addEventListener("change", () => updateFractalControls());
  }
  if (playButton) {
    playButton.addEventListener("click", () => startAnimation());
  }
  if (stopButton) {
    stopButton.addEventListener("click", () => stopAnimation());
  }
  if (animationTypeSelect) {
    animationTypeSelect.addEventListener("change", () => updateAnimationControls());
  }
  if (animationSpeedSlider) {
    animationSpeedSlider.addEventListener("input", () => updateSpeedDisplay());
  }
  if (animationDurationInput) {
    animationDurationInput.addEventListener("change", () => {
      const totalDisplay = document.getElementById('animationTotal');
      if (totalDisplay) {
        totalDisplay.textContent = parseFloat(animationDurationInput.value).toFixed(1);
      }
    });
  }
  if (exportFormatSelect) {
    exportFormatSelect.addEventListener("change", () => updateExportControls());
  }
  if (startExportButton) {
    startExportButton.addEventListener("click", () => startExport());
  }
  if (cancelExportButton) {
    cancelExportButton.addEventListener("click", () => cancelExport());
  }

  // Initialize animation controls
  updateAnimationControls();

  // Initialize export controls
  updateExportControls();

  window.addEventListener("resize", resizeCanvas);

  // Cleanup on page unload
  window.addEventListener("beforeunload", () => {
    cleanupWorker();
    clearMemoryCache();
  });

  centerFractal();
  resizeCanvas();
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeApp);
} else {
  // DOM already loaded
  initializeApp();
}
