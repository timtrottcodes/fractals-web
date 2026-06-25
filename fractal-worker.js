// Web Worker for fractal computation
// This runs on a separate thread to keep the UI responsive

function getPaletteColor(palette, t) {
  switch (palette) {
    case "fire":
      return [255 * t, 80 * t, 20];

    case "fern":
      return [34 * t, 139 * t + 50, 34 * t];

    case "retroPlasma":
      return [
        128 + 127 * Math.sin(6.28 * t),
        128 + 127 * Math.sin(6.28 * t + 2),
        128 + 127 * Math.sin(6.28 * t + 4),
      ];

    case "sunset":
      return [255 * t, 100 * (1 - t), 180 * (1 - t)];

    case "oceanic":
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

function orbitTrap(zx, zy) {
  const trapX = 0.0;
  const trapY = 0.0;
  const dist = Math.sqrt((zx - trapX) ** 2 + (zy - trapY) ** 2);
  return dist;
}

function gradientMap(t) {
  if (t < 0.25) return [0, 0, 255 + t * 4 * (0 - 255)];
  if (t < 0.5) return [0, 255 * (t - 0.25) * 4, 255 * (0.5 - t) * 4];
  if (t < 0.75) return [255 * (t - 0.5) * 4, 255, 0];
  return [255, 255 * (1 - (t - 0.75) * 4), 0];
}

self.onmessage = function(e) {
  const { width, height, type, cRe, cIm, maxIter, coloring, palette, offsetX, offsetY, zoom,
          newtonPower, newtonRelax, sierpinskiPoints, treeAngle, treeLengthRatio, treeDepth, treeColor } = e.data;

  // Route to appropriate fractal renderer
  if (type === 'sierpinski') {
    renderSierpinski(width, height, sierpinskiPoints, palette);
    return;
  }

  if (type === 'tree') {
    renderTree(width, height, treeAngle, treeLengthRatio, treeDepth, treeColor);
    return;
  }

  // Escape-time fractals (Mandelbrot, Julia, Burning Ship, Newton)
  renderEscapeTimeFractal(width, height, type, cRe, cIm, maxIter, coloring, palette, offsetX, offsetY, zoom, newtonPower, newtonRelax);
};

// Sierpinski Triangle using Chaos Game
function renderSierpinski(width, height, numPoints, palette) {
  const imageData = new Uint8ClampedArray(width * height * 4);
  const density = new Uint32Array(width * height);

  // Three vertices of the triangle
  const vertices = [
    { x: width / 2, y: height * 0.1 },
    { x: width * 0.1, y: height * 0.9 },
    { x: width * 0.9, y: height * 0.9 }
  ];

  // Start at random point
  let x = Math.random() * width;
  let y = Math.random() * height;

  // Chaos game algorithm
  for (let i = 0; i < numPoints; i++) {
    const vertex = vertices[Math.floor(Math.random() * 3)];
    x = (x + vertex.x) / 2;
    y = (y + vertex.y) / 2;

    const px = Math.floor(x);
    const py = Math.floor(y);

    if (px >= 0 && px < width && py >= 0 && py < height) {
      density[px + py * width]++;
    }

    // Progress update
    if (i % 10000 === 0) {
      self.postMessage({
        type: 'progress',
        progress: (i / numPoints) * 100
      });
    }
  }

  // Find max density for normalization
  let maxDensity = 0;
  for (let i = 0; i < density.length; i++) {
    if (density[i] > maxDensity) maxDensity = density[i];
  }

  // Color the pixels
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const idx = px + py * width;
      const d = density[idx];
      const index = idx * 4;

      if (d > 0) {
        const t = Math.log(d + 1) / Math.log(maxDensity + 1);
        const [r, g, b] = getPaletteColor(palette, t);
        imageData[index] = r;
        imageData[index + 1] = g;
        imageData[index + 2] = b;
        imageData[index + 3] = 255;
      } else {
        imageData[index] = 0;
        imageData[index + 1] = 0;
        imageData[index + 2] = 0;
        imageData[index + 3] = 255;
      }
    }
  }

  self.postMessage({
    type: 'complete',
    imageData: imageData,
    width: width,
    height: height
  }, [imageData.buffer]);
}

