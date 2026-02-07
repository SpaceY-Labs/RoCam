/**
 * Mask-hover accuracy tests at multiple zoom / DPR levels.
 *
 * These tests exercise the same coordinate-mapping logic used by MaskCanvas
 * and InteractiveMapOverlay (`getMaskAtPosition` / getBoundingClientRect)
 * and verify correct mask ID at known positions — at default and fractional
 * DPR (e.g. Ctrl+scroll).
 *
 * Test levels:
 *   1. Coordinate math only    — pure JS in page.evaluate
 *   2. Canvas pixel readback   — verifies rendered mask colours
 *   3. CDP DPR emulation       — repeats at 0.75×, 1.0×, 1.25×, 1.5×, 2.0×
 *   4. Viewport size consistency
 */

import { test, expect } from '@playwright/test';
import type { CDPSession } from '@playwright/test';

/* ──────────────────────────────────────────────────────────────────── */
/*  Constants                                                         */
/* ──────────────────────────────────────────────────────────────────── */

/** Image natural size used across all tests. */
const IMG_W = 100;
const IMG_H = 80;

/** Mask regions in the test overlay.
 *
 *  ┌───────────┬───────────┐
 *  │  mask-A   │  mask-B   │
 *  │  (0-49,   │  (50-99,  │
 *  │   0-39)   │   0-39)   │
 *  ├───────────┴───────────┤
 *  │       (no mask)       │
 *  │       (y 40-79)       │
 *  └───────────────────────┘
 */
const MASK_IDS = ['mask-A', 'mask-B'];

/** Build flattened mask overlay array. */
function buildTestOverlay(): number[] {
  const data = new Array(IMG_W * IMG_H).fill(-1);
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 50; x++) data[y * IMG_W + x] = 0;        // mask-A
    for (let x = 50; x < IMG_W; x++) data[y * IMG_W + x] = 1;    // mask-B
  }
  return data;
}

/** Colours for the two masks (matching what applyMaskToBuffer would produce). */
const MASK_A_COLOR = { r: 255, g: 0, b: 0 };     // red
const MASK_B_COLOR = { r: 0, g: 0, b: 255 };       // blue
const BG_COLOR = { r: 200, g: 200, b: 200 };        // grey background

/* ──────────────────────────────────────────────────────────────────── */
/*  Helpers                                                           */
/* ──────────────────────────────────────────────────────────────────── */

async function loadApp(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
}

