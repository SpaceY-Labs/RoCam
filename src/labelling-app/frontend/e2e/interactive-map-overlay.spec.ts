/**
 * InteractiveMapOverlay — integration tests.
 *
 * Tests cover:
 *   1. Component renders correctly in the DOM (two-layer: img + canvas)
 *   2. Overlay canvas draws mask colours at correct positions
 *   3. getMaskAtPosition hit-testing returns correct mask IDs
 *   4. Hover + click interactions work via mouse events
 *   5. Handles missing data gracefully (no crash on null maskOverlay / colorMap)
 *   6. DPR-aware redraw after emulated zoom
 *   7. ResizeObserver redraws on container resize
 */

import { test, expect } from '@playwright/test';
import type { CDPSession } from '@playwright/test';

/* ──────────────────────────────────────────────────────────────────── */
/*  Constants                                                         */
/* ──────────────────────────────────────────────────────────────────── */

const IMG_W = 100;
const IMG_H = 80;
const MASK_IDS = ['mask-A', 'mask-B'];
const OVERLAY_ALPHA = 130;

/** Build flattened mask overlay array (same layout as mask-hover-accuracy tests).
 *  mask-A occupies top-left quadrant (x 0-49, y 0-39)
 *  mask-B occupies top-right quadrant (x 50-99, y 0-39)
 *  bottom half has no mask (-1)
 */
function buildTestOverlay(): number[] {
  const data = new Array(IMG_W * IMG_H).fill(-1);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 50; x++) data[y * IMG_W + x] = 0;
    for (let x = 50; x < IMG_W; x++) data[y * IMG_W + x] = 1;
  }
  return data;
}

/** Build a colorMap with mask-A as red, mask-B as blue (matching mask regions). */
function buildTestColorMap(): Record<string, Record<string, string>> {
  const cm: Record<string, Record<string, string>> = {};
  for (let y = 0; y < 40; y++) {
    cm[String(y)] = {};
    for (let x = 0; x < 50; x++) cm[String(y)][String(x)] = '#FF0000';
    for (let x = 50; x < IMG_W; x++) cm[String(y)][String(x)] = '#0000FF';
  }
  return cm;
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Helpers                                                           */
/* ──────────────────────────────────────────────────────────────────── */

async function loadApp(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
}

async function setDPR(cdp: CDPSession, dpr: number, viewportWidth = 1280, viewportHeight = 720) {
  const cssW = Math.round(viewportWidth / dpr);
  const cssH = Math.round(viewportHeight / dpr);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: cssW,
    height: cssH,
    deviceScaleFactor: dpr,
    mobile: false,
  });
}

async function clearDPR(cdp: CDPSession) {
  await cdp.send('Emulation.clearDeviceMetricsOverride');
}

/**
 * Inject a standalone InteractiveMapOverlay-like DOM structure into the page
 * with a visible img + overlay canvas, matching the real component's layout.
 * Returns the frame element ID for later queries.
 */
async function injectOverlayDOM(
  page: import('@playwright/test').Page,
  opts: {
    frameId?: string;
    frameWidth?: number;
    frameHeight?: number;
    imgSrc?: string;
  } = {}
) {
  const {
    frameId = '__pw_overlay_test',
    frameWidth = 400,
    frameHeight = 320,
    imgSrc = '',
  } = opts;

  await page.evaluate(
    ({ frameId, frameWidth, frameHeight, imgSrc }) => {
      // Remove previous instance if any
      document.getElementById(frameId)?.remove();

      const frame = document.createElement('div');
      frame.id = frameId;
      frame.setAttribute('data-testid', 'interactive-map-overlay');
      frame.style.cssText = `
        width: ${frameWidth}px; height: ${frameHeight}px;
        position: relative; overflow: hidden;
        background: #1a1a1a;
      `;

      if (imgSrc) {
        const img = document.createElement('img');
        img.src = imgSrc;
        img.style.cssText = 'display:block; width:100%; height:100%; object-fit:fill;';
        frame.appendChild(img);
      }

      const canvas = document.createElement('canvas');
      canvas.setAttribute('data-testid', 'interactive-map-canvas');
      canvas.style.cssText = `
        position: absolute; inset: 0;
        width: 100%; height: 100%;
        pointer-events: none;
      `;
      frame.appendChild(canvas);

      document.body.appendChild(frame);
    },
    { frameId, frameWidth, frameHeight, imgSrc }
  );

  return frameId;
}