// Fractal Tree
function renderTree(width, height, angle, lengthRatio, depth, colorScheme) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Clear background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  // Color schemes
  const colors = {
    natural: { trunk: '#8B4513', leaves: ['#228B22', '#32CD32', '#90EE90'] },
    autumn: { trunk: '#654321', leaves: ['#FF4500', '#FF6347', '#FFD700'] },
    cherry: { trunk: '#8B4513', leaves: ['#FFB6C1', '#FFC0CB', '#FF69B4'] },
    blue: { trunk: '#4169E1', leaves: ['#4169E1', '#6495ED', '#87CEEB'] },
    rainbow: { trunk: '#808080', leaves: ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#9400D3'] }
  };

  const scheme = colors[colorScheme] || colors.natural;

  // Store the outer function parameters for use in inner function
  const branchAngleDeg = angle;
  const maxTreeDepth = depth;

  function drawBranch(x, y, len, branchAngle, currentDepth, branchColor) {
    if (currentDepth === 0) return;

    const endX = x + len * Math.cos(branchAngle);
    const endY = y + len * Math.sin(branchAngle);

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(endX, endY);
    ctx.lineWidth = currentDepth * 0.8;
    ctx.strokeStyle = branchColor;
    ctx.stroke();

    const newLen = len * lengthRatio;
    const angleChange = branchAngleDeg * (Math.PI / 180);
    const leftAngle = branchAngle - angleChange;
    const rightAngle = branchAngle + angleChange;

    // Color branches - get greener/more colorful as we go up
    const colorIdx = Math.min(scheme.leaves.length - 1, Math.floor((currentDepth / maxTreeDepth) * scheme.leaves.length));
    const nextColor = currentDepth < 4 ? scheme.leaves[colorIdx] : branchColor;

    drawBranch(endX, endY, newLen, leftAngle, currentDepth - 1, nextColor);
    drawBranch(endX, endY, newLen, rightAngle, currentDepth - 1, nextColor);
  }

  // Start tree from bottom center
  const startX = width / 2;
  const startY = height * 0.95;
  const initialLength = height * 0.25;
  const initialAngle = -Math.PI / 2; // Point upward

  drawBranch(startX, startY, initialLength, initialAngle, maxTreeDepth, scheme.trunk);

  // Convert to imageData
  const imageData = ctx.getImageData(0, 0, width, height);

  self.postMessage({
    type: 'complete',
    imageData: imageData.data,
    width: width,
    height: height
  }, [imageData.data.buffer]);
}

