let offsetX = 0;
let offsetY = 0;
let zoom = 1; // initial zoom level

const canvas = document.getElementById("fractalCanvas");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth - 300;
canvas.height =
  window.innerHeight -
  document.querySelector("header").offsetHeight -
  document.querySelector("footer").offsetHeight;

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
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width;
  const height = canvas.height;

  const type = document.getElementById("type").value;
  const cRe = parseFloat(document.getElementById("cReal").value);
  const cIm = parseFloat(document.getElementById("cImag").value);
  const maxIter = parseInt(document.getElementById("iterations").value);
  const coloring = document.getElementById("coloring").value;
  const palette = document.getElementById("palette").value;

  const aspectRatio = width / height;
  const scale = 1.5 / zoom;

  const imageData = ctx.createImageData(width, height);

  // For histogram coloring, we need two passes:
  // First pass: calculate iteration counts for all pixels and build histogram
  let iterationCounts = new Uint32Array(width * height);
  let histogram = new Uint32Array(maxIter + 1);

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
    // Normalize cumulative histogram
    for (let i = 0; i < cumulativeHist.length; i++) {
      cumulativeHist[i] /= cumsum;
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
  const cssWidth = window.innerWidth - 300;
  const cssHeight =
    window.innerHeight -
    document.querySelector("header").offsetHeight -
    document.querySelector("footer").offsetHeight;

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
      requestAnimationFrame(animate);
    }
  }

  requestAnimationFrame(animate);
}

function resetView() {
  offsetX = 0;
  offsetY = 0;
  zoom = 1;
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

canvas.addEventListener("contextmenu", (e) => e.preventDefault()); // Disable context menu
canvas.addEventListener("mousedown", (e) => zoomFractal(e));

document
  .getElementById("renderButton")
  .addEventListener("click", () => renderFractal());
document
  .getElementById("resetView")
  .addEventListener("click", () => resetView());
document
  .getElementById("downloadImage")
  .addEventListener("click", () => downloadImage());

window.addEventListener("resize", resizeCanvas);

centerFractal();
resizeCanvas();