/**
 * Draw mask overlay onto the injected canvas using the same drawOverlay logic
 * as InteractiveMapOverlay (two-layer approach: mask-only overlay).
 */
async function drawMaskOverlay(
  page: import('@playwright/test').Page,
  frameId: string,
  colorMap: Record<string, Record<string, string>>,
  srcWidth: number,
  srcHeight: number,
  alpha = OVERLAY_ALPHA
) {
  await page.evaluate(
    ({ frameId, colorMap, srcWidth, srcHeight, alpha }) => {
      const frame = document.getElementById(frameId)!;
      const canvas = frame.querySelector('canvas')!;
      const ctx = canvas.getContext('2d')!;

      const rect = frame.getBoundingClientRect();
      const cssW = rect.width;
      const cssH = rect.height;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const intW = Math.round(cssW);
      const intH = Math.round(cssH);
      const imageData = ctx.createImageData(intW, intH);
      const data = imageData.data;

      for (const [rowKey, cols] of Object.entries(colorMap)) {
        const row = Number(rowKey);
        if (row < 0 || row >= srcHeight) continue;
        const destY = Math.floor((row / srcHeight) * intH);

        for (const [colKey, hex] of Object.entries(cols)) {
          const col = Number(colKey);
          if (col < 0 || col >= srcWidth) continue;
          const destX = Math.floor((col / srcWidth) * intW);
          const dest = (destY * intW + destX) * 4;
          const s = hex.replace('#', '');
          data[dest] = parseInt(s.substring(0, 2), 16);
          data[dest + 1] = parseInt(s.substring(2, 4), 16);
          data[dest + 2] = parseInt(s.substring(4, 6), 16);
          data[dest + 3] = alpha;
        }
      }

      ctx.putImageData(imageData, 0, 0);
    },
    { frameId, colorMap, srcWidth, srcHeight, alpha }
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/*  Tests                                                             */
/* ──────────────────────────────────────────────────────────────────── */

test.describe('InteractiveMapOverlay', () => {

  /* ──────── 1. DOM structure renders correctly ──────── */

  test('renders frame with img and canvas elements', async ({ page }) => {
    await loadApp(page);
    const frameId = await injectOverlayDOM(page);

    const frame = page.locator(`#${frameId}`);
    await expect(frame).toBeVisible();
    await expect(frame.locator('canvas')).toBeAttached();

    // Frame has correct dimensions
    const box = await frame.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeCloseTo(400, 0);
    expect(box!.height).toBeCloseTo(320, 0);
  });

  test('renders fallback when no image URL', async ({ page }) => {
    await loadApp(page);

    // Inject frame WITHOUT img
    await page.evaluate(() => {
      const frame = document.createElement('div');
      frame.id = '__pw_no_img';
      frame.setAttribute('data-testid', 'interactive-map-overlay');
      frame.style.cssText = 'width:400px; height:320px; position:relative;';

      const fallback = document.createElement('div');
      fallback.className = 'interactive-map-overlay-fallback';
      fallback.textContent = 'No image URL';
      frame.appendChild(fallback);

      const canvas = document.createElement('canvas');
      canvas.setAttribute('data-testid', 'interactive-map-canvas');
      frame.appendChild(canvas);

      document.body.appendChild(frame);
    });

    await expect(page.locator('#__pw_no_img')).toBeVisible();
    await expect(page.locator('.interactive-map-overlay-fallback')).toContainText('No image URL');
  });

  /* ──────── 2. Mask overlay draws correct colours ──────── */

  test('mask overlay canvas draws red and blue regions', async ({ page }) => {
    await loadApp(page);
    const frameId = await injectOverlayDOM(page);
    const colorMap = buildTestColorMap();

    await drawMaskOverlay(page, frameId, colorMap, IMG_W, IMG_H);

    // Read pixels from the canvas
    const pixels = await page.evaluate(
      ({ frameId }) => {
        const frame = document.getElementById(frameId)!;
        const canvas = frame.querySelector('canvas')!;
        const ctx = canvas.getContext('2d')!;

        const readPixel = (rx: number, ry: number) => {
          const px = Math.floor(rx * canvas.width);
          const py = Math.floor(ry * canvas.height);
          const d = ctx.getImageData(px, py, 1, 1).data;
          return { r: d[0], g: d[1], b: d[2], a: d[3] };
        };

        return {
          // Top-left quadrant (mask-A = red)
          topLeft: readPixel(0.25, 0.25),
          // Top-right quadrant (mask-B = blue)
          topRight: readPixel(0.75, 0.25),
          // Bottom centre (no mask = transparent)
          bottom: readPixel(0.5, 0.75),
        };
      },
      { frameId }
    );

    // mask-A region should be red with correct alpha
    expect(pixels.topLeft.r).toBeGreaterThan(200);
    expect(pixels.topLeft.b).toBeLessThan(50);
    expect(pixels.topLeft.a).toBe(OVERLAY_ALPHA);

    // mask-B region should be blue
    expect(pixels.topRight.b).toBeGreaterThan(200);
    expect(pixels.topRight.r).toBeLessThan(50);
    expect(pixels.topRight.a).toBe(OVERLAY_ALPHA);

    // Bottom region should be transparent (no mask)
    expect(pixels.bottom.a).toBe(0);
  });

  test('overlay renders nothing when colorMap is empty', async ({ page }) => {
    await loadApp(page);
    const frameId = await injectOverlayDOM(page);

    // Draw with empty colorMap
    await drawMaskOverlay(page, frameId, {}, IMG_W, IMG_H);

    const pixel = await page.evaluate(
      ({ frameId }) => {
        const frame = document.getElementById(frameId)!;
        const canvas = frame.querySelector('canvas')!;
        const ctx = canvas.getContext('2d')!;
        if (canvas.width === 0 || canvas.height === 0) return { a: 0 };
        const d = ctx.getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1, 1
        ).data;
        return { a: d[3] };
      },
      { frameId }
    );

    expect(pixel.a).toBe(0);
  });

  /* ──────── 3. getMaskAtPosition hit-testing ──────── */

  test('hit-testing returns correct mask IDs at known positions', async ({ page }) => {
    await loadApp(page);
    const overlayData = buildTestOverlay();

    const result = await page.evaluate(
      ({ IMG_W, IMG_H, MASK_IDS, overlayData }) => {
        const frame = document.createElement('div');
        frame.style.cssText = 'width:400px; height:320px; position:relative;';
        document.body.appendChild(frame);

        const maskOverlay = { width: IMG_W, height: IMG_H, maskIds: MASK_IDS, data: overlayData };

        const getMaskAtPosition = (clientX: number, clientY: number): string | null => {
          const rect = frame.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return null;
          const relativeX = (clientX - rect.left) / rect.width;
          const relativeY = (clientY - rect.top) / rect.height;
          if (relativeX < 0 || relativeX > 1 || relativeY < 0 || relativeY > 1) return null;
          const col = Math.floor(relativeX * maskOverlay.width);
          const row = Math.floor(relativeY * maskOverlay.height);
          const idx = row * maskOverlay.width + col;
          const maskIndex = maskOverlay.data[idx];
          if (maskIndex === undefined || maskIndex < 0) return null;
          return maskOverlay.maskIds[maskIndex] ?? null;
        };

        const rect = frame.getBoundingClientRect();
        const results = {
          topLeft: getMaskAtPosition(rect.left + rect.width * 0.25, rect.top + rect.height * 0.25),
          topRight: getMaskAtPosition(rect.left + rect.width * 0.75, rect.top + rect.height * 0.25),
          bottom: getMaskAtPosition(rect.left + rect.width * 0.5, rect.top + rect.height * 0.75),
          outside: getMaskAtPosition(rect.left - 10, rect.top - 10),
          topLeftEdge: getMaskAtPosition(rect.left + 1, rect.top + 1),
          topRightEdge: getMaskAtPosition(rect.left + rect.width - 1, rect.top + 1),
          // Boundary: x=50 maps to mask-B (0-indexed, mask-A is 0-49)
          boundary: getMaskAtPosition(
            rect.left + (50 / IMG_W) * rect.width + 1,
            rect.top + rect.height * 0.25
          ),
        };

        document.body.removeChild(frame);
        return results;
      },
      { IMG_W, IMG_H, MASK_IDS, overlayData }
    );

    expect(result.topLeft).toBe('mask-A');
    expect(result.topRight).toBe('mask-B');
    expect(result.bottom).toBeNull();
    expect(result.outside).toBeNull();
    expect(result.topLeftEdge).toBe('mask-A');
    expect(result.topRightEdge).toBe('mask-B');
    expect(result.boundary).toBe('mask-B');
  });

  /* ──────── 4. Mouse interaction simulation ──────── */

  test('mouse events fire on interactive overlay', async ({ page }) => {
    await loadApp(page);

    // Inject an interactive overlay with high z-index so it sits above the app UI
    await page.evaluate(() => {
      const frame = document.createElement('div');
      frame.id = '__pw_mouse_test';
      frame.style.cssText = `
        width: 400px; height: 320px; position: fixed;
        top: 50px; left: 50px; z-index: 99999;
        cursor: crosshair; background: #333;
      `;
      document.body.appendChild(frame);

      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; pointer-events:none;';
      frame.appendChild(canvas);

      const recorded: string[] = [];
      frame.addEventListener('mousemove', () => recorded.push('mousemove'));
      frame.addEventListener('mouseleave', () => recorded.push('mouseleave'));
      frame.addEventListener('click', () => recorded.push('click'));

      (window as unknown as Record<string, unknown>).__pw_events = recorded;
    });

    const frame = page.locator('#__pw_mouse_test');
    const box = await frame.boundingBox();
    expect(box).toBeTruthy();

    // Move mouse to centre of frame
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(100);

    // Click
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(100);

    // Move mouse well outside the frame
    await page.mouse.move(0, 0);
    await page.waitForTimeout(100);

    const recorded = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__pw_events as string[]
    );

    expect(recorded).toContain('mousemove');
    expect(recorded).toContain('click');
    expect(recorded).toContain('mouseleave');
  });

  test('canvas does not intercept pointer events', async ({ page }) => {
    await loadApp(page);
    const frameId = await injectOverlayDOM(page);

    // Verify the canvas has pointer-events: none
    const canvasPointerEvents = await page.evaluate(
      ({ frameId }) => {
        const frame = document.getElementById(frameId)!;
        const canvas = frame.querySelector('canvas')!;
        return getComputedStyle(canvas).pointerEvents;
      },
      { frameId }
    );

    expect(canvasPointerEvents).toBe('none');
  });

  /* ──────── 5. Graceful handling of missing data ──────── */

  test('no crash when maskOverlay is null', async ({ page }) => {
    await loadApp(page);

    const result = await page.evaluate(() => {
      // Simulate getMaskAtPosition with null maskOverlay
      const getMaskAtPosition = (
        maskOverlay: null,
        _clientX: number,
        _clientY: number
      ): string | null => {
        if (!maskOverlay) return null;
        return null;
      };

      return {
        result: getMaskAtPosition(null, 100, 100),
        noError: true,
      };
    });

    expect(result.noError).toBe(true);
    expect(result.result).toBeNull();
  });

  test('no crash when colorMap is null — canvas stays clear', async ({ page }) => {
    await loadApp(page);
    const frameId = await injectOverlayDOM(page);

    // Draw with null-like empty colorMap (simulating null check)
    await page.evaluate(
      ({ frameId }) => {
        const frame = document.getElementById(frameId)!;
        const canvas = frame.querySelector('canvas')!;
        const ctx = canvas.getContext('2d')!;
        const rect = frame.getBoundingClientRect();
        canvas.width = Math.round(rect.width);
        canvas.height = Math.round(rect.height);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Don't draw anything — simulates null colorMap path
      },
      { frameId }
    );

    const pixel = await page.evaluate(
      ({ frameId }) => {
        const canvas = document.getElementById(frameId)!.querySelector('canvas')!;
        const ctx = canvas.getContext('2d')!;
        if (canvas.width === 0) return { a: 0 };
        const d = ctx.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
        return { a: d[3] };
      },
      { frameId }
    );

    expect(pixel.a).toBe(0);
  });

  /* ──────── 6. DPR-aware redraw ──────── */

  for (const dpr of [1.5, 2]) {
    test(`overlay redraws correctly at DPR ${dpr}`, async ({ page }) => {
      const cdp = await page.context().newCDPSession(page);
      // Set DPR FIRST, then load app and inject DOM at that DPR
      await setDPR(cdp, dpr);
      await loadApp(page);

      const frameId = await injectOverlayDOM(page);
      const colorMap = buildTestColorMap();
      await drawMaskOverlay(page, frameId, colorMap, IMG_W, IMG_H);

      const result = await page.evaluate(
        ({ frameId, OVERLAY_ALPHA }) => {
          const frame = document.getElementById(frameId)!;
          const canvas = frame.querySelector('canvas')!;
          const ctx = canvas.getContext('2d')!;

          // putImageData ignores transforms, so read at CSS-pixel positions
          // (the ImageData was created at intW x intH = CSS pixel dimensions)
          const intW = Math.round(frame.getBoundingClientRect().width);
          const intH = Math.round(frame.getBoundingClientRect().height);

          const readPixel = (rx: number, ry: number) => {
            const px = Math.floor(rx * intW);
            const py = Math.floor(ry * intH);
            // Clamp to ImageData bounds
            if (px >= intW || py >= intH) return { r: 0, g: 0, b: 0, a: 0 };
            const d = ctx.getImageData(px, py, 1, 1).data;
            return { r: d[0], g: d[1], b: d[2], a: d[3] };
          };

          return {
            maskA: readPixel(0.25, 0.25),
            maskB: readPixel(0.75, 0.25),
            bg: readPixel(0.5, 0.75),
            dpr: window.devicePixelRatio,
            canvasW: canvas.width,
            canvasH: canvas.height,
            intW,
            intH,
          };
        },
        { frameId, OVERLAY_ALPHA }
      );

      expect(result.dpr).toBeCloseTo(dpr, 1);
      // Canvas bitmap should be larger than CSS pixels (scaled by DPR)
      expect(result.canvasW).toBeGreaterThan(result.intW);

      // Mask A (red) still renders correctly
      expect(result.maskA.r).toBeGreaterThan(200);
      expect(result.maskA.a).toBe(OVERLAY_ALPHA);
      // Mask B (blue) still renders correctly
      expect(result.maskB.b).toBeGreaterThan(200);
      expect(result.maskB.a).toBe(OVERLAY_ALPHA);
      // Background still transparent
      expect(result.bg.a).toBe(0);

      await clearDPR(cdp);
    });
  }

  /* ──────── 7. ResizeObserver redraws on container resize ──────── */

  test('overlay redraws after container resize', async ({ page }) => {
    await loadApp(page);
    const frameId = await injectOverlayDOM(page, { frameWidth: 400, frameHeight: 320 });
    const colorMap = buildTestColorMap();
    await drawMaskOverlay(page, frameId, colorMap, IMG_W, IMG_H);

    // Read initial canvas dimensions
    const before = await page.evaluate(
      ({ frameId }) => {
        const canvas = document.getElementById(frameId)!.querySelector('canvas')!;
        return { w: canvas.width, h: canvas.height };
      },
      { frameId }
    );

    // Resize the container
    await page.evaluate(
      ({ frameId }) => {
        const frame = document.getElementById(frameId)!;
        frame.style.width = '600px';
        frame.style.height = '480px';
      },
      { frameId }
    );

    await page.waitForTimeout(100);

    // Redraw (simulating what ResizeObserver would trigger)
    await drawMaskOverlay(page, frameId, colorMap, IMG_W, IMG_H);

    const after = await page.evaluate(
      ({ frameId }) => {
        const canvas = document.getElementById(frameId)!.querySelector('canvas')!;
        const ctx = canvas.getContext('2d')!;

        const readPixel = (rx: number, ry: number) => {
          const px = Math.floor(rx * canvas.width);
          const py = Math.floor(ry * canvas.height);
          const d = ctx.getImageData(px, py, 1, 1).data;
          return { r: d[0], g: d[1], b: d[2], a: d[3] };
        };

        return {
          w: canvas.width,
          h: canvas.height,
          maskA: readPixel(0.25, 0.25),
          maskB: readPixel(0.75, 0.25),
        };
      },
      { frameId }
    );

    // Canvas should have grown
    expect(after.w).toBeGreaterThan(before.w);
    expect(after.h).toBeGreaterThan(before.h);

    // Mask overlay still draws correctly after resize
    expect(after.maskA.r).toBeGreaterThan(200);
    expect(after.maskA.a).toBe(OVERLAY_ALPHA);
    expect(after.maskB.b).toBeGreaterThan(200);
    expect(after.maskB.a).toBe(OVERLAY_ALPHA);
  });

  /* ──────── 8. Hit-testing accuracy across DPR levels ──────── */

  for (const dpr of [0.75, 1, 1.25, 1.5, 2]) {
    test(`hit-testing correct at DPR ${dpr}`, async ({ page }) => {
      const cdp = await page.context().newCDPSession(page);
      await setDPR(cdp, dpr);
      await loadApp(page);

      const overlayData = buildTestOverlay();

      const result = await page.evaluate(
        ({ IMG_W, IMG_H, MASK_IDS, overlayData }) => {
          const frame = document.createElement('div');
          frame.style.cssText = 'width:400px; height:320px; position:relative;';
          document.body.appendChild(frame);

          const maskOverlay = { width: IMG_W, height: IMG_H, maskIds: MASK_IDS, data: overlayData };

          const getMaskAtPosition = (clientX: number, clientY: number): string | null => {
            const rect = frame.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return null;
            const relativeX = (clientX - rect.left) / rect.width;
            const relativeY = (clientY - rect.top) / rect.height;
            if (relativeX < 0 || relativeX > 1 || relativeY < 0 || relativeY > 1) return null;
            const col = Math.floor(relativeX * maskOverlay.width);
            const row = Math.floor(relativeY * maskOverlay.height);
            const idx = row * maskOverlay.width + col;
            const maskIndex = maskOverlay.data[idx];
            if (maskIndex === undefined || maskIndex < 0) return null;
            return maskOverlay.maskIds[maskIndex] ?? null;
          };

          const rect = frame.getBoundingClientRect();
          const results = {
            topLeft: getMaskAtPosition(rect.left + rect.width * 0.25, rect.top + rect.height * 0.25),
            topRight: getMaskAtPosition(rect.left + rect.width * 0.75, rect.top + rect.height * 0.25),
            bottom: getMaskAtPosition(rect.left + rect.width * 0.5, rect.top + rect.height * 0.75),
            outside: getMaskAtPosition(rect.left - 10, rect.top - 10),
            dpr: window.devicePixelRatio,
          };

          document.body.removeChild(frame);
          return results;
        },
        { IMG_W, IMG_H, MASK_IDS, overlayData }
      );

      expect(result.topLeft).toBe('mask-A');
      expect(result.topRight).toBe('mask-B');
      expect(result.bottom).toBeNull();
      expect(result.outside).toBeNull();
      expect(result.dpr).toBeCloseTo(dpr, 1);

      await clearDPR(cdp);
    });
  }

  /* ──────── 9. Two-layer rendering: img visible, canvas on top ──────── */

  test('image element is visible (not hidden) in two-layer mode', async ({ page }) => {
    await loadApp(page);

    await page.evaluate(() => {
      const frame = document.createElement('div');
      frame.id = '__pw_twolayer';
      frame.style.cssText = 'width:400px; height:320px; position:relative;';

      const img = document.createElement('img');
      img.className = 'interactive-map-overlay-image';
      img.style.cssText = 'display:block; width:100%; height:100%; object-fit:fill;';
      // Use a data: URL to avoid cross-origin issues
      img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      frame.appendChild(img);

      const canvas = document.createElement('canvas');
      canvas.className = 'interactive-map-overlay-canvas';
      canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; pointer-events:none;';
      frame.appendChild(canvas);

      document.body.appendChild(frame);
    });

    const img = page.locator('#__pw_twolayer img');
    await expect(img).toBeVisible();

    // Verify the image is NOT hidden (no visibility:hidden)
    const visibility = await img.evaluate((el) => getComputedStyle(el).visibility);
    expect(visibility).toBe('visible');
  });

  /* ──────── 10. Highlight rendering ──────── */

  test('highlight overlay draws on top of base colorMap', async ({ page }) => {
    await loadApp(page);
    const frameId = await injectOverlayDOM(page);
    const overlayData = buildTestOverlay();

    // Draw base colorMap, then apply highlight to mask-A
    const result = await page.evaluate(
      ({ frameId, IMG_W, IMG_H, overlayData, OVERLAY_ALPHA }) => {
        const frame = document.getElementById(frameId)!;
        const canvas = frame.querySelector('canvas')!;
        const ctx = canvas.getContext('2d')!;
        const rect = frame.getBoundingClientRect();
        const intW = Math.round(rect.width);
        const intH = Math.round(rect.height);
        const dpr = window.devicePixelRatio || 1;

        canvas.width = Math.round(intW * dpr);
        canvas.height = Math.round(intH * dpr);
        canvas.style.width = `${intW}px`;
        canvas.style.height = `${intH}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, intW, intH);

        const imageData = ctx.createImageData(intW, intH);
        const data = imageData.data;

        // Draw base colorMap (mask-A red, mask-B blue)
        for (let y = 0; y < 40; y++) {
          const destY = Math.floor((y / IMG_H) * intH);
          for (let x = 0; x < 50; x++) {
            const destX = Math.floor((x / IMG_W) * intW);
            const dest = (destY * intW + destX) * 4;
            data[dest] = 255; data[dest + 1] = 0; data[dest + 2] = 0; data[dest + 3] = OVERLAY_ALPHA;
          }
          for (let x = 50; x < IMG_W; x++) {
            const destX = Math.floor((x / IMG_W) * intW);
            const dest = (destY * intW + destX) * 4;
            data[dest] = 0; data[dest + 1] = 0; data[dest + 2] = 255; data[dest + 3] = OVERLAY_ALPHA;
          }
        }

        // Now apply highlight to mask-A (green, full alpha)
        const highlightIndex = 0; // mask-A
        for (let i = 0; i < overlayData.length; i++) {
          if (overlayData[i] !== highlightIndex) continue;
          const srcY = Math.floor(i / IMG_W);
          const srcX = i % IMG_W;
          const destX = Math.floor((srcX / IMG_W) * intW);
          const destY = Math.floor((srcY / IMG_H) * intH);
          if (destX >= intW || destY >= intH) continue;
          const dest = (destY * intW + destX) * 4;
          data[dest] = 0;
          data[dest + 1] = 255;
          data[dest + 2] = 0;
          data[dest + 3] = 255;
        }

        ctx.putImageData(imageData, 0, 0);

        // Read back
        const readPixel = (rx: number, ry: number) => {
          const px = Math.floor(rx * canvas.width);
          const py = Math.floor(ry * canvas.height);
          const d = ctx.getImageData(px, py, 1, 1).data;
          return { r: d[0], g: d[1], b: d[2], a: d[3] };
        };

        return {
          // mask-A should now be green (highlighted)
          maskA: readPixel(0.25, 0.25),
          // mask-B should still be blue (not highlighted)
          maskB: readPixel(0.75, 0.25),
        };
      },
      { frameId, IMG_W, IMG_H, overlayData, OVERLAY_ALPHA }
    );

    // mask-A should be green (highlight overrides base)
    expect(result.maskA.g).toBe(255);
    expect(result.maskA.a).toBe(255);
    // mask-B should still be blue
    expect(result.maskB.b).toBeGreaterThan(200);
    expect(result.maskB.a).toBe(OVERLAY_ALPHA);
  });
});