// Escape-time fractals
function renderEscapeTimeFractal(width, height, type, cRe, cIm, maxIter, coloring, palette, offsetX, offsetY, zoom, newtonPower, newtonRelax) {
  const aspectRatio = width / height;
  const scale = 1.5 / zoom;

  const imageData = new Uint8ClampedArray(width * height * 4);
  const iterationCounts = new Float32Array(width * height);
  const histogram = new Uint32Array(maxIter + 1);

  // Progressive rendering: send updates every N rows
  const progressiveChunkSize = Math.max(20, Math.floor(height / 10));
  let lastProgressUpdate = 0;

  // First pass: calculate iterations
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let x0 = ((px / width) * 2 - 1) * scale * aspectRatio + offsetX;
      let y0 = ((py / height) * 2 - 1) * scale + offsetY;

      let i = 0;
      let minDist = Infinity;
      let zx, zy, finalMagnitude = 0;

      // Different fractal types
      if (type === "mandelbrot" || type === "julia") {
        let cx, cy;
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

        while (zx * zx + zy * zy < 4 && i < maxIter) {
          if (coloring === "orbitTrap") {
            let dist = orbitTrap(zx, zy);
            if (dist < minDist) minDist = dist;
          }

          const xtemp = zx * zx - zy * zy + cx;
          zy = 2 * zx * zy + cy;
          zx = xtemp;
          i++;
        }
        finalMagnitude = Math.sqrt(zx * zx + zy * zy);

      } else if (type === "burningship") {
        zx = 0;
        zy = 0;

        while (zx * zx + zy * zy < 4 && i < maxIter) {
          if (coloring === "orbitTrap") {
            let dist = orbitTrap(zx, zy);
            if (dist < minDist) minDist = dist;
          }

          const xtemp = zx * zx - zy * zy + x0;
          zy = 2 * Math.abs(zx * zy) + y0;  // Absolute value creates the "ship"
          zx = Math.abs(xtemp);
          i++;
        }
        finalMagnitude = Math.sqrt(zx * zx + zy * zy);

      } else if (type === "newton") {
        zx = x0;
        zy = y0;
        const power = newtonPower || 3;
        const relax = newtonRelax || 1.0;

        // Newton's method for z^n - 1 = 0
        for (let iter = 0; iter < maxIter; iter++) {
          const r2 = zx * zx + zy * zy;

          if (r2 < 0.0001) {
            i = iter;
            break;
          }

          // Compute z^(n-1)
          let powX = zx;
          let powY = zy;
          for (let p = 1; p < power - 1; p++) {
            const tempX = powX * zx - powY * zy;
            powY = powX * zy + powY * zx;
            powX = tempX;
          }

          // Compute z^n
          const znX = powX * zx - powY * zy;
          const znY = powX * zy + powY * zx;

          // f(z) = z^n - 1
          const fX = znX - 1;
          const fY = znY;

          // f'(z) = n * z^(n-1)
          const fpX = power * powX;
          const fpY = power * powY;

          // Newton step: z = z - relax * f(z)/f'(z)
          const denom = fpX * fpX + fpY * fpY;
          if (denom < 0.0001) break;

          const divX = (fX * fpX + fY * fpY) / denom;
          const divY = (fY * fpX - fX * fpY) / denom;

          zx -= relax * divX;
          zy -= relax * divY;

          i = iter;
        }

        // Color based on which root we converged to
        const angle = Math.atan2(zy, zx);
        minDist = angle;  // Store angle for coloring
        finalMagnitude = Math.sqrt(zx * zx + zy * zy);
      }

      if (coloring === "histogram" && type !== "newton") {
        if (i < maxIter) histogram[i]++;
        else histogram[maxIter]++;
      }

      iterationCounts[px + py * width] =
        i +
        (coloring === "smooth" && i < maxIter && type !== "newton"
          ? 1 - Math.log(Math.log(finalMagnitude)) / Math.log(2)
          : 0);

      if (coloring === "orbitTrap" || type === "newton") {
        iterationCounts[px + py * width] = minDist;
      }
    }

    // Send progressive update
    if (py - lastProgressUpdate >= progressiveChunkSize && py < height - 1) {
      self.postMessage({
        type: 'progress',
        progress: (py / height) * 100
      });
      lastProgressUpdate = py;
    }
  }

  // Build cumulative histogram if needed
  let cumulativeHist = null;
  if (coloring === "histogram") {
    cumulativeHist = new Float32Array(histogram.length);
    let cumsum = 0;
    for (let i = 0; i < histogram.length; i++) {
      cumsum += histogram[i];
      cumulativeHist[i] = cumsum;
    }
    if (cumsum > 0) {
      for (let i = 0; i < cumulativeHist.length; i++) {
        cumulativeHist[i] /= cumsum;
      }
    }
  }

  // Second pass: color pixels
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let i = iterationCounts[px + py * width];
      let r, g, b;

      // Special coloring for Newton fractals
      if (type === "newton") {
        const angle = i;  // Stored angle from root
        const t = (angle + Math.PI) / (2 * Math.PI);  // Normalize to 0-1
        [r, g, b] = getPaletteColor(palette, t);

        const index = (px + py * width) * 4;
        imageData[index] = Math.min(255, Math.max(0, Math.floor(r)));
        imageData[index + 1] = Math.min(255, Math.max(0, Math.floor(g)));
        imageData[index + 2] = Math.min(255, Math.max(0, Math.floor(b)));
        imageData[index + 3] = 255;
        continue;
      }

      switch (coloring) {
        case "binary":
          if (i >= maxIter) {
            r = g = b = 0;
          } else {
            r = g = b = 255;
          }
          break;

        case "escape":
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
            let iterFloor = Math.floor(i);
            let t = cumulativeHist[iterFloor];
            [r, g, b] = getPaletteColor(palette, t);
          }
          break;

        case "orbitTrap":
          let dist = i;
          let intensity = Math.min(1, 1 / (dist * 50 + 0.01));
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
          let t = i / maxIter;
          r = g = b = 255 * t;
      }

      const index = (px + py * width) * 4;
      imageData[index] = Math.min(255, Math.max(0, Math.floor(r)));
      imageData[index + 1] = Math.min(255, Math.max(0, Math.floor(g)));
      imageData[index + 2] = Math.min(255, Math.max(0, Math.floor(b)));
      imageData[index + 3] = 255;
    }
  }

  // Send final result back to main thread
  self.postMessage({
    type: 'complete',
    imageData: imageData,
    width: width,
    height: height
  }, [imageData.buffer]);
};
