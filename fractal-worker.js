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
  const { width, height, type, cRe, cIm, maxIter, coloring, palette, offsetX, offsetY, zoom } = e.data;

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
      let minDist = Infinity;

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

      if (coloring === "histogram") {
        if (i < maxIter) histogram[i]++;
        else histogram[maxIter]++;
      }

      iterationCounts[px + py * width] =
        i +
        (coloring === "smooth" && i < maxIter
          ? 1 - Math.log(Math.log(Math.sqrt(zx * zx + zy * zy))) / Math.log(2)
          : 0);

      if (coloring === "orbitTrap") {
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
    imageData: imageData
  }, [imageData.buffer]);
};