/** Change the device-pixel-ratio via Chrome DevTools Protocol. */
async function setDPR(cdp: CDPSession, dpr: number, viewportWidth = 1280, viewportHeight = 720) {
  // Viewport in CSS pixels at this DPR
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

/* ──────────────────────────────────────────────────────────────────── */
/*  Tests                                                             */
/* ──────────────────────────────────────────────────────────────────── */

test.describe('Mask hover accuracy', () => {

  /* ──────── 1. Coordinate math correctness ──────── */

  const dprValues = [0.75, 1, 1.25, 1.5, 2];

  for (const dpr of dprValues) {
    test(`getMaskAtPosition returns correct mask at DPR ${dpr}`, async ({ page }) => {
      const cdp = await page.context().newCDPSession(page);
      await setDPR(cdp, dpr);
      await loadApp(page);

      const overlayData = buildTestOverlay();

      const result = await page.evaluate(
        ({ IMG_W, IMG_H, MASK_IDS, overlayData }) => {
          // Build DOM — a frame with known CSS size
          const frame = document.createElement('div');
          frame.id = '__pw_coord_test';
          frame.style.cssText = `
            width: 400px; height: 320px;
            position: relative;
          `;
          document.body.appendChild(frame);

          const maskOverlay = {
            width: IMG_W,
            height: IMG_H,
            maskIds: MASK_IDS,
            data: overlayData,
          };

          // Same logic as MaskCanvas.getMaskAtPosition
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

          // Sample points — centres of each quadrant and the bottom half
          const results = {
            topLeftCenter: getMaskAtPosition(
              rect.left + rect.width * 0.25,
              rect.top + rect.height * 0.25,
            ),
            topRightCenter: getMaskAtPosition(
              rect.left + rect.width * 0.75,
              rect.top + rect.height * 0.25,
            ),
            bottomCenter: getMaskAtPosition(
              rect.left + rect.width * 0.50,
              rect.top + rect.height * 0.75,
            ),
            // Edge cases: just inside mask-A (top-left pixel)
            topLeftEdge: getMaskAtPosition(
              rect.left + 1,
              rect.top + 1,
            ),
            // Just inside mask-B (top-right pixel)
            topRightEdge: getMaskAtPosition(
              rect.left + rect.width - 1,
              rect.top + 1,
            ),
            // Outside the frame entirely
            outside: getMaskAtPosition(
              rect.left - 10,
              rect.top - 10,
            ),
            dpr: window.devicePixelRatio,
            frameRect: { w: rect.width, h: rect.height, l: rect.left, t: rect.top },
          };

          document.body.removeChild(frame);
          return results;
        },
        { IMG_W, IMG_H, MASK_IDS, overlayData },
      );

      expect(result.topLeftCenter).toBe('mask-A');
      expect(result.topRightCenter).toBe('mask-B');
      expect(result.bottomCenter).toBeNull();        // bottom half has no mask
      expect(result.topLeftEdge).toBe('mask-A');
      expect(result.topRightEdge).toBe('mask-B');
      expect(result.outside).toBeNull();
      // Verify the DPR was actually applied
      expect(result.dpr).toBeCloseTo(dpr, 1);

      await clearDPR(cdp);
    });
  }

  /* ──────── 2. Canvas pixel readback ──────── */

  test('canvas pixel colours match mask regions after render', async ({ page }) => {
    await loadApp(page);

    const pixels = await page.evaluate(
      ({ IMG_W, IMG_H, MASK_A, MASK_B, BG }) => {
        // Create a frame + canvas mimicking MaskCanvas
        const frame = document.createElement('div');
        frame.style.cssText = `
          width: 400px; height: 320px;
          position: relative;
        `;
        document.body.appendChild(frame);

        const canvas = document.createElement('canvas');
        canvas.width = IMG_W;
        canvas.height = IMG_H;
        canvas.style.cssText = `
          position: absolute; inset: 0;
          width: 100%; height: 100%;
        `;
        frame.appendChild(canvas);

        const ctx = canvas.getContext('2d')!;

        // Draw background
        ctx.fillStyle = `rgb(${BG.r}, ${BG.g}, ${BG.b})`;
        ctx.fillRect(0, 0, IMG_W, IMG_H);

        // Draw mask-A (top-left quadrant, red)
        ctx.fillStyle = `rgb(${MASK_A.r}, ${MASK_A.g}, ${MASK_A.b})`;
        ctx.fillRect(0, 0, 50, 40);

        // Draw mask-B (top-right quadrant, blue)
        ctx.fillStyle = `rgb(${MASK_B.r}, ${MASK_B.g}, ${MASK_B.b})`;
        ctx.fillRect(50, 0, 50, 40);

        // Read pixels from the canvas bitmap (not CSS-scaled)
        const readPixel = (x: number, y: number) => {
          const d = ctx.getImageData(x, y, 1, 1).data;
          return { r: d[0], g: d[1], b: d[2], a: d[3] };
        };

        const results = {
          maskA_center: readPixel(25, 20),       // centre of mask-A
          maskB_center: readPixel(75, 20),       // centre of mask-B
          bg_center: readPixel(50, 60),          // centre of bottom (no mask)
          maskA_edge: readPixel(0, 0),           // top-left pixel (mask-A)
          maskB_edge: readPixel(99, 0),          // top-right pixel (mask-B)
          boundary: readPixel(50, 20),           // right on the A/B boundary → should be B
        };

        document.body.removeChild(frame);
        return results;
      },
      { IMG_W, IMG_H, MASK_A: MASK_A_COLOR, MASK_B: MASK_B_COLOR, BG: BG_COLOR },
    );

    // Mask A (red)
    expect(pixels.maskA_center.r).toBe(255);
    expect(pixels.maskA_center.g).toBe(0);
    expect(pixels.maskA_center.b).toBe(0);

    // Mask B (blue)
    expect(pixels.maskB_center.r).toBe(0);
    expect(pixels.maskB_center.g).toBe(0);
    expect(pixels.maskB_center.b).toBe(255);

    // Background (grey)
    expect(pixels.bg_center.r).toBe(200);
    expect(pixels.bg_center.g).toBe(200);
    expect(pixels.bg_center.b).toBe(200);

    // Edges
    expect(pixels.maskA_edge.r).toBe(255);  // red
    expect(pixels.maskB_edge.b).toBe(255);  // blue

    // Boundary pixel (x=50 is in mask-B territory since mask-A is 0-49)
    expect(pixels.boundary.b).toBe(255);
  });

  /* ──────── 3. Pixel readback after viewport resize (zoom simulation) ──────── */

  for (const dpr of [1.5, 2]) {
    test(`canvas pixels stay correct after emulated DPR ${dpr}`, async ({ page }) => {
      const cdp = await page.context().newCDPSession(page);
      await loadApp(page);

      // Draw at DPR 1
      await page.evaluate(
        ({ IMG_W, IMG_H }) => {
          const frame = document.createElement('div');
          frame.id = '__pw_pixel_resize';
          frame.style.cssText = `
            width: 400px; height: 320px;
            position: relative;
          `;
          document.body.appendChild(frame);

          const canvas = document.createElement('canvas');
          canvas.id = '__pw_canvas_resize';
          frame.appendChild(canvas);

          // Draw with DPR-aware sizing (our production code path)
          const rect = frame.getBoundingClientRect();
          const currentDpr = window.devicePixelRatio || 1;
          canvas.width = Math.round(rect.width * currentDpr);
          canvas.height = Math.round(rect.height * currentDpr);
          canvas.style.cssText = `
            position: absolute; inset: 0;
            width: ${rect.width}px; height: ${rect.height}px;
          `;

          const ctx = canvas.getContext('2d')!;
          // Scale context so drawing coordinates match natural image space
          ctx.scale(canvas.width / IMG_W, canvas.height / IMG_H);

          ctx.fillStyle = 'rgb(200,200,200)';
          ctx.fillRect(0, 0, IMG_W, IMG_H);
          ctx.fillStyle = 'rgb(255,0,0)';
          ctx.fillRect(0, 0, 50, 40);
          ctx.fillStyle = 'rgb(0,0,255)';
          ctx.fillRect(50, 0, 50, 40);
        },
        { IMG_W, IMG_H },
      );

      // Now change DPR (simulating browser zoom)
      await setDPR(cdp, dpr);
      await page.waitForTimeout(200); // let resize observers fire

      // Re-render the canvas (simulating what MaskCanvas.redraw does on resize)
      const pixelsAfter = await page.evaluate(
        ({ IMG_W, IMG_H }) => {
          const frame = document.getElementById('__pw_pixel_resize')!;
          const canvas = document.getElementById('__pw_canvas_resize')! as HTMLCanvasElement;

          // Re-run redraw() logic
          const rect = frame.getBoundingClientRect();
          const currentDpr = window.devicePixelRatio || 1;
          canvas.width = Math.round(rect.width * currentDpr);
          canvas.height = Math.round(rect.height * currentDpr);
          canvas.style.width = `${rect.width}px`;
          canvas.style.height = `${rect.height}px`;

          const ctx = canvas.getContext('2d')!;
          ctx.scale(canvas.width / IMG_W, canvas.height / IMG_H);

          ctx.fillStyle = 'rgb(200,200,200)';
          ctx.fillRect(0, 0, IMG_W, IMG_H);
          ctx.fillStyle = 'rgb(255,0,0)';
          ctx.fillRect(0, 0, 50, 40);
          ctx.fillStyle = 'rgb(0,0,255)';
          ctx.fillRect(50, 0, 50, 40);

          // Read a pixel in the centre of each region (in bitmap coordinates)
          const readPixel = (rx: number, ry: number) => {
            const px = Math.floor(rx * canvas.width);
            const py = Math.floor(ry * canvas.height);
            const d = ctx.getImageData(px, py, 1, 1).data;
            return { r: d[0], g: d[1], b: d[2] };
          };

          return {
            maskA: readPixel(0.25, 0.25),   // centre of top-left
            maskB: readPixel(0.75, 0.25),   // centre of top-right
            bg:    readPixel(0.50, 0.75),   // centre of bottom
            dpr: currentDpr,
            canvasW: canvas.width,
            canvasH: canvas.height,
          };
        },
        { IMG_W, IMG_H },
      );

      expect(pixelsAfter.dpr).toBeCloseTo(dpr, 1);
      // Mask A — red
      expect(pixelsAfter.maskA.r).toBeGreaterThan(200);
      expect(pixelsAfter.maskA.b).toBeLessThan(50);
      // Mask B — blue
      expect(pixelsAfter.maskB.b).toBeGreaterThan(200);
      expect(pixelsAfter.maskB.r).toBeLessThan(50);
      // Background — grey
      expect(pixelsAfter.bg.r).toBeGreaterThan(150);
      expect(pixelsAfter.bg.r).toBeLessThan(220);

      await clearDPR(cdp);
    });
  }

  /* ──────── 4. Coordinate mapping stays accurate across viewport sizes ──────── */

  test('coordinate mapping consistent across 4 viewport sizes', async ({ page }) => {
    await loadApp(page);

    const overlayData = buildTestOverlay();
    const viewports = [
      { w: 600, h: 400 },
      { w: 800, h: 600 },
      { w: 1280, h: 720 },
      { w: 1920, h: 1080 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.waitForTimeout(100);

      const result = await page.evaluate(
        ({ IMG_W, IMG_H, MASK_IDS, overlayData }) => {
          let frame = document.getElementById('__pw_vp_test') as HTMLDivElement | null;
          if (!frame) {
            frame = document.createElement('div');
            frame.id = '__pw_vp_test';
            // responsive container: 80% width, aspect ratio matches image
            frame.style.cssText = `
              width: 80%; aspect-ratio: ${IMG_W} / ${IMG_H};
              position: relative; max-width: 800px;
            `;
            document.body.appendChild(frame);
          }

          const maskOverlay = {
            width: IMG_W,
            height: IMG_H,
            maskIds: MASK_IDS,
            data: overlayData,
          };

          const getMaskAtPosition = (clientX: number, clientY: number): string | null => {
            const rect = frame!.getBoundingClientRect();
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
          return {
            topLeft: getMaskAtPosition(rect.left + rect.width * 0.25, rect.top + rect.height * 0.25),
            topRight: getMaskAtPosition(rect.left + rect.width * 0.75, rect.top + rect.height * 0.25),
            bottom: getMaskAtPosition(rect.left + rect.width * 0.5, rect.top + rect.height * 0.75),
            vpW: window.innerWidth,
            frameW: rect.width,
          };
        },
        { IMG_W, IMG_H, MASK_IDS, overlayData },
      );

      expect(result.topLeft, `mask-A at viewport ${vp.w}×${vp.h}`).toBe('mask-A');
      expect(result.topRight, `mask-B at viewport ${vp.w}×${vp.h}`).toBe('mask-B');
      expect(result.bottom, `no mask at viewport ${vp.w}×${vp.h}`).toBeNull();
    }
  });
});
